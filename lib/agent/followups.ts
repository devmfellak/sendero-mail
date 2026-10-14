import { followUpFor } from '../domain/followups'
import { store } from '../runtime'
import { stableId } from '../store/store'
import type { Account } from '../types'

/**
 * Keeps the follow-up list true to the mailbox.
 *
 * Opens a follow-up when a conversation ends with somebody waiting, closes it
 * the moment the other side writes — wherever that reply was sent from — and
 * never holds two open follow-ups for one conversation.
 */
export async function sweepConversation(account: Account, conversationId: string, now: Date): Promise<void> {
  const db = store()
  const conversation = db.read.messages.filter((m) => m.accountId === account.id && m.conversationId === conversationId)
  const analyses = new Map(Object.entries(db.read.analyses))
  const candidate = followUpFor(conversation, analyses, account.settings.followUpDays)
  const open = db.read.followUps.find((f) => f.accountId === account.id && f.conversationId === conversationId && f.status === 'open')

  if (open && (!candidate || candidate.kind !== open.kind || candidate.message.id !== open.messageId)) {
    // The conversation moved on. A rule-created follow-up on the same message
    // with a custom due date survives a sweep that agrees with it.
    await db.mutate((d) => {
      const f = d.followUps.find((x) => x.id === open.id)
      if (f) f.status = 'done'
    })
    await db.log({
      accountId: account.id,
      messageId: open.messageId,
      kind: 'follow-up-closed',
      actor: 'agent',
      detail: open.kind === 'awaiting-us' ? 'Replied — follow-up closed' : `${open.counterpart.address} answered — follow-up closed`,
    })
  }

  const stillOpen = open && candidate && candidate.kind === open.kind && candidate.message.id === open.messageId
  if (candidate && !stillOpen) {
    const counterpart = candidate.kind === 'awaiting-us' ? candidate.message.from : (candidate.message.to[0] ?? candidate.message.from)
    await db.mutate((d) => {
      d.followUps.push({
        id: stableId('fu', `${conversationId}:${candidate.message.id}:${candidate.kind}`),
        accountId: account.id,
        conversationId,
        messageId: candidate.message.id,
        kind: candidate.kind,
        subject: candidate.message.subject,
        counterpart,
        dueAt: candidate.dueAt.toISOString(),
        status: 'open',
        createdAt: now.toISOString(),
      })
    })
    if (candidate.kind === 'awaiting-them') {
      await db.log({
        accountId: account.id,
        messageId: candidate.message.id,
        kind: 'follow-up-opened',
        actor: 'agent',
        detail: `Waiting on ${counterpart.address}; nudge due ${candidate.dueAt.toISOString().slice(0, 10)}`,
      })
    }
  }
}

export async function sweepAll(now = new Date()): Promise<void> {
  const db = store()
  for (const account of db.read.accounts) {
    const conversations = new Set(db.read.messages.filter((m) => m.accountId === account.id).map((m) => m.conversationId))
    for (const c of conversations) await sweepConversation(account, c, now)
  }
}
