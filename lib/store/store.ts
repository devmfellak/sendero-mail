import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  Account,
  ActivityEvent,
  Analysis,
  Draft,
  Folder,
  FollowUp,
  MailMessage,
  Rule,
} from '../types'

/**
 * State.
 *
 * One JSON document, held in memory and written atomically (temp file +
 * rename) shortly after each change. That is the right size for what this
 * stores — configuration, the agent's decisions, and a working cache of recent
 * mail — and it means the demo runs from `npm run dev` with no database.
 *
 * The mailbox itself is the system of record for mail. Losing this file loses
 * the agent's memory of what it did, never anybody's email; a resync rebuilds
 * the cache. ADR 0004 covers when to move this behind Postgres (multiple
 * instances, or more than a few thousand messages a day).
 */

export interface Data {
  version: 1
  accounts: Account[]
  folders: Folder[]
  messages: MailMessage[]
  analyses: Record<string, Analysis>
  drafts: Draft[]
  followUps: FollowUp[]
  rules: Rule[]
  activity: ActivityEvent[]
  /** Encrypted refresh tokens, by account id. Never sent to the browser. */
  tokens: Record<string, string>
  /** Pending OAuth authorisations: state → PKCE verifier. Short-lived. */
  oauth: Record<string, { verifier: string; createdAt: string }>
  /**
   * Simulator cursor, so a restart does not replay the same mail; when the
   * last message arrived; and whether the seeded history has been settled.
   */
  simulator: { cursor: number; lastAt?: string; settled?: boolean }
}

const ACTIVITY_CAP = 3_000
const MESSAGE_CAP = 5_000

export function emptyData(): Data {
  return {
    version: 1,
    accounts: [],
    folders: [],
    messages: [],
    analyses: {},
    drafts: [],
    followUps: [],
    rules: [],
    activity: [],
    tokens: {},
    oauth: {},
    simulator: { cursor: 0 },
  }
}

export class Store {
  /** Called after each activity entry is recorded. The runtime wires it to the live event bus. */
  onActivity: ((event: ActivityEvent) => void) | null = null
  private data: Data
  private timer: NodeJS.Timeout | null = null
  private chain: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly path: string | null,
    seed: () => Data,
  ) {
    this.data = path ? (load(path) ?? seed()) : seed()
    if (path) this.flush()
  }

  /** A snapshot for reading. Treat as immutable; write through `mutate`. */
  get read(): Readonly<Data> {
    return this.data
  }

  /**
   * Serialised writes. Two pipeline runs finishing at once must not interleave
   * read-modify-write cycles on the same arrays.
   */
  mutate<T>(fn: (d: Data) => T | Promise<T>): Promise<T> {
    const next = this.chain.then(async () => {
      const result = await fn(this.data)
      this.trim()
      this.schedule()
      return result
    })
    this.chain = next.catch(() => undefined)
    return next
  }

  log(event: Omit<ActivityEvent, 'id' | 'at'> & { at?: string }): Promise<ActivityEvent> {
    return this.mutate((d) => {
      const full: ActivityEvent = { id: id('evt'), at: event.at ?? new Date().toISOString(), ...event }
      d.activity.push(full)
      return full
    }).then((full) => {
      this.onActivity?.(full)
      return full
    })
  }

  flushNow(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.flush()
  }

  private trim(): void {
    const d = this.data
    if (d.activity.length > ACTIVITY_CAP) d.activity.splice(0, d.activity.length - ACTIVITY_CAP)
    if (d.messages.length > MESSAGE_CAP) {
      d.messages.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
      const dropped = d.messages.splice(0, d.messages.length - MESSAGE_CAP)
      for (const m of dropped) delete d.analyses[m.id]
    }
    const cutoff = Date.now() - 15 * 60_000
    for (const [state, entry] of Object.entries(d.oauth)) {
      if (Date.parse(entry.createdAt) < cutoff) delete d.oauth[state]
    }
  }

  private schedule(): void {
    if (!this.path || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, 250)
  }

  private flush(): void {
    if (!this.path) return
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data))
    renameSync(tmp, this.path)
  }
}

function load(path: string): Data | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Data
    return parsed.version === 1 ? { ...emptyData(), ...parsed } : null
  } catch {
    return null
  }
}

export function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`
}

/**
 * An id derived from what the record is, not when it was made. Two server
 * instances that build the same state independently — serverless hosts start
 * several — then agree on every id, so a link rendered by one resolves on the
 * other.
 */
export function stableId(prefix: string, key: string): string {
  return `${prefix}_${createHash('sha256').update(key).digest('hex').slice(0, 16)}`
}
