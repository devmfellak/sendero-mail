import { enqueueMessage, settle } from '../agent/worker'
import { env, simulatorEnabled } from '../env'
import { store } from '../runtime'
import { SIMULATED_MAIL } from './fixtures'
import { ACCOUNT_IDS, demoMessage } from './seed'

/**
 * New mail for the sample mailboxes, one message at a time, through exactly
 * the path a Graph change notification takes: the message lands, the queue
 * picks it up, the dashboard updates live. Threaded items join their existing
 * conversation, so follow-ups close and reopen as they would for real.
 *
 * Each message arrives once. A mailbox that receives the same email twice
 * looks broken, not busy.
 */
export async function injectNext(accountKey?: keyof typeof ACCOUNT_IDS): Promise<string | null> {
  const db = store()
  const cursor = db.read.simulator.cursor
  const remaining = SIMULATED_MAIL.map((m, i) => ({ m, i })).filter(({ m, i }) => i >= cursor && (!accountKey || m.account === accountKey))
  const next = remaining[0]
  if (!next) return null

  const message = demoMessage(next.m, new Date(), `sim:${next.i}`)
  await db.mutate((d) => {
    d.messages.push(message)
    d.simulator.cursor = next.i + 1
    d.simulator.lastAt = message.receivedAt
  })
  await db.log({
    accountId: message.accountId,
    messageId: message.id,
    kind: 'received',
    actor: 'system',
    detail: `New mail from ${message.from.address}`,
  })
  enqueueMessage(message.accountId, message.id)
  return message.id
}

/**
 * Delivery driven by page views instead of a timer, for hosts that freeze the
 * process between requests (Vercel and other serverless platforms). Delivers
 * at most one message per call once the interval has passed, and waits for
 * the agent to finish with it so the page renders the result.
 */
export async function deliverDue(now = new Date()): Promise<void> {
  if (!simulatorEnabled()) return
  const last = Date.parse(store().read.simulator.lastAt ?? '') || 0
  if (now.getTime() - last < env().SIMULATOR_INTERVAL_SECONDS * 1000) return
  if (await injectNext()) await settle(8_000)
}
