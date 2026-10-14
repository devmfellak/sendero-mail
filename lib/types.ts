/**
 * The vocabulary of the system.
 *
 * Everything that crosses a layer boundary is one of these shapes. They are
 * plain data — no classes, no methods — so they serialise to the store, to the
 * browser and to the server-sent event stream without a mapping layer, and so a
 * test can build one with an object literal.
 */

export type Language = 'en' | 'es'

export type ProviderKind = 'demo' | 'graph'

/**
 * How much the agent is allowed to do on an account.
 *
 * - observe: analyse and report. Nothing in the mailbox changes.
 * - assist:  file, categorise and flag; replies are drafted and wait for a person.
 * - auto:    as assist, and rules may send replies that pass every guardrail.
 *
 * The mode is a ceiling, not a default: a rule that asks for an automatic reply
 * on an account in `assist` mode produces a draft, and says so.
 */
export type AutomationMode = 'observe' | 'assist' | 'auto'

export interface Address {
  name: string
  address: string
}

export interface AccountSettings {
  mode: AutomationMode
  /** Below this the model's own confidence downgrades an auto-reply to a draft. */
  autoReplyMinConfidence: number
  /** Hard ceiling on messages sent without a person, per rolling hour. */
  maxAutoRepliesPerHour: number
  /** Local hours during which nothing is sent automatically. 24h clock, end exclusive. */
  quietHours: { start: number; end: number } | null
  timeZone: string
  /** Domains treated as "us". Auto-replies outside them need the rule to opt in. */
  internalDomains: string[]
  /** Senders whose mail is always top priority. Addresses or @domains. */
  vipSenders: string[]
  defaultLanguage: Language
  /** Business days before an unanswered message becomes a follow-up. */
  followUpDays: number
  signature: { en: string; es: string }
  /**
   * Facts the drafting model may rely on: opening hours, policies, links. Not
   * instructions. Anything a reply asserts that is not here or in the thread is
   * treated as invented and blocks an automatic send.
   */
  knowledge: string
  tone: 'warm' | 'neutral' | 'formal'
}

export interface Account {
  id: string
  displayName: string
  address: string
  provider: ProviderKind
  color: string
  status: 'connected' | 'needs-consent' | 'error' | 'paused'
  statusDetail?: string
  connectedAt: string
  /** Graph change-notification subscription, if any. */
  subscription?: { id: string; expiresAt: string; clientState: string }
  /** Graph delta links — the resume point after a missed notification. */
  deltaLinks?: Partial<Record<'inbox' | 'sentitems', string>>
  lastSyncAt?: string
  settings: AccountSettings
}

export interface Folder {
  id: string
  accountId: string
  parentId: string | null
  displayName: string
  /** Slash-joined display names from the mailbox root, e.g. "Clients/Acme". */
  path: string
  wellKnown?: 'inbox' | 'sentitems' | 'drafts' | 'archive' | 'junkemail'
  createdByAgent?: boolean
}

export interface MailMessage {
  id: string
  accountId: string
  /** The id in the source mailbox (Graph message id, or the demo id). */
  providerId: string
  conversationId: string
  internetMessageId: string
  folderId: string
  direction: 'inbound' | 'outbound'
  from: Address
  to: Address[]
  cc: Address[]
  subject: string
  bodyText: string
  receivedAt: string
  isRead: boolean
  flagged: boolean
  importance: 'low' | 'normal' | 'high'
  categories: string[]
  hasAttachments: boolean
  /** RFC 3834 and friends, lower-cased names. Used for loop prevention. */
  headers: Record<string, string>
}

export const CATEGORY_KEYS = [
  'client-request',
  'sales-lead',
  'support',
  'billing',
  'scheduling',
  'legal',
  'hr',
  'vendor',
  'internal',
  'newsletter',
  'notification',
  'personal',
  'spam',
] as const

export type CategoryKey = (typeof CATEGORY_KEYS)[number]

export type PriorityBand = 'urgent' | 'high' | 'normal' | 'low'

export interface PriorityFactor {
  label: string
  weight: number
}

export interface Analysis {
  messageId: string
  accountId: string
  language: Language
  category: CategoryKey
  intent: string
  summary: string
  actionItems: string[]
  needsReply: boolean
  /** ISO date if the sender stated or clearly implied one. */
  deadline: string | null
  sentiment: 'positive' | 'neutral' | 'negative'
  /** 0–1, the model's self-reported confidence in the category and needsReply call. */
  confidence: number
  priority: number
  band: PriorityBand
  factors: PriorityFactor[]
  model: string
  latencyMs: number
  analysedAt: string
  /** Text the model was shown looked like it was addressing the model. */
  injectionSuspected: boolean
}

export type DraftStatus = 'pending' | 'saved' | 'sent' | 'discarded' | 'blocked'

export interface Draft {
  id: string
  accountId: string
  messageId: string
  conversationId: string
  language: Language
  subject: string
  body: string
  status: DraftStatus
  /** Why a person is being asked, or why it was sent without one. */
  reason: string
  ruleId: string | null
  confidence: number
  /** The provider's draft id once it exists in Outlook's Drafts folder. */
  providerDraftId?: string
  model: string
  createdAt: string
  decidedAt?: string
  decidedBy?: string
}

export interface FollowUp {
  id: string
  accountId: string
  conversationId: string
  messageId: string
  /** awaiting-them: we wrote and nobody answered. awaiting-us: they wrote and we did not. */
  kind: 'awaiting-them' | 'awaiting-us'
  subject: string
  counterpart: Address
  dueAt: string
  status: 'open' | 'done' | 'snoozed'
  createdAt: string
}

/* ---------------------------------------------------------------- rules -- */

export type ConditionField =
  | 'category'
  | 'band'
  | 'priority'
  | 'language'
  | 'from'
  | 'fromDomain'
  | 'subject'
  | 'body'
  | 'needsReply'
  | 'confidence'
  | 'hasAttachments'
  | 'sentiment'

export type ConditionOp = 'is' | 'isNot' | 'in' | 'contains' | 'matches' | 'gte' | 'lte'

export interface Condition {
  field: ConditionField
  op: ConditionOp
  value: string | number | boolean | string[]
}

export type RuleAction =
  | { type: 'move'; folder: string }
  | { type: 'categorize'; category: string }
  | { type: 'flag' }
  | { type: 'markRead' }
  | { type: 'draftReply'; instructions?: string }
  | { type: 'autoReply'; instructions?: string }
  | { type: 'followUp'; days?: number }
  | { type: 'webhook'; url: string }

export interface Rule {
  id: string
  /** null applies to every account. */
  accountId: string | null
  name: string
  enabled: boolean
  /** Lower runs first. */
  order: number
  /** Every condition must hold. An empty list matches everything. */
  when: Condition[]
  then: RuleAction[]
  /** Stop evaluating later rules once this one matches. */
  stop: boolean
  updatedAt: string
}

/* ------------------------------------------------------------- activity -- */

export type ActivityKind =
  | 'received'
  | 'analysed'
  | 'moved'
  | 'folder-created'
  | 'categorised'
  | 'flagged'
  | 'marked-read'
  | 'draft-created'
  | 'draft-saved'
  | 'reply-sent'
  | 'reply-blocked'
  | 'draft-discarded'
  | 'follow-up-opened'
  | 'follow-up-closed'
  | 'webhook'
  | 'rule-skipped'
  | 'error'
  | 'sync'
  | 'subscription'

export interface ActivityEvent {
  id: string
  at: string
  accountId: string | null
  messageId?: string
  ruleId?: string
  kind: ActivityKind
  actor: 'agent' | 'user' | 'system'
  detail: string
}
