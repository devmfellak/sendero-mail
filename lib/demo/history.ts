import { createHash } from 'node:crypto'
import { approveDraft } from '../agent/drafts'
import { sweepConversation } from '../agent/followups'
import { store } from '../runtime'
import { ACCOUNT_IDS } from './seed'

/**
 * Turns a freshly processed seed backlog into a believable working day.
 *
 * The pipeline runs over every seeded message at boot, so on its own the log
 * would say the agent did a day's work in one second and nobody ever answered
 * anything. This settles it once: older drafts were approved by the people
 * who own each mailbox some minutes after the mail arrived, and every logged
 * step is placed shortly after the message it belongs to. Nothing is invented
 * that the pipeline did not do — only when it happened.
 */

const REVIEWERS: Record<string, string> = {
  [ACCOUNT_IDS.elena]: 'Elena Ruiz',
  [ACCOUNT_IDS.support]: 'Diego Navarro',
  [ACCOUNT_IDS.sales]: 'Paola Garza',
}

/** Categories that stay in Approvals however old they are: they need a decision, not a click. */
const KEEP_PENDING = new Set(['legal', 'billing', 'spam'])

export async function settleSeedHistory(now = new Date()): Promise<void> {
  const db = store()
  if (db.read.simulator.settled) return

  const seeded = new Set(db.read.messages.map((m) => m.id))
  const before = now.getTime() - 3 * 3_600_000

  // 1. People approved what came in earlier in the day.
  const approvable = db.read.drafts.filter((d) => {
    if (d.status !== 'pending') return false
    const message = db.read.messages.find((m) => m.id === d.messageId)
    const analysis = db.read.analyses[d.messageId]
    if (!message || !analysis || analysis.injectionSuspected || KEEP_PENDING.has(analysis.category)) return false
    return Date.parse(message.receivedAt) < before
  })
  for (const draft of approvable) {
    await approveDraft(draft.id, undefined, REVIEWERS[draft.accountId] ?? 'Operator')
    const account = db.read.accounts.find((a) => a.id === draft.accountId)
    if (account) await sweepConversation(account, draft.conversationId, now)
  }

  // 2. Every step happened shortly after the message that caused it.
  await db.mutate((d) => {
    const byId = new Map(d.messages.map((m) => [m.id, m]))
    const arrived = (messageId: string) => Date.parse(byId.get(messageId)?.receivedAt ?? now.toISOString())
    const reviewDelay = (key: string) => (18 + jitter(key, 55)) * 60_000

    for (const draft of d.drafts) {
      const base = arrived(draft.messageId) + (40 + jitter(draft.id, 50)) * 1000
      draft.createdAt = iso(base, now)
      if (draft.status === 'sent' && draft.decidedAt) {
        draft.decidedAt = iso(draft.decidedBy === 'agent' ? base + 2000 : arrived(draft.messageId) + reviewDelay(draft.id), now)
      }
    }
    for (const analysis of Object.values(d.analyses)) {
      analysis.analysedAt = iso(arrived(analysis.messageId) + (20 + jitter(analysis.messageId, 40)) * 1000, now)
    }

    // Replies the agent or a person sent carry the time they were sent.
    for (const m of d.messages) {
      if (seeded.has(m.id) || m.direction !== 'outbound') continue
      const sent = d.drafts.find((x) => x.conversationId === m.conversationId && x.status === 'sent' && x.decidedAt)
      if (sent?.decidedAt) m.receivedAt = sent.decidedAt
    }
    for (const f of d.followUps) f.createdAt = iso(arrived(f.messageId) + 60_000, now)

    // Boot-time bookkeeping is not history.
    d.activity = d.activity.filter((e) => e.messageId || e.kind !== 'sync' || e.detail.startsWith('Initial sync'))
    const step = new Map<string, number>()
    for (const e of d.activity) {
      if (!e.messageId) continue
      const draft = d.drafts.find((x) => x.messageId === e.messageId && x.status === 'sent')
      if (e.kind === 'reply-sent' && draft?.decidedAt) {
        e.at = draft.decidedAt
        continue
      }
      const n = step.get(e.messageId) ?? 0
      step.set(e.messageId, n + 1)
      e.at = iso(arrived(e.messageId) + (20 + jitter(e.messageId, 40)) * 1000 + n * 1500, now)
    }
    d.activity.sort((a, b) => a.at.localeCompare(b.at))
    d.simulator.settled = true
    d.simulator.lastAt = now.toISOString()
  })
}

/** A stable pseudo-random integer in [0, range) for a key. */
function jitter(key: string, range: number): number {
  return createHash('sha256').update(key).digest().readUInt32BE(0) % range
}

function iso(ms: number, now: Date): string {
  return new Date(Math.min(ms, now.getTime())).toISOString()
}
