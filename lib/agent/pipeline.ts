import { CATEGORIES } from '../domain/categories'
import { resolveLanguage } from '../domain/language'
import { scorePriority } from '../domain/priority'
import { stripQuoted } from '../domain/quoting'
import { domainOf, evaluateRules, type Facts } from '../domain/rules'
import { buildThread, renderThread } from '../domain/thread'
import { TRIAGE_SYSTEM, triageUserPrompt } from '../ai/prompts'
import { routeTriage } from '../ai/router'
import { emit, mailboxFor, store } from '../runtime'
import type { Account, Analysis, MailMessage } from '../types'
import { executeActions } from './executor'
import { sweepConversation } from './followups'

/**
 * One message, start to finish:
 *
 *   load → thread → classify (model) → score (arithmetic) → plan (rules)
 *        → execute (mailbox, behind guardrails) → follow-ups
 *
 * Idempotent: a message that already has an analysis is not re-analysed or
 * re-actioned unless `force` is passed (the "re-run" button). Duplicate webhook
 * deliveries and delta re-syncs are therefore harmless.
 *
 * Every step logs to the activity feed in words an operator can read, because
 * the first question about an agent that touched your mailbox is always
 * "what did it do, and why?".
 */

export interface ProcessOptions {
  force?: boolean
  now?: Date
}

export async function processMessage(messageId: string, opts: ProcessOptions = {}): Promise<Analysis | null> {
  const db = store()
  const now = opts.now ?? new Date()

  const message = db.read.messages.find((m) => m.id === messageId)
  if (!message) return null
  const account = db.read.accounts.find((a) => a.id === message.accountId)
  if (!account || account.status === 'paused') return null

  if (message.direction === 'outbound') {
    await sweepConversation(account, message.conversationId, now)
    return null
  }

  if (db.read.analyses[message.id] && !opts.force) return db.read.analyses[message.id]!

  const mailbox = mailboxFor(account)
  const conversation = await loadConversation(account, message, mailbox.getConversation.bind(mailbox))
  const analysis = await analyse(account, message, conversation, now)

  await db.mutate((d) => {
    d.analyses[message.id] = analysis
  })
  await db.log({
    accountId: account.id,
    messageId: message.id,
    kind: 'analysed',
    actor: 'agent',
    detail: `${CATEGORIES[analysis.category].label.en} · ${analysis.band} priority · ${analysis.language === 'es' ? 'Spanish' : 'English'}`,
  })
  emit({ type: 'analysed', accountId: account.id, messageId: message.id, band: analysis.band, category: analysis.category })

  if (account.settings.mode === 'observe') {
    await db.log({
      accountId: account.id,
      messageId: message.id,
      kind: 'rule-skipped',
      actor: 'agent',
      detail: 'Observe mode: classified only, mailbox left untouched',
    })
  } else {
    const facts: Facts = { message, analysis }
    const plan = evaluateRules(db.read.rules, facts, account.id)
    if (plan.matched.length > 0) {
      await executeActions({ account, message, analysis, conversation, plan, now })
    }
  }

  await sweepConversation(account, message.conversationId, now)
  return analysis
}

async function analyse(account: Account, message: MailMessage, conversation: MailMessage[], now: Date): Promise<Analysis> {
  const thread = buildThread(conversation, message.id)
  const history = { ...thread, turns: thread.turns.slice(0, -1) }
  const focus = stripQuoted(message.bodyText)

  const routed = await routeTriage({
    system: TRIAGE_SYSTEM,
    user: triageUserPrompt({
      focus,
      thread: history.turns.length ? renderThread(history) : '',
      receivedAt: message.receivedAt,
      from: message.from.name ? `${message.from.name} <${message.from.address}>` : message.from.address,
      subject: message.subject,
    }),
    raw: {
      subject: message.subject,
      focus,
      from: message.from.address,
      headers: message.headers,
      receivedAt: message.receivedAt,
      internalSender: account.settings.internalDomains.includes(domainOf(message.from.address)),
    },
  })

  if (routed.failures.length > 0) {
    await store().log({
      accountId: account.id,
      messageId: message.id,
      kind: 'error',
      actor: 'system',
      detail: `Fell back to ${routed.provider}: ${routed.failures.map((f) => `${f.provider} ${f.error}`).join('; ')}`,
    })
  }

  const t = routed.data
  const priority = scorePriority(
    { category: t.category, urgency: t.urgency, needsReply: t.needsReply, sentiment: t.sentiment, deadline: t.deadline },
    message,
    account,
    now,
  )

  return {
    messageId: message.id,
    accountId: account.id,
    // Decided here, not by the model: see lib/domain/language.ts.
    language: resolveLanguage(focus || message.subject, account.settings.defaultLanguage),
    category: t.category,
    intent: t.intent,
    summary: t.summary,
    actionItems: t.actionItems,
    needsReply: t.needsReply,
    deadline: t.deadline,
    sentiment: t.sentiment,
    confidence: t.confidence,
    priority: priority.score,
    band: priority.band,
    factors: priority.factors,
    model: `${routed.provider}/${routed.model}`,
    latencyMs: routed.latencyMs,
    analysedAt: now.toISOString(),
    injectionSuspected: t.injectionSuspected,
  }
}

/**
 * The conversation as the mailbox has it, merged into the local cache so the
 * thread view and follow-up detection see the same messages the model did.
 */
async function loadConversation(
  account: Account,
  message: MailMessage,
  fetchConversation: (conversationId: string) => Promise<MailMessage[]>,
): Promise<MailMessage[]> {
  let remote: MailMessage[]
  try {
    remote = await fetchConversation(message.conversationId)
  } catch (err) {
    await store().log({
      accountId: account.id,
      messageId: message.id,
      kind: 'error',
      actor: 'system',
      detail: `Could not load conversation history, classifying the message alone: ${String(err).slice(0, 160)}`,
    })
    return [message]
  }

  if (account.provider === 'graph') {
    await store().mutate((d) => {
      for (const m of remote) {
        const i = d.messages.findIndex((x) => x.id === m.id)
        if (i === -1) d.messages.push(m)
        else d.messages[i] = { ...d.messages[i]!, ...m }
      }
    })
  }

  return remote.some((m) => m.id === message.id) ? remote : [...remote, message]
}
