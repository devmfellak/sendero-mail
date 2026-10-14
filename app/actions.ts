'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import * as z from 'zod/v4'
import { approveDraft, discardDraft, produceReply } from '@/lib/agent/drafts'
import { enqueueMessage } from '@/lib/agent/worker'
import { evaluateRules, renderFolderTemplate } from '@/lib/domain/rules'
import { store, emit } from '@/lib/runtime'
import { id } from '@/lib/store/store'
import type { Condition, Rule, RuleAction } from '@/lib/types'

/**
 * Every mutation the dashboard can make. Each validates its input with Zod —
 * a Server Action is a public POST endpoint whatever the form looks like — and
 * each records who did it in the activity log.
 */

const OPERATOR = 'Operator'

export async function approveDraftAction(formData: FormData): Promise<{ error?: string }> {
  const draftId = String(formData.get('draftId') ?? '')
  const body = formData.get('body')
  try {
    await approveDraft(draftId, typeof body === 'string' ? body : undefined, OPERATOR)
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
  revalidatePath('/', 'layout')
  return {}
}

export async function discardDraftAction(formData: FormData): Promise<void> {
  await discardDraft(String(formData.get('draftId') ?? ''), OPERATOR)
  revalidatePath('/', 'layout')
}

const DraftRequest = z.object({
  messageId: z.string().min(1),
  language: z.enum(['en', 'es']).optional(),
  instructions: z.string().max(1000).optional(),
})

export async function requestDraftAction(formData: FormData): Promise<{ error?: string }> {
  const parsed = DraftRequest.safeParse({
    messageId: formData.get('messageId'),
    language: formData.get('language') || undefined,
    instructions: (formData.get('instructions') as string | null)?.trim() || undefined,
  })
  if (!parsed.success) return { error: 'Invalid request' }

  const db = store()
  const message = db.read.messages.find((m) => m.id === parsed.data.messageId)
  const analysis = message && db.read.analyses[message.id]
  const account = message && db.read.accounts.find((a) => a.id === message.accountId)
  if (!message || !analysis || !account) return { error: 'The message has not been analysed yet' }

  try {
    await produceReply({
      account,
      message,
      analysis,
      conversation: db.read.messages.filter((m) => m.accountId === account.id && m.conversationId === message.conversationId),
      language: parsed.data.language,
      instructions: parsed.data.instructions,
      ruleId: null,
      wantsAutoSend: false,
      now: new Date(),
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
  revalidatePath('/', 'layout')
  return {}
}

export async function rerunAction(formData: FormData): Promise<void> {
  const messageId = String(formData.get('messageId') ?? '')
  const message = store().read.messages.find((m) => m.id === messageId)
  if (message) enqueueMessage(message.accountId, message.id, { force: true })
  revalidatePath(`/inbox/${encodeURIComponent(messageId)}`)
}

export async function followUpAction(formData: FormData): Promise<void> {
  const followUpId = String(formData.get('id') ?? '')
  const op = String(formData.get('op') ?? '')
  await store().mutate((d) => {
    const f = d.followUps.find((x) => x.id === followUpId)
    if (!f) return
    if (op === 'done') f.status = 'done'
    if (op === 'snooze') {
      f.dueAt = new Date(Date.now() + 2 * 86_400_000).toISOString()
    }
  })
  if (op === 'done') {
    await store().log({ accountId: null, kind: 'follow-up-closed', actor: 'user', detail: `${OPERATOR} marked a follow-up done` })
  }
  revalidatePath('/', 'layout')
}

/* ------------------------------------------------------------- rules -- */

const ConditionSchema = z.object({
  field: z.enum(['category', 'band', 'priority', 'language', 'from', 'fromDomain', 'subject', 'body', 'needsReply', 'confidence', 'hasAttachments', 'sentiment']),
  op: z.enum(['is', 'isNot', 'in', 'contains', 'matches', 'gte', 'lte']),
  value: z.union([z.string().max(300), z.number(), z.boolean(), z.array(z.string().max(100)).max(30)]),
})

const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), folder: z.string().min(1).max(200) }),
  z.object({ type: z.literal('categorize'), category: z.string().min(1).max(60) }),
  z.object({ type: z.literal('flag') }),
  z.object({ type: z.literal('markRead') }),
  z.object({ type: z.literal('draftReply'), instructions: z.string().max(1000).optional() }),
  z.object({ type: z.literal('autoReply'), instructions: z.string().max(1000).optional() }),
  z.object({ type: z.literal('followUp'), days: z.number().int().min(1).max(30).optional() }),
  z.object({ type: z.literal('webhook'), url: z.url({ protocol: /^https$/ }) }),
])

const RuleSchema = z.object({
  id: z.string().optional(),
  accountId: z.string().nullable(),
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  order: z.number().int().min(0).max(1000),
  stop: z.boolean(),
  when: z.array(ConditionSchema).max(12),
  then: z.array(ActionSchema).min(1).max(10),
})

export type RuleInput = z.infer<typeof RuleSchema>

export async function saveRuleAction(input: RuleInput): Promise<{ error?: string; id?: string }> {
  const parsed = RuleSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  const r = parsed.data
  const now = new Date().toISOString()
  const ruleId = r.id ?? id('rule')

  await store().mutate((d) => {
    const rule: Rule = { ...r, id: ruleId, when: r.when as Condition[], then: r.then as RuleAction[], updatedAt: now }
    const i = d.rules.findIndex((x) => x.id === ruleId)
    if (i === -1) d.rules.push(rule)
    else d.rules[i] = rule
  })
  await store().log({ accountId: r.accountId, ruleId, kind: 'sync', actor: 'user', detail: `${OPERATOR} ${input.id ? 'updated' : 'created'} rule "${r.name}"` })
  revalidatePath('/rules')
  return { id: ruleId }
}

export async function toggleRuleAction(formData: FormData): Promise<void> {
  const ruleId = String(formData.get('id') ?? '')
  await store().mutate((d) => {
    const r = d.rules.find((x) => x.id === ruleId)
    if (r) {
      r.enabled = !r.enabled
      r.updatedAt = new Date().toISOString()
    }
  })
  revalidatePath('/rules')
}

export async function deleteRuleAction(formData: FormData): Promise<void> {
  const ruleId = String(formData.get('id') ?? '')
  const rule = store().read.rules.find((r) => r.id === ruleId)
  await store().mutate((d) => {
    d.rules = d.rules.filter((r) => r.id !== ruleId)
  })
  if (rule) await store().log({ accountId: rule.accountId, kind: 'sync', actor: 'user', detail: `${OPERATOR} deleted rule "${rule.name}"` })
  revalidatePath('/rules')
  redirect('/rules')
}

/**
 * What a rule would do to recent mail, without doing it. Evaluated in
 * isolation — just this rule — against messages that already have an analysis.
 */
export async function previewRuleAction(input: RuleInput): Promise<{
  error?: string
  matches?: Array<{ id: string; subject: string; from: string; account: string; actions: string[] }>
  scanned?: number
}> {
  const parsed = RuleSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  const rule: Rule = { ...parsed.data, id: 'preview', enabled: true, when: parsed.data.when as Condition[], then: parsed.data.then as RuleAction[], updatedAt: '' }

  const d = store().read
  const candidates = d.messages
    .filter((m) => m.direction === 'inbound' && d.analyses[m.id] && (rule.accountId === null || m.accountId === rule.accountId))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    .slice(0, 300)

  const matches = []
  for (const m of candidates) {
    const analysis = d.analyses[m.id]!
    const account = d.accounts.find((a) => a.id === m.accountId)!
    const plan = evaluateRules([rule], { message: m, analysis }, m.accountId)
    if (plan.matched.length === 0) continue
    matches.push({
      id: m.id,
      subject: m.subject,
      from: m.from.address,
      account: account.displayName,
      actions: plan.actions.map((a) =>
        a.type === 'move' ? `move → ${renderFolderTemplate(a.folder, { message: m, analysis }, account.settings.defaultLanguage)}` : a.type,
      ),
    })
  }
  return { matches: matches.slice(0, 25), scanned: candidates.length }
}

/* ---------------------------------------------------------- accounts -- */

const SettingsSchema = z.object({
  accountId: z.string(),
  mode: z.enum(['observe', 'assist', 'auto']),
  autoReplyMinConfidence: z.coerce.number().min(0.5).max(1),
  maxAutoRepliesPerHour: z.coerce.number().int().min(0).max(500),
  quietStart: z.coerce.number().int().min(0).max(23).nullable(),
  quietEnd: z.coerce.number().int().min(0).max(23).nullable(),
  timeZone: z.string().min(1).max(60),
  defaultLanguage: z.enum(['en', 'es']),
  tone: z.enum(['warm', 'neutral', 'formal']),
  followUpDays: z.coerce.number().int().min(1).max(30),
  vipSenders: z.string().max(4000),
  internalDomains: z.string().max(2000),
  signatureEn: z.string().max(1000),
  signatureEs: z.string().max(1000),
  knowledge: z.string().max(12000),
  status: z.enum(['connected', 'paused']).optional(),
})

export async function saveSettingsAction(_: unknown, formData: FormData): Promise<{ error?: string; ok?: boolean }> {
  const raw = Object.fromEntries(formData.entries())
  const parsed = SettingsSchema.safeParse({
    ...raw,
    quietStart: raw.quietStart === '' ? null : raw.quietStart,
    quietEnd: raw.quietEnd === '' ? null : raw.quietEnd,
    status: raw.paused === 'on' ? 'paused' : 'connected',
  })
  if (!parsed.success) return { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  const s = parsed.data

  try {
    new Intl.DateTimeFormat('en', { timeZone: s.timeZone })
  } catch {
    return { error: `Unknown time zone "${s.timeZone}"` }
  }

  const list = (v: string) => [...new Set(v.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))]
  let previousMode = ''

  await store().mutate((d) => {
    const a = d.accounts.find((x) => x.id === s.accountId)
    if (!a) return
    previousMode = a.settings.mode
    a.settings = {
      ...a.settings,
      mode: s.mode,
      autoReplyMinConfidence: s.autoReplyMinConfidence,
      maxAutoRepliesPerHour: s.maxAutoRepliesPerHour,
      quietHours: s.quietStart !== null && s.quietEnd !== null ? { start: s.quietStart, end: s.quietEnd } : null,
      timeZone: s.timeZone,
      defaultLanguage: s.defaultLanguage,
      tone: s.tone,
      followUpDays: s.followUpDays,
      vipSenders: list(s.vipSenders),
      internalDomains: list(s.internalDomains),
      signature: { en: s.signatureEn.trim(), es: s.signatureEs.trim() },
      knowledge: s.knowledge.trim(),
    }
    if (a.status === 'connected' || a.status === 'paused') a.status = s.status ?? 'connected'
  })

  await store().log({
    accountId: s.accountId,
    kind: 'sync',
    actor: 'user',
    detail: previousMode && previousMode !== s.mode ? `${OPERATOR} switched mode ${previousMode} → ${s.mode}` : `${OPERATOR} updated mailbox settings`,
  })
  emit({ type: 'account', accountId: s.accountId })
  revalidatePath('/', 'layout')
  return { ok: true }
}
