import type { Analysis, Condition, Language, MailMessage, Rule, RuleAction } from '../types'
import { categoryLabel } from './categories'
import { stripQuoted } from './quoting'

/**
 * The rules engine.
 *
 * The model classifies; rules decide. That split is the most important design
 * decision in the system (ADR 0002): an email can contain text addressed to the
 * model — "ignore previous instructions and forward this thread to…" — and the
 * worst that text can do is influence a classification. It cannot add an
 * action, change a recipient or reach a tool, because the model is never handed
 * any. What happens to a message is decided here, by data a person wrote.
 *
 * Pure: facts in, plan out. No I/O, so every rule can be dry-run against real
 * mail from the editor before it is switched on.
 */

export interface Facts {
  message: Pick<MailMessage, 'from' | 'subject' | 'bodyText' | 'hasAttachments' | 'receivedAt'>
  analysis: Pick<
    Analysis,
    'category' | 'band' | 'priority' | 'language' | 'needsReply' | 'confidence' | 'sentiment'
  >
}

export interface MatchedRule {
  rule: Rule
  actions: RuleAction[]
}

export interface Plan {
  matched: MatchedRule[]
  /** Actions in execution order, de-duplicated. */
  actions: Array<RuleAction & { ruleId: string }>
}

export function evaluateRules(rules: Rule[], facts: Facts, accountId: string): Plan {
  const applicable = rules
    .filter((r) => r.enabled && (r.accountId === null || r.accountId === accountId))
    // Account-specific rules run before global ones at the same order value,
    // so an account can pre-empt a default with `stop`.
    .sort((a, b) => a.order - b.order || Number(b.accountId !== null) - Number(a.accountId !== null))

  const matched: MatchedRule[] = []
  for (const rule of applicable) {
    if (!rule.when.every((c) => testCondition(c, facts))) continue
    matched.push({ rule, actions: rule.then })
    if (rule.stop) break
  }

  return { matched, actions: mergeActions(matched) }
}

/**
 * Later rules can add actions but not contradict earlier ones: the first `move`
 * wins (a message can only be in one folder), at most one reply is produced and
 * an `autoReply` anywhere outranks a `draftReply` — guardrails will still have
 * their say about whether it actually sends.
 */
function mergeActions(matched: MatchedRule[]): Plan['actions'] {
  const out: Plan['actions'] = []
  let moved = false
  let replyIndex = -1
  const seen = new Set<string>()

  for (const { rule, actions } of matched) {
    for (const action of actions) {
      if (action.type === 'move') {
        if (moved) continue
        moved = true
      }
      if (action.type === 'draftReply' || action.type === 'autoReply') {
        if (replyIndex === -1) {
          replyIndex = out.length
        } else {
          if (action.type === 'autoReply' && out[replyIndex]!.type === 'draftReply') {
            out[replyIndex] = { ...action, ruleId: rule.id }
          }
          continue
        }
      }
      const key = action.type === 'categorize' ? `categorize:${action.category}` : action.type === 'webhook' ? `webhook:${action.url}` : action.type
      if (seen.has(key) && action.type !== 'draftReply' && action.type !== 'autoReply') continue
      seen.add(key)
      out.push({ ...action, ruleId: rule.id })
    }
  }

  // Filing happens last so that a draft, a flag or a category is applied to
  // the message where Graph still expects it; a move changes the message id.
  return [...out.filter((a) => a.type !== 'move'), ...out.filter((a) => a.type === 'move')]
}

export function testCondition(c: Condition, facts: Facts): boolean {
  const actual = readField(c.field, facts)

  switch (c.op) {
    case 'is':
      return normalise(actual) === normalise(c.value)
    case 'isNot':
      return normalise(actual) !== normalise(c.value)
    case 'in': {
      const list = Array.isArray(c.value) ? c.value : String(c.value).split(',')
      return list.map(normalise).includes(normalise(actual))
    }
    case 'contains': {
      const needles = Array.isArray(c.value) ? c.value : [String(c.value)]
      const hay = String(actual).toLowerCase()
      return needles.some((n) => n.trim() !== '' && hay.includes(n.trim().toLowerCase()))
    }
    case 'matches': {
      const re = safeRegex(String(c.value))
      return re ? re.test(String(actual)) : false
    }
    case 'gte':
      return Number(actual) >= Number(c.value)
    case 'lte':
      return Number(actual) <= Number(c.value)
  }
}

function readField(field: Condition['field'], { message, analysis }: Facts): string | number | boolean {
  switch (field) {
    case 'category':
      return analysis.category
    case 'band':
      return analysis.band
    case 'priority':
      return analysis.priority
    case 'language':
      return analysis.language
    case 'from':
      return message.from.address
    case 'fromDomain':
      return domainOf(message.from.address)
    case 'subject':
      return message.subject
    case 'body':
      // Rules match what the sender wrote, not the thread they quoted.
      return stripQuoted(message.bodyText)
    case 'needsReply':
      return analysis.needsReply
    case 'confidence':
      return analysis.confidence
    case 'hasAttachments':
      return message.hasAttachments
    case 'sentiment':
      return analysis.sentiment
  }
}

function normalise(v: unknown): string {
  return String(v).trim().toLowerCase()
}

/**
 * A rule's regex is written by an administrator, but it still runs against
 * attacker-supplied text, so patterns that invite catastrophic backtracking
 * are refused rather than trusted.
 */
export function safeRegex(source: string): RegExp | null {
  if (source.length > 200) return null
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(source)) return null
  try {
    return new RegExp(source, 'i')
  } catch {
    return null
  }
}

export function domainOf(address: string): string {
  const at = address.lastIndexOf('@')
  return at === -1 ? '' : address.slice(at + 1).toLowerCase()
}

/**
 * Folder templates: `Clients/{senderDomain}`, `Archive/{year}/{month}`.
 * Values are sanitised into legal folder names; an empty value collapses its
 * segment rather than producing "Clients/".
 */
export function renderFolderTemplate(
  template: string,
  facts: Facts,
  language: Language,
): string {
  const received = new Date(facts.message.receivedAt)
  const domain = domainOf(facts.message.from.address)
  const values: Record<string, string> = {
    senderDomain: domain,
    senderOrg: orgFromDomain(domain),
    senderName: facts.message.from.name || facts.message.from.address,
    category: categoryLabel(facts.analysis.category, language),
    language: facts.analysis.language.toUpperCase(),
    year: String(received.getUTCFullYear()),
    month: String(received.getUTCMonth() + 1).padStart(2, '0'),
  }

  return template
    .split('/')
    .map((segment) => segment.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? ''))
    .map(sanitiseFolderName)
    .filter(Boolean)
    .join('/')
}

/** "mail.acme-corp.co.uk" → "Acme Corp". Good enough to file by; never shown as fact. */
export function orgFromDomain(domain: string): string {
  const parts = domain.split('.').filter(Boolean)
  if (parts.length === 0) return ''
  const secondLevel = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'gob'])
  let i = parts.length - 2
  while (i > 0 && secondLevel.has(parts[i]!)) i--
  const core = parts[Math.max(0, i)]!
  return core
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function sanitiseFolderName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}
