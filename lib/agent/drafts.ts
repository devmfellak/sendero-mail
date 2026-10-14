import { DRAFT_SYSTEM, draftUserPrompt } from '../ai/prompts'
import { routeDraft } from '../ai/router'
import { checkAutoReply, type GuardResult } from '../domain/guardrails'
import { stripQuoted } from '../domain/quoting'
import { buildThread, renderThread } from '../domain/thread'
import { replySubject } from '../mail/demo'
import { emit, mailboxFor, store } from '../runtime'
import { stableId } from '../store/store'
import type { Account, Analysis, Draft, Language, MailMessage } from '../types'

/**
 * Replies: generated, checked, placed in Outlook, and — only when every
 * guardrail passes — sent.
 *
 * A draft always exists in two places: the dashboard's approval queue, and the
 * mailbox's own Drafts folder (created with Graph's createReply, so it is
 * threaded and quotes the original exactly as Outlook would). The owner can
 * approve from the dashboard, or open Outlook — desktop, web or phone — edit
 * and press Send. Either way the next sync sees the sent message and closes
 * the loop.
 */

export interface DraftRequest {
  account: Account
  message: MailMessage
  analysis: Analysis
  conversation: MailMessage[]
  language?: Language
  instructions?: string
  ruleId: string | null
  /** The rule asked for an automatic reply. Guardrails still decide. */
  wantsAutoSend: boolean
  now: Date
}

export async function produceReply(req: DraftRequest): Promise<Draft | null> {
  const { account, message, analysis } = req
  const db = store()
  const language = req.language ?? analysis.language
  const signature = account.settings.signature[language]

  const thread = buildThread(req.conversation, message.id)
  const history = { ...thread, turns: thread.turns.slice(0, -1) }
  const focus = stripQuoted(message.bodyText)

  const routed = await routeDraft({
    system: DRAFT_SYSTEM,
    user: draftUserPrompt({
      language,
      tone: account.settings.tone,
      signature,
      knowledge: account.settings.knowledge,
      instructions: req.instructions,
      thread: history.turns.length ? renderThread(history) : '',
      focus,
      subject: message.subject,
      owner: `${account.displayName} <${account.address}>`,
    }),
    raw: {
      language,
      subject: message.subject,
      focus,
      senderName: message.from.name,
      signature,
      knowledge: account.settings.knowledge,
      category: analysis.category,
      instructions: req.instructions,
    },
  })
  const out = routed.data

  let guard: GuardResult = { decision: 'draft', reasons: ['Drafted for review'] }
  if (req.wantsAutoSend) {
    guard = checkAutoReply({
      settings: account.settings,
      analysis,
      message,
      draftBody: out.body,
      groundingText: [renderThread(thread), account.settings.knowledge, signature, message.from.name, message.from.address].join('\n'),
      sentLastHour: autoSentSince(account.id, new Date(req.now.getTime() - 3_600_000)),
      autoRepliedRecently: autoRepliedInConversation(account.id, message.conversationId, new Date(req.now.getTime() - 86_400_000)),
      now: req.now,
    })
    if (out.needsHumanInput && guard.decision !== 'skip') {
      guard = {
        decision: 'draft',
        reasons: [
          ...guard.reasons.filter((r) => r !== 'Drafted for review'),
          `Needs your input${out.missingInfo.length ? ` — ${out.missingInfo.join('; ')}` : ''}`,
        ],
      }
    }
  } else if (out.needsHumanInput && out.missingInfo.length) {
    guard = { decision: 'draft', reasons: [`Needs your input — ${out.missingInfo.join('; ')}`] }
  }

  if (guard.decision === 'skip') {
    await db.log({ accountId: account.id, messageId: message.id, ruleId: req.ruleId ?? undefined, kind: 'reply-blocked', actor: 'agent', detail: guard.reasons.join('; ') })
    return null
  }

  const mailbox = mailboxFor(account)
  const { providerDraftId } = await mailbox.createReplyDraft(message, out.body)

  const draft: Draft = {
    id: stableId('drf', `${message.id}:${db.read.drafts.filter((d) => d.messageId === message.id).length}`),
    accountId: account.id,
    messageId: message.id,
    conversationId: message.conversationId,
    language,
    subject: replySubject(message.subject),
    body: out.body,
    status: 'pending',
    reason: guard.reasons.join('; '),
    ruleId: req.ruleId,
    confidence: analysis.confidence,
    providerDraftId,
    model: `${routed.provider}/${routed.model}`,
    createdAt: req.now.toISOString(),
  }

  // Replace, never stack: one live draft per message, here and in Outlook.
  const superseded = db.read.drafts.filter((d) => d.messageId === message.id && d.status === 'pending')
  for (const old of superseded) {
    if (old.providerDraftId) await mailbox.deleteDraft(old.providerDraftId).catch(() => undefined)
  }
  await db.mutate((d) => {
    for (const old of d.drafts) {
      if (old.messageId === message.id && old.status === 'pending') {
        old.status = 'discarded'
        old.decidedAt = req.now.toISOString()
        old.decidedBy = 'superseded'
        old.providerDraftId = undefined
      }
    }
    d.drafts.push(draft)
  })

  if (guard.decision === 'send') {
    await mailbox.sendDraft(providerDraftId)
    await db.mutate((d) => {
      const x = d.drafts.find((y) => y.id === draft.id)!
      x.status = 'sent'
      x.reason = 'Sent automatically: every guardrail passed'
      x.decidedAt = req.now.toISOString()
      x.decidedBy = 'agent'
    })
    await db.log({ accountId: account.id, messageId: message.id, ruleId: req.ruleId ?? undefined, kind: 'reply-sent', actor: 'agent', detail: `Automatic ${language.toUpperCase()} reply to ${message.from.address}` })
  } else {
    await db.log({
      accountId: account.id,
      messageId: message.id,
      ruleId: req.ruleId ?? undefined,
      kind: req.wantsAutoSend ? 'reply-blocked' : 'draft-created',
      actor: 'agent',
      detail: req.wantsAutoSend ? `Held for approval — ${guard.reasons.join('; ')}` : `${language.toUpperCase()} draft saved to Outlook Drafts`,
    })
  }

  emit({ type: 'draft', accountId: account.id, draftId: draft.id, status: guard.decision === 'send' ? 'sent' : 'pending' })
  return db.read.drafts.find((d) => d.id === draft.id) ?? draft
}

/** A person approved a draft, possibly after editing it. */
export async function approveDraft(draftId: string, body: string | undefined, by: string): Promise<void> {
  const db = store()
  const draft = db.read.drafts.find((d) => d.id === draftId)
  if (!draft || draft.status !== 'pending') throw new Error('This draft is no longer pending')
  const account = db.read.accounts.find((a) => a.id === draft.accountId)
  const message = db.read.messages.find((m) => m.id === draft.messageId)
  if (!account || !message) throw new Error('Draft refers to a message that is gone')

  const mailbox = mailboxFor(account)
  let providerDraftId = draft.providerDraftId
  const edited = body !== undefined && body.trim() !== draft.body.trim()

  if (edited || !providerDraftId) {
    if (providerDraftId) await mailbox.deleteDraft(providerDraftId)
    providerDraftId = (await mailbox.createReplyDraft(message, body ?? draft.body)).providerDraftId
  }

  await db.mutate((d) => {
    const x = d.drafts.find((y) => y.id === draftId)!
    if (edited) x.body = body!.trim()
    x.providerDraftId = providerDraftId
  })
  await mailbox.sendDraft(providerDraftId!)

  const now = new Date().toISOString()
  await db.mutate((d) => {
    const x = d.drafts.find((y) => y.id === draftId)!
    x.status = 'sent'
    x.decidedAt = now
    x.decidedBy = by
  })
  await db.log({
    accountId: account.id,
    messageId: message.id,
    kind: 'reply-sent',
    actor: 'user',
    detail: `${by} approved${edited ? ' an edited' : ' the'} ${draft.language.toUpperCase()} reply to ${message.from.address}`,
  })
  emit({ type: 'draft', accountId: account.id, draftId, status: 'sent' })
}

export async function discardDraft(draftId: string, by: string): Promise<void> {
  const db = store()
  const draft = db.read.drafts.find((d) => d.id === draftId)
  if (!draft || draft.status !== 'pending') return
  const account = db.read.accounts.find((a) => a.id === draft.accountId)
  if (account && draft.providerDraftId) await mailboxFor(account).deleteDraft(draft.providerDraftId).catch(() => undefined)

  await db.mutate((d) => {
    const x = d.drafts.find((y) => y.id === draftId)!
    x.status = 'discarded'
    x.decidedAt = new Date().toISOString()
    x.decidedBy = by
  })
  await db.log({ accountId: draft.accountId, messageId: draft.messageId, kind: 'draft-discarded', actor: 'user', detail: `${by} discarded the draft` })
  emit({ type: 'draft', accountId: draft.accountId, draftId, status: 'discarded' })
}

function autoSentSince(accountId: string, since: Date): number {
  return store().read.drafts.filter(
    (d) => d.accountId === accountId && d.status === 'sent' && d.decidedBy === 'agent' && Date.parse(d.decidedAt ?? '') >= since.getTime(),
  ).length
}

function autoRepliedInConversation(accountId: string, conversationId: string, since: Date): boolean {
  return store().read.drafts.some(
    (d) =>
      d.accountId === accountId &&
      d.conversationId === conversationId &&
      d.status === 'sent' &&
      d.decidedBy === 'agent' &&
      Date.parse(d.decidedAt ?? '') >= since.getTime(),
  )
}
