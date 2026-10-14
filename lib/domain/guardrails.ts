import type { AccountSettings, Analysis, MailMessage } from '../types'
import { NEVER_AUTO_REPLY } from './categories'

/**
 * Whether a reply may leave without a person looking at it.
 *
 * Every check is independent and every failure is reported, not just the
 * first: the approval queue shows the complete list of reasons, which is what
 * lets an operator decide whether to loosen a setting or keep the gate. A
 * failed check never discards the reply — it downgrades it to a draft. The
 * exception is mail that should not be answered at all (auto-responders,
 * no-reply senders), where a draft would only be noise.
 *
 * Pure, and deliberately conservative. The cost asymmetry is large: a draft
 * that could have been sent costs a click; a reply that should not have been
 * sent costs a client.
 */

export type GuardDecision = 'send' | 'draft' | 'skip'

export interface GuardInput {
  settings: AccountSettings
  analysis: Pick<Analysis, 'category' | 'confidence' | 'injectionSuspected' | 'needsReply'>
  message: Pick<MailMessage, 'from' | 'headers' | 'conversationId'>
  draftBody: string
  /** Everything the reply may legitimately repeat: the thread, the knowledge base, the signature. */
  groundingText: string
  /** Automatic sends from this account in the last 60 minutes. */
  sentLastHour: number
  /** Whether we already auto-replied in this conversation in the last 24 hours. */
  autoRepliedRecently: boolean
  now: Date
}

export interface GuardResult {
  decision: GuardDecision
  reasons: string[]
}

export function checkAutoReply(input: GuardInput): GuardResult {
  const { settings, analysis, message } = input

  if (isAutomatedSender(message.from.address, message.headers)) {
    return {
      decision: 'skip',
      reasons: ['Sender is automated (auto-submitted, bulk or no-reply); replying would start a mail loop'],
    }
  }

  const reasons: string[] = []

  if (settings.mode !== 'auto') {
    reasons.push(`Account is in ${settings.mode} mode — automatic sending is off`)
  }
  if (NEVER_AUTO_REPLY.has(analysis.category)) {
    reasons.push(`"${analysis.category}" mail is always reviewed by a person`)
  }
  if (analysis.confidence < settings.autoReplyMinConfidence) {
    reasons.push(
      `Classification confidence ${pct(analysis.confidence)} is below the account threshold of ${pct(settings.autoReplyMinConfidence)}`,
    )
  }
  if (analysis.injectionSuspected) {
    reasons.push('The message appears to contain instructions aimed at an AI assistant')
  }
  if (input.autoRepliedRecently) {
    reasons.push('Already replied automatically in this conversation within 24 hours')
  }
  if (input.sentLastHour >= settings.maxAutoRepliesPerHour) {
    reasons.push(`Hourly limit of ${settings.maxAutoRepliesPerHour} automatic replies reached`)
  }
  if (settings.quietHours && inQuietHours(input.now, settings.quietHours, settings.timeZone)) {
    reasons.push(
      `Inside quiet hours (${hh(settings.quietHours.start)}–${hh(settings.quietHours.end)} ${settings.timeZone})`,
    )
  }

  const body = input.draftBody.trim()
  if (body.length < 20) reasons.push('Reply is empty or too short to be meaningful')
  if (body.length > 4000) reasons.push('Reply is unusually long for an automatic answer')

  const novel = findUngroundedEntities(body, input.groundingText)
  if (novel.length > 0) {
    reasons.push(`Reply mentions details not found in the thread or knowledge base: ${novel.slice(0, 4).join(', ')}`)
  }

  return { decision: reasons.length === 0 ? 'send' : 'draft', reasons }
}

/**
 * Links, addresses, phone numbers and amounts that appear in the reply but
 * nowhere in what the reply was allowed to draw on.
 *
 * This is the guard against both failure modes that matter: the model
 * inventing a price or a phone number, and a prompt-injected message
 * persuading it to include an attacker's link. Neither can be distinguished
 * from a correct answer by reading tone; both are caught by asking "where did
 * this come from?".
 */
export function findUngroundedEntities(reply: string, grounding: string): string[] {
  const source = normaliseForMatch(grounding)
  const found = new Set<string>()

  const patterns: RegExp[] = [
    /\bhttps?:\/\/[^\s<>)"']+/gi,
    /\bwww\.[^\s<>)"']+/gi,
    /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
    /(?:\+?\d[\d\s().-]{7,}\d)/g,
    /(?:[$€£]\s?\d[\d.,]*|\d[\d.,]*\s?(?:USD|EUR|GBP|MXN|€|dólares|euros|pesos))/gi,
  ]

  for (const pattern of patterns) {
    for (const match of reply.match(pattern) ?? []) {
      const token = match.replace(/[.,;:!?]+$/, '')
      if (!source.includes(normaliseForMatch(token))) found.add(token)
    }
  }
  return [...found]
}

export function isAutomatedSender(address: string, headers: Record<string, string>): boolean {
  const auto = headers['auto-submitted']?.toLowerCase()
  if (auto && auto !== 'no') return true
  if (headers['x-auto-response-suppress']) return true
  const precedence = headers['precedence']?.toLowerCase()
  if (precedence === 'bulk' || precedence === 'junk' || precedence === 'list') return true
  if (headers['list-unsubscribe'] || headers['list-id']) return true
  return /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|bounce[s]?)([+.-].*)?@/i.test(address)
}

export function inQuietHours(now: Date, quiet: { start: number; end: number }, timeZone: string): boolean {
  const hour = localHour(now, timeZone)
  if (quiet.start === quiet.end) return false
  // A window that wraps midnight, e.g. 20:00–07:00.
  return quiet.start < quiet.end
    ? hour >= quiet.start && hour < quiet.end
    : hour >= quiet.start || hour < quiet.end
}

export function localHour(now: Date, timeZone: string): number {
  try {
    const formatted = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone }).format(now)
    return Number(formatted)
  } catch {
    return now.getUTCHours()
  }
}

function normaliseForMatch(s: string): string {
  return s.toLowerCase().replace(/[\s().-]/g, '')
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

function hh(h: number): string {
  return `${String(h).padStart(2, '0')}:00`
}
