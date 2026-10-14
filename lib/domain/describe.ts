import type { Condition, RuleAction } from '../types'
import { CATEGORIES } from './categories'

/** Rules in words, for the list view. "When category is Billing and language is ES". */

const FIELD: Record<Condition['field'], string> = {
  category: 'category',
  band: 'priority band',
  priority: 'priority score',
  language: 'language',
  from: 'sender',
  fromDomain: 'sender domain',
  subject: 'subject',
  body: 'body',
  needsReply: 'needs a reply',
  confidence: 'confidence',
  hasAttachments: 'has attachments',
  sentiment: 'tone',
}

const OP: Record<Condition['op'], string> = {
  is: 'is',
  isNot: 'is not',
  in: 'is one of',
  contains: 'contains',
  matches: 'matches',
  gte: '≥',
  lte: '≤',
}

export function describeCondition(c: Condition): string {
  const value = (v: Condition['value']): string => {
    if (Array.isArray(v)) return v.map((x) => value(x)).join(', ')
    if (c.field === 'category' && typeof v === 'string' && v in CATEGORIES) return CATEGORIES[v as keyof typeof CATEGORIES].label.en
    if (typeof v === 'boolean') return v ? 'yes' : 'no'
    return String(v)
  }
  if (c.field === 'needsReply' || c.field === 'hasAttachments') {
    const yes = (c.op === 'is') === Boolean(c.value)
    return yes ? FIELD[c.field] : `not ${FIELD[c.field]}`
  }
  return `${FIELD[c.field]} ${OP[c.op]} “${value(c.value)}”`
}

export function describeAction(a: RuleAction): string {
  switch (a.type) {
    case 'move':
      return `file in “${a.folder}”`
    case 'categorize':
      return a.category === '{category}' ? 'colour by category' : `mark “${a.category}”`
    case 'flag':
      return 'flag'
    case 'markRead':
      return 'mark read'
    case 'draftReply':
      return 'draft a reply'
    case 'autoReply':
      return 'reply automatically (if guardrails pass)'
    case 'followUp':
      return `follow up after ${a.days ?? 'the default'} day(s)`
    case 'webhook':
      return `notify ${safeHost(a.url)}`
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
