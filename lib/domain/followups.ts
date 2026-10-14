import type { Analysis, FollowUp, MailMessage } from '../types'
import { stripQuoted } from './quoting'

/**
 * Follow-ups: conversations where the ball is in somebody's court and has
 * stayed there too long.
 *
 * Two directions, because both get dropped:
 *
 * - awaiting-us   — they wrote, the message needed a reply, nobody sent one.
 * - awaiting-them — we asked something and they went quiet.
 *
 * Derived from the conversation as it stands, not from timers set when the
 * mail arrived: a reply sent from a phone, outside this system, still closes
 * the loop, because the next sweep sees the outbound message and the
 * follow-up resolves itself.
 */

export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from)
  let remaining = Math.max(0, Math.floor(days))
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    const day = d.getUTCDay()
    if (day !== 0 && day !== 6) remaining--
  }
  return d
}

/** Does our outbound message ask the other side for something? */
export function asksForResponse(body: string): boolean {
  const text = stripQuoted(body).toLowerCase()
  if (text.includes('?') || text.includes('¿')) return true
  return [
    'let me know',
    'please confirm',
    'please send',
    'could you',
    'can you',
    'awaiting',
    'look forward to hearing',
    'get back to me',
    'quedo atento',
    'quedo atenta',
    'quedo pendiente',
    'por favor confirm',
    'me confirmas',
    'me confirma',
    'podría enviar',
    'podrías enviar',
    'espero su respuesta',
    'espero tu respuesta',
  ].some((phrase) => text.includes(phrase))
}

export interface FollowUpCandidate {
  kind: FollowUp['kind']
  message: MailMessage
  dueAt: Date
}

/**
 * The follow-up a conversation needs right now, if any. Only the latest
 * message matters: whoever wrote last is who is waiting.
 */
export function followUpFor(
  conversation: MailMessage[],
  analyses: Map<string, Pick<Analysis, 'needsReply' | 'category'>>,
  days: number,
): FollowUpCandidate | null {
  if (conversation.length === 0) return null
  const last = [...conversation].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0]!
  const dueAt = addBusinessDays(new Date(last.receivedAt), days)

  if (last.direction === 'inbound') {
    const analysis = analyses.get(last.id)
    if (!analysis?.needsReply) return null
    if (['newsletter', 'notification', 'spam'].includes(analysis.category)) return null
    return { kind: 'awaiting-us', message: last, dueAt }
  }

  return asksForResponse(last.bodyText) ? { kind: 'awaiting-them', message: last, dueAt } : null
}

export function isOverdue(followUp: Pick<FollowUp, 'dueAt' | 'status'>, now: Date): boolean {
  return followUp.status === 'open' && Date.parse(followUp.dueAt) <= now.getTime()
}
