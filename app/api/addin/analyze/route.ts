import * as z from 'zod/v4'
import { AddinAuthError, authenticateAddin } from '@/lib/addin/auth'
import { DRAFT_SYSTEM, TRIAGE_SYSTEM, draftUserPrompt, triageUserPrompt } from '@/lib/ai/prompts'
import { routeDraft, routeTriage } from '@/lib/ai/router'
import { resolveLanguage } from '@/lib/domain/language'
import { scorePriority } from '@/lib/domain/priority'
import { stripQuoted } from '@/lib/domain/quoting'
import { domainOf } from '@/lib/domain/rules'
import { store } from '@/lib/runtime'

export const dynamic = 'force-dynamic'

const Body = z.object({
  subject: z.string().max(500),
  from: z.object({ name: z.string().max(200), address: z.string().max(320) }),
  to: z.array(z.string().max(320)).max(100).default([]),
  body: z.string().max(40_000),
  receivedAt: z.string().max(40).optional(),
  language: z.enum(['en', 'es']).optional(),
  instructions: z.string().max(1000).optional(),
  wantDraft: z.boolean().default(true),
})

/**
 * Analysis and a draft for the message open in Outlook. Read-only with
 * respect to the mailbox: the pane inserts the draft into Outlook's own reply
 * form, and the person sends it.
 *
 * If the user's mailbox is also enrolled here, its settings (signature,
 * knowledge, tone, VIPs) are used; otherwise sensible defaults.
 */
export async function POST(request: Request): Promise<Response> {
  let caller
  try {
    caller = await authenticateAddin(request)
  } catch (err) {
    if (err instanceof AddinAuthError) return Response.json({ error: err.message }, { status: 401 })
    throw err
  }

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 })
  const input = parsed.data

  const enrolled =
    caller.mode === 'user'
      ? store().read.accounts.find((a) => a.address.toLowerCase() === caller.email.toLowerCase())
      : store().read.accounts[0]
  const settings = enrolled?.settings
  const ownAddress = caller.mode === 'user' ? caller.email : (enrolled?.address ?? '')
  const focus = stripQuoted(input.body)
  const receivedAt = input.receivedAt ?? new Date().toISOString()

  const triage = await routeTriage({
    system: TRIAGE_SYSTEM,
    user: triageUserPrompt({ focus, thread: '', receivedAt, from: `${input.from.name} <${input.from.address}>`, subject: input.subject }),
    raw: {
      subject: input.subject,
      focus,
      from: input.from.address,
      headers: {},
      receivedAt,
      internalSender: (settings?.internalDomains ?? [domainOf(ownAddress)]).includes(domainOf(input.from.address)),
    },
  })

  const t = triage.data
  const priority = scorePriority(
    { category: t.category, urgency: t.urgency, needsReply: t.needsReply, sentiment: t.sentiment, deadline: t.deadline },
    { accountId: '', from: input.from, to: input.to.map((address) => ({ name: '', address })), cc: [], importance: 'normal', headers: {} },
    { address: ownAddress, settings: { vipSenders: settings?.vipSenders ?? [] } },
    new Date(),
  )
  const detected = resolveLanguage(focus || input.subject, settings?.defaultLanguage ?? 'en')

  let draft = null
  if (input.wantDraft) {
    const language = input.language ?? detected
    const name = caller.mode === 'user' ? caller.name : (enrolled?.displayName ?? '')
    const signature = settings?.signature[language] || name
    const routed = await routeDraft({
      system: DRAFT_SYSTEM,
      user: draftUserPrompt({
        language,
        tone: settings?.tone ?? 'neutral',
        signature,
        knowledge: settings?.knowledge ?? '',
        instructions: input.instructions,
        thread: '',
        focus,
        subject: input.subject,
        owner: name || ownAddress,
      }),
      raw: {
        language,
        subject: input.subject,
        focus,
        senderName: input.from.name,
        signature,
        knowledge: settings?.knowledge ?? '',
        category: t.category,
        instructions: input.instructions,
      },
    })
    draft = { language, ...routed.data, model: `${routed.provider}/${routed.model}` }
  }

  return Response.json({
    analysis: {
      ...t,
      language: detected,
      priority: priority.score,
      band: priority.band,
      factors: priority.factors,
      model: `${triage.provider}/${triage.model}`,
    },
    draft,
    mode: caller.mode,
  })
}
