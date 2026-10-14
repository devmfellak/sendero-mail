import { graphConfigured, simulatorEnabled, env } from '../env'
import { emit, store } from '../runtime'
import { processMessage } from './pipeline'
import { KeyedQueue } from './queue'
import { sweepAll } from './followups'

/**
 * The background side of the process: one queue, a few timers.
 *
 * Started once per process from `instrumentation.ts`. Everything it schedules
 * is idempotent, so a restart in the middle of a run repeats work at worst and
 * never skips it: on boot, any inbound message without an analysis is queued.
 *
 * On a serverless host the timers rarely fire — the process is frozen between
 * requests — so boot waits for the backlog before the first request is
 * served, and the console delivers sample mail as pages are viewed.
 */

interface Worker {
  queue: KeyedQueue
  timers: NodeJS.Timeout[]
}

const g = globalThis as unknown as { __senderoWorker?: Worker; __senderoBoot?: Promise<void> }

export function worker(): Worker {
  return (g.__senderoWorker ??= {
    queue: new KeyedQueue((key, err) => {
      void store().log({
        accountId: null,
        messageId: key,
        kind: 'error',
        actor: 'system',
        detail: `Processing failed: ${String(err instanceof Error ? err.message : err).slice(0, 240)}`,
      })
    }),
    timers: [],
  })
}

export function enqueueMessage(accountId: string, messageId: string, opts: { force?: boolean } = {}): boolean {
  const key = opts.force ? `${messageId}#force${Date.now()}` : messageId
  emit({ type: 'message', accountId, messageId })
  return worker().queue.enqueue(accountId, key, async () => {
    await processMessage(messageId, { force: opts.force })
  })
}

/** Resolves when the queue is idle, or after `ms` — whichever is first. Returns whether it went idle. */
export async function settle(ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  const idle = await Promise.race([
    worker().queue.drain().then(() => true),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), ms)
    }),
  ])
  clearTimeout(timer)
  return idle
}

/** Idempotent; concurrent callers share one boot. */
export function startWorker(): Promise<void> {
  return (g.__senderoBoot ??= boot())
}

async function boot(): Promise<void> {
  const db = store()
  const w = worker()
  const firstRun = !db.read.simulator.settled && db.read.accounts.some((a) => a.provider === 'demo')

  // Catch up: anything that arrived while we were down, or the seeded backlog.
  const backlog = db.read.messages
    .filter((m) => m.direction === 'inbound' && !db.read.analyses[m.id])
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
  for (const m of backlog) enqueueMessage(m.accountId, m.id)
  if (backlog.length && !firstRun) {
    await db.log({ accountId: null, kind: 'sync', actor: 'system', detail: `Catching up on ${backlog.length} unprocessed message(s)` })
  }

  if (firstRun) {
    const { settleSeedHistory } = await import('../demo/history')
    // Conversations that end with *our* message never pass through the queue;
    // sweep them so "waiting on them" is right from the first page load.
    const finish = async () => {
      await sweepAll().catch(() => undefined)
      await settleSeedHistory()
    }
    // With the offline engine this takes milliseconds. With a model it can
    // take minutes; then the first pages show the work in progress.
    if (await settle(25_000)) await finish()
    else void w.queue.drain().then(finish)
  } else {
    void sweepAll().catch(() => undefined)
  }

  w.timers.push(setInterval(() => void sweepAll().catch(() => undefined), 10 * 60_000))

  if (simulatorEnabled()) {
    const { deliverDue } = await import('../demo/simulator')
    w.timers.push(setInterval(() => void deliverDue().catch(() => undefined), env().SIMULATOR_INTERVAL_SECONDS * 1000))
  }

  if (graphConfigured()) {
    const { startGraphMaintenance } = await import('../graph/sync')
    w.timers.push(...startGraphMaintenance())
  }

  for (const t of w.timers) t.unref?.()
}
