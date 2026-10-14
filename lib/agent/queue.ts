/**
 * Work scheduling: serial per mailbox, parallel across mailboxes.
 *
 * Serial per mailbox because Outlook throttles per mailbox (four concurrent
 * requests) and because two messages filed into the same new folder at once
 * would race to create it. Parallel across mailboxes because one busy inbox
 * must not delay the others — the posting's "many accounts simultaneously" is
 * this line.
 *
 * Jobs are keyed, and a key already queued or running is not queued again:
 * Graph delivers notifications at least once, and a delta sync after a missed
 * notification will rediscover messages the webhook already announced.
 */

type Job = () => Promise<void>

export class KeyedQueue {
  private lanes = new Map<string, Promise<void>>()
  private pending = new Set<string>()

  constructor(private readonly onError: (key: string, err: unknown) => void) {}

  enqueue(lane: string, key: string, job: Job): boolean {
    if (this.pending.has(key)) return false
    this.pending.add(key)

    const previous = this.lanes.get(lane) ?? Promise.resolve()
    const next = previous
      .then(job)
      .catch((err) => this.onError(key, err))
      .finally(() => {
        this.pending.delete(key)
        if (this.lanes.get(lane) === next) this.lanes.delete(lane)
      })
    this.lanes.set(lane, next)
    return true
  }

  get size(): number {
    return this.pending.size
  }

  /** Resolves when every lane is idle. Used by tests and graceful shutdown. */
  async drain(): Promise<void> {
    while (this.lanes.size > 0) await Promise.all([...this.lanes.values()])
  }
}
