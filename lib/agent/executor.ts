import { createHmac } from 'node:crypto'
import { CATEGORIES } from '../domain/categories'
import { joinPath, planFolder } from '../domain/folders'
import { addBusinessDays } from '../domain/followups'
import { renderFolderTemplate, type Plan } from '../domain/rules'
import { env } from '../env'
import { emit, mailboxFor, store } from '../runtime'
import { stableId } from '../store/store'
import type { Account, Analysis, Folder, MailMessage } from '../types'
import { produceReply } from './drafts'

/**
 * Carrying out a plan.
 *
 * Each action is attempted independently: a failure to flag a message must not
 * stop it being filed, and a webhook timing out must not stop a reply being
 * drafted. Failures are logged against the rule that asked for the action, so
 * a broken rule is visible as a broken rule.
 */

export interface ExecuteInput {
  account: Account
  message: MailMessage
  analysis: Analysis
  conversation: MailMessage[]
  plan: Plan
  now: Date
}

export async function executeActions(input: ExecuteInput): Promise<void> {
  const { account, analysis, plan, now } = input
  const db = store()
  const mailbox = mailboxFor(account)
  // Re-read before each action: an earlier one may have changed it.
  const current = () => db.read.messages.find((m) => m.id === input.message.id) ?? input.message

  for (const action of plan.actions) {
    const ruleId = action.ruleId
    const log = (kind: Parameters<typeof db.log>[0]['kind'], detail: string) =>
      db.log({ accountId: account.id, messageId: input.message.id, ruleId, kind, actor: 'agent', detail })

    try {
      switch (action.type) {
        case 'categorize': {
          const name = action.category === '{category}' ? CATEGORIES[analysis.category].outlookCategory : action.category
          await mailbox.setCategories(current(), [name])
          await log('categorised', `Category "${name}"`)
          break
        }
        case 'flag': {
          await mailbox.flag(current(), analysis.deadline ? `${analysis.deadline}T17:00:00Z` : undefined)
          await log('flagged', analysis.deadline ? `Flagged, due ${analysis.deadline}` : 'Flagged for follow-up')
          break
        }
        case 'markRead': {
          await mailbox.markRead(current())
          await log('marked-read', 'Marked as read')
          break
        }
        case 'followUp': {
          const days = action.days ?? account.settings.followUpDays
          const message = current()
          const exists = db.read.followUps.some((f) => f.conversationId === message.conversationId && f.status === 'open')
          if (!exists) {
            await db.mutate((d) => {
              d.followUps.push({
                id: stableId('fu', `${message.conversationId}:${message.id}:awaiting-us`),
                accountId: account.id,
                conversationId: message.conversationId,
                messageId: message.id,
                kind: 'awaiting-us',
                subject: message.subject,
                counterpart: message.from,
                dueAt: addBusinessDays(now, days).toISOString(),
                status: 'open',
                createdAt: now.toISOString(),
              })
            })
            await log('follow-up-opened', `Follow up within ${days} business day(s)`)
          }
          break
        }
        case 'draftReply':
        case 'autoReply': {
          if (!analysis.needsReply && action.type === 'autoReply') {
            await log('rule-skipped', 'Automatic reply skipped: message does not need a reply')
            break
          }
          await produceReply({
            account,
            message: current(),
            analysis,
            conversation: input.conversation,
            instructions: action.instructions,
            ruleId,
            wantsAutoSend: action.type === 'autoReply',
            now,
          })
          break
        }
        case 'webhook': {
          await postWebhook(action.url, account, current(), analysis)
          await log('webhook', `Notified ${new URL(action.url).host}`)
          break
        }
        case 'move': {
          const path = renderFolderTemplate(action.folder, { message: current(), analysis }, account.settings.defaultLanguage)
          if (!path) break
          const folder = await ensureFolder(account, path, input.message.id)
          const message = current()
          if (message.folderId === folder.id) break
          const { providerId } = await mailbox.move(message, folder)
          await db.mutate((d) => {
            const m = d.messages.find((x) => x.id === message.id)
            if (m) {
              m.folderId = folder.id
              m.providerId = providerId
            }
          })
          await log('moved', `Filed in ${folder.path}`)
          break
        }
      }
    } catch (err) {
      await log('error', `${action.type} failed: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`)
    }
  }

  emit({ type: 'message', accountId: account.id, messageId: input.message.id })
}

/**
 * The folder at `path`, creating whatever levels are missing. Runs inside the
 * account's serial lane (see queue.ts), so two messages heading for the same
 * new folder cannot both create it.
 */
export async function ensureFolder(account: Account, path: string, messageId?: string): Promise<Folder> {
  const db = store()
  const mailbox = mailboxFor(account)
  const plan = planFolder(db.read.folders, account.id, path)

  let parent = plan.existing
  for (const name of plan.toCreate) {
    const created = await mailbox.createFolder(parent, name)
    const folder: Folder = { ...created, path: joinPath(parent, created.displayName) }
    await db.mutate((d) => {
      if (!d.folders.some((f) => f.id === folder.id)) d.folders.push(folder)
    })
    await db.log({ accountId: account.id, messageId, kind: 'folder-created', actor: 'agent', detail: `Created folder ${folder.path}` })
    parent = folder
  }
  if (!parent) throw new Error(`Empty folder path "${path}"`)
  return parent
}

/**
 * Outbound webhook for n8n, Power Automate or Zapier. Signed so the receiving
 * flow can verify it came from here: `X-Sendero-Signature: sha256=<hex>` over
 * the raw body. The message body is deliberately not included — the flow gets
 * the classification and enough to find the message in Graph, not a copy of
 * the mail.
 */
async function postWebhook(url: string, account: Account, message: MailMessage, analysis: Analysis): Promise<void> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') throw new Error('Webhook URLs must be https')

  const body = JSON.stringify({
    event: 'message.triaged',
    at: new Date().toISOString(),
    account: { id: account.id, address: account.address },
    message: {
      id: message.providerId,
      internetMessageId: message.internetMessageId,
      conversationId: message.conversationId,
      from: message.from,
      subject: message.subject,
      receivedAt: message.receivedAt,
    },
    analysis: {
      category: analysis.category,
      band: analysis.band,
      priority: analysis.priority,
      language: analysis.language,
      intent: analysis.intent,
      summary: analysis.summary,
      actionItems: analysis.actionItems,
      deadline: analysis.deadline,
      needsReply: analysis.needsReply,
    },
  })

  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': 'Sendero/0.8' }
  const secret = env().WEBHOOK_SIGNING_SECRET
  if (secret) headers['X-Sendero-Signature'] = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

  const res = await fetch(parsed, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`Webhook responded ${res.status}`)
}
