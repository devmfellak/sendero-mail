import type { AccountSettings, CategoryKey, MailMessage, PriorityBand, PriorityFactor } from '../types'

/**
 * Priority, explained.
 *
 * The model contributes one signal — how urgent the sender's words sound — and
 * the rest is arithmetic over facts the system knows for certain: who sent it,
 * whether we were addressed or copied, whether a deadline is near, whether it
 * is bulk mail. Every contribution is kept as a labelled factor so the
 * dashboard can say *why* something is urgent. A priority nobody can explain is
 * a priority nobody trusts, and an untrusted triage queue gets ignored.
 */

const CATEGORY_BASE: Record<CategoryKey, number> = {
  'client-request': 45,
  'sales-lead': 45,
  support: 40,
  billing: 40,
  legal: 45,
  scheduling: 35,
  hr: 35,
  vendor: 30,
  internal: 35,
  personal: 20,
  notification: 12,
  newsletter: 5,
  spam: 0,
}

export interface PriorityInput {
  category: CategoryKey
  /** 0–1 from the model. */
  urgency: number
  needsReply: boolean
  sentiment: 'positive' | 'neutral' | 'negative'
  deadline: string | null
}

export interface PriorityResult {
  score: number
  band: PriorityBand
  factors: PriorityFactor[]
}

export function scorePriority(
  input: PriorityInput,
  message: Pick<MailMessage, 'from' | 'to' | 'cc' | 'importance' | 'headers' | 'accountId'>,
  account: { address: string; settings: Pick<AccountSettings, 'vipSenders'> },
  now: Date,
): PriorityResult {
  const factors: PriorityFactor[] = []
  const add = (label: string, weight: number) => {
    if (weight !== 0) factors.push({ label, weight })
  }

  add(`Category: ${input.category}`, CATEGORY_BASE[input.category])
  add('Urgent wording', Math.round(Math.max(0, Math.min(1, input.urgency)) * 25))

  if (isVip(message.from.address, account.settings.vipSenders)) add('VIP sender', 25)
  if (input.needsReply) add('Awaiting our reply', 10)
  if (message.importance === 'high') add('Marked high importance', 8)
  if (message.importance === 'low') add('Marked low importance', -8)
  if (input.sentiment === 'negative') add('Unhappy tone', 8)

  const addressed = message.to.some((a) => sameAddress(a.address, account.address))
  const copied = message.cc.some((a) => sameAddress(a.address, account.address))
  if (!addressed && copied) add('Only copied', -10)

  if (input.deadline) {
    // "By the 4th" means by the end of the 4th, not its first minute.
    const due = /^\d{4}-\d{2}-\d{2}$/.test(input.deadline) ? `${input.deadline}T23:59:59Z` : input.deadline
    const hours = (Date.parse(due) - now.getTime()) / 3_600_000
    if (Number.isFinite(hours)) {
      if (hours < 0) add('Deadline passed', 20)
      else if (hours <= 24) add('Deadline within 24 h', 20)
      else if (hours <= 72) add('Deadline within 3 days', 10)
    }
  }

  if (isBulk(message.headers)) add('Bulk mail', -15)

  const raw = factors.reduce((sum, f) => sum + f.weight, 0)
  // Spam stays at the floor whatever else is true: urgent wording is what
  // phishing is made of, and it must not be what lifts it to the top.
  const score = input.category === 'spam' ? 0 : clamp(raw, 0, 100)

  return { score, band: bandFor(score), factors: factors.sort((a, b) => b.weight - a.weight) }
}

export function bandFor(score: number): PriorityBand {
  if (score >= 75) return 'urgent'
  if (score >= 55) return 'high'
  if (score >= 25) return 'normal'
  return 'low'
}

export function isVip(address: string, vips: string[]): boolean {
  const a = address.toLowerCase()
  return vips.some((v) => {
    const entry = v.trim().toLowerCase()
    if (!entry) return false
    return entry.startsWith('@') ? a.endsWith(entry) : a === entry
  })
}

export function isBulk(headers: Record<string, string>): boolean {
  const precedence = headers['precedence']?.toLowerCase()
  return Boolean(
    headers['list-unsubscribe'] ||
      headers['list-id'] ||
      precedence === 'bulk' ||
      precedence === 'list' ||
      precedence === 'junk',
  )
}

export function sameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}
