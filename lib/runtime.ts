import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import { env } from './env'
import { seedData } from './demo/seed'
import { DemoMailbox } from './mail/demo'
import type { MailProvider } from './mail/types'
import { Store } from './store/store'
import type { Account } from './types'

/**
 * Process-wide singletons: the store, the event bus, the mailbox drivers.
 *
 * Kept on `globalThis` so Next's dev-mode module reloading does not create a
 * second store writing over the first, or a second simulator double-delivering
 * mail. Tests replace the store with an in-memory one through `setStore`.
 */

export type LiveEvent =
  | { type: 'message'; accountId: string; messageId: string }
  | { type: 'analysed'; accountId: string; messageId: string; band: string; category: string }
  | { type: 'draft'; accountId: string; draftId: string; status: string }
  | { type: 'activity'; accountId: string | null; kind: string; detail: string }
  | { type: 'account'; accountId: string }

interface Runtime {
  store: Store | null
  bus: EventEmitter
  mailboxes: Map<string, MailProvider>
  graphFactory: ((account: Account) => MailProvider) | null
}

const g = globalThis as unknown as { __sendero?: Runtime }
const rt: Runtime = (g.__sendero ??= {
  store: null,
  bus: new EventEmitter().setMaxListeners(200),
  mailboxes: new Map(),
  graphFactory: null,
})

export function store(): Store {
  if (!rt.store) setStore(new Store(resolve(process.cwd(), env().DATA_DIR, 'sendero.json'), seedData))
  return rt.store!
}

export function setStore(next: Store): void {
  next.onActivity = (e) => emit({ type: 'activity', accountId: e.accountId, kind: e.kind, detail: e.detail })
  rt.store = next
  rt.mailboxes.clear()
}

export function bus(): EventEmitter {
  return rt.bus
}

export function emit(event: LiveEvent): void {
  rt.bus.emit('live', event)
}

/** Graph is registered lazily so the demo build never constructs a Graph client. */
export function registerGraphFactory(factory: (account: Account) => MailProvider): void {
  rt.graphFactory = factory
}

export function mailboxFor(account: Account): MailProvider {
  const cached = rt.mailboxes.get(account.id)
  if (cached) return cached

  let mailbox: MailProvider
  if (account.provider === 'graph') {
    if (!rt.graphFactory) throw new Error('Microsoft Graph is not configured on this deployment')
    mailbox = rt.graphFactory(account)
  } else {
    mailbox = new DemoMailbox(store(), account.id)
  }
  rt.mailboxes.set(account.id, mailbox)
  return mailbox
}

export function forgetMailbox(accountId: string): void {
  rt.mailboxes.delete(accountId)
}
