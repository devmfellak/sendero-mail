import { isOverdue } from './domain/followups'
import { store } from './runtime'
import type { Account, Analysis, CategoryKey, Draft, Folder, FollowUp, Language, MailMessage, PriorityBand } from './types'

/**
 * Read models for the dashboard. Pure reads over the store snapshot; nothing
 * here writes. Pages stay thin and every number on screen is computed in one
 * place.
 */

export interface InboxRow {
  message: MailMessage
  analysis: Analysis | null
  account: Account
  folder: Folder | undefined
  draft: Draft | undefined
}

export interface InboxFilter {
  account?: string
  band?: PriorityBand
  category?: CategoryKey
  lang?: Language
  q?: string
  view?: 'needs-reply' | 'all' | 'filed'
}

const BAND_RANK: Record<PriorityBand, number> = { urgent: 0, high: 1, normal: 2, low: 3 }

export function inbox(filter: InboxFilter = {}, limit = 200): InboxRow[] {
  const d = store().read
  const accounts = new Map(d.accounts.map((a) => [a.id, a]))
  const folders = new Map(d.folders.map((f) => [f.id, f]))
  const drafts = new Map<string, Draft>()
  for (const dr of d.drafts) if (dr.status === 'pending' || dr.status === 'sent') drafts.set(dr.messageId, dr)

  const q = filter.q?.trim().toLowerCase()
  const rows: InboxRow[] = []
  for (const m of d.messages) {
    if (m.direction !== 'inbound') continue
    if (filter.account && m.accountId !== filter.account) continue
    const account = accounts.get(m.accountId)
    if (!account) continue
    const a = d.analyses[m.id] ?? null
    const folder = folders.get(m.folderId)
    if (filter.band && a?.band !== filter.band) continue
    if (filter.category && a?.category !== filter.category) continue
    if (filter.lang && a?.language !== filter.lang) continue
    if (filter.view === 'needs-reply' && !(a?.needsReply && drafts.get(m.id)?.status !== 'sent')) continue
    if (filter.view === 'filed' && folder?.wellKnown === 'inbox') continue
    if (q && !`${m.subject} ${m.from.name} ${m.from.address} ${a?.summary ?? ''}`.toLowerCase().includes(q)) continue
    rows.push({ message: m, analysis: a, account, folder, draft: drafts.get(m.id) })
  }

  return rows
    .sort((x, y) => {
      // Unprocessed first (they are about to change), then by band, then newest.
      if (!x.analysis !== !y.analysis) return x.analysis ? 1 : -1
      const band = BAND_RANK[x.analysis?.band ?? 'low'] - BAND_RANK[y.analysis?.band ?? 'low']
      return filter.view === 'all' ? y.message.receivedAt.localeCompare(x.message.receivedAt) : band || y.message.receivedAt.localeCompare(x.message.receivedAt)
    })
    .slice(0, limit)
}

export function pendingDrafts(accountId?: string): Array<{ draft: Draft; message: MailMessage; analysis: Analysis | null; account: Account }> {
  const d = store().read
  return d.drafts
    .filter((x) => x.status === 'pending' && (!accountId || x.accountId === accountId))
    .map((draft) => ({
      draft,
      message: d.messages.find((m) => m.id === draft.messageId)!,
      analysis: d.analyses[draft.messageId] ?? null,
      account: d.accounts.find((a) => a.id === draft.accountId)!,
    }))
    .filter((x) => x.message && x.account)
    .sort((a, b) => (a.analysis?.priority ?? 0) < (b.analysis?.priority ?? 0) ? 1 : -1)
}

export function openFollowUps(now = new Date()): Array<FollowUp & { overdue: boolean; account: Account }> {
  const d = store().read
  return d.followUps
    .filter((f) => f.status === 'open')
    .map((f) => ({ ...f, overdue: isOverdue(f, now), account: d.accounts.find((a) => a.id === f.accountId)! }))
    .filter((f) => f.account)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
}

export function counts() {
  const d = store().read
  const now = new Date()
  const dayAgo = now.getTime() - 86_400_000
  const recent = d.activity.filter((e) => Date.parse(e.at) >= dayAgo)
  return {
    pendingDrafts: d.drafts.filter((x) => x.status === 'pending').length,
    openFollowUps: d.followUps.filter((f) => f.status === 'open').length,
    overdueFollowUps: d.followUps.filter((f) => isOverdue(f, now)).length,
    analysedToday: recent.filter((e) => e.kind === 'analysed').length,
    autoSentToday: recent.filter((e) => e.kind === 'reply-sent' && e.actor === 'agent').length,
    approvedToday: recent.filter((e) => e.kind === 'reply-sent' && e.actor === 'user').length,
    filedToday: recent.filter((e) => e.kind === 'moved').length,
    heldToday: recent.filter((e) => e.kind === 'reply-blocked').length,
    unprocessed: d.messages.filter((m) => m.direction === 'inbound' && !d.analyses[m.id]).length,
    urgentOpen: d.messages.filter((m) => {
      const a = d.analyses[m.id]
      return m.direction === 'inbound' && a?.band === 'urgent' && !d.drafts.some((x) => x.messageId === m.id && x.status === 'sent')
    }).length,
  }
}

export function accountSummary(account: Account) {
  const d = store().read
  const mine = d.messages.filter((m) => m.accountId === account.id && m.direction === 'inbound')
  return {
    messages: mine.length,
    unread: mine.filter((m) => !m.isRead).length,
    urgent: mine.filter((m) => d.analyses[m.id]?.band === 'urgent').length,
    pending: d.drafts.filter((x) => x.accountId === account.id && x.status === 'pending').length,
    followUps: d.followUps.filter((f) => f.accountId === account.id && f.status === 'open').length,
    folders: d.folders.filter((f) => f.accountId === account.id && f.createdByAgent).length,
    languages: {
      en: mine.filter((m) => d.analyses[m.id]?.language === 'en').length,
      es: mine.filter((m) => d.analyses[m.id]?.language === 'es').length,
    },
  }
}

export function categoryBreakdown(): Array<{ category: CategoryKey; count: number }> {
  const tally = new Map<CategoryKey, number>()
  for (const a of Object.values(store().read.analyses)) tally.set(a.category, (tally.get(a.category) ?? 0) + 1)
  return [...tally.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count)
}

export function messageDetail(id: string) {
  const d = store().read
  const message = d.messages.find((m) => m.id === id)
  if (!message) return null
  const account = d.accounts.find((a) => a.id === message.accountId)!
  const conversation = d.messages
    .filter((m) => m.accountId === message.accountId && m.conversationId === message.conversationId)
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
  return {
    message,
    account,
    analysis: d.analyses[message.id] ?? null,
    folder: d.folders.find((f) => f.id === message.folderId),
    conversation,
    drafts: d.drafts.filter((x) => x.messageId === message.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    activity: d.activity.filter((e) => e.messageId === message.id).sort((a, b) => a.at.localeCompare(b.at)),
    followUps: d.followUps.filter((f) => f.conversationId === message.conversationId && f.accountId === message.accountId),
    rules: d.rules,
  }
}
