import { enqueueMessage } from '../agent/worker'
import { env } from '../env'
import { emit, forgetMailbox, mailboxFor, registerGraphFactory, store } from '../runtime'
import { id } from '../store/store'
import type { Account, MailMessage } from '../types'
import { seedSettingsForNewAccount } from './defaults'
import { GraphClient } from './client'
import { decryptToken, encryptToken, randomToken } from './crypto'
import { GraphMailbox } from './mailbox'
import type { AcceptedNotification } from './notifications'
import { ConsentRequiredError, refreshAccessToken, type TokenResponse } from './oauth'

/**
 * Keeping the local picture of each Outlook mailbox current.
 *
 * Two mechanisms, deliberately overlapping:
 *
 * - Change notifications (webhooks) for latency: new mail is processed seconds
 *   after it arrives.
 * - Delta queries for correctness: notifications can be missed, delayed or
 *   dropped (Graph says so), so every 15 minutes, and immediately on a
 *   `missed` lifecycle event, each mailbox is reconciled from its stored delta
 *   link. Anything the webhook already delivered is de-duplicated by the queue
 *   and by the pipeline's idempotency.
 *
 * Subscriptions on Outlook messages expire after at most ~7 days; they are
 * renewed when within 24 hours of expiry, and re-created if Graph removed them.
 */

const SUBSCRIPTION_HOURS = 70
const INITIAL_SYNC_DAYS = 3

/* ----------------------------------------------------------- tokens -- */

const accessTokens = new Map<string, { token: string; expiresAt: number }>()

async function accessToken(accountId: string, force: boolean): Promise<string> {
  const cached = accessTokens.get(accountId)
  if (!force && cached && cached.expiresAt - 120_000 > Date.now()) return cached.token

  const db = store()
  const sealed = db.read.tokens[accountId]
  const key = env().TOKEN_ENCRYPTION_KEY
  if (!sealed || !key) throw new ConsentRequiredError('No stored authorisation for this mailbox')

  let res: TokenResponse
  try {
    res = await refreshAccessToken(decryptToken(sealed, key, accountId))
  } catch (err) {
    if (err instanceof ConsentRequiredError) await markNeedsConsent(accountId, err.message)
    throw err
  }

  accessTokens.set(accountId, { token: res.access_token, expiresAt: Date.now() + res.expires_in * 1000 })
  // Refresh tokens rotate; always keep the newest.
  if (res.refresh_token) {
    const refreshed = encryptToken(res.refresh_token, key, accountId)
    await db.mutate((d) => {
      d.tokens[accountId] = refreshed
    })
  }
  return res.access_token
}

async function markNeedsConsent(accountId: string, detail: string): Promise<void> {
  await store().mutate((d) => {
    const a = d.accounts.find((x) => x.id === accountId)
    if (a) {
      a.status = 'needs-consent'
      a.statusDetail = detail
    }
  })
  await store().log({ accountId, kind: 'error', actor: 'system', detail: `Mailbox needs to be reconnected: ${detail}` })
  emit({ type: 'account', accountId })
}

export function graphMailbox(account: Account): GraphMailbox {
  return new GraphMailbox(new GraphClient({ getToken: (force) => accessToken(account.id, force) }), account)
}

registerGraphFactory(graphMailbox)

/* ------------------------------------------------------- connecting -- */

/** After a successful OAuth callback. Creates or re-activates the account. */
export async function connectAccount(tokens: TokenResponse, identity: { name: string; email: string }): Promise<Account> {
  const key = env().TOKEN_ENCRYPTION_KEY
  if (!key || !tokens.refresh_token) throw new Error('Cannot store authorisation: missing key or refresh token')
  const db = store()

  const existing = db.read.accounts.find((a) => a.provider === 'graph' && a.address.toLowerCase() === identity.email.toLowerCase())
  const accountId = existing?.id ?? id('acc')
  const now = new Date().toISOString()

  await db.mutate((d) => {
    d.tokens[accountId] = encryptToken(tokens.refresh_token!, key, accountId)
    const current = d.accounts.find((a) => a.id === accountId)
    if (current) {
      current.status = 'connected'
      current.statusDetail = undefined
    } else {
      d.accounts.push({
        id: accountId,
        displayName: identity.name || identity.email,
        address: identity.email,
        provider: 'graph',
        color: pickColour(d.accounts.length),
        status: 'connected',
        connectedAt: now,
        // Every new mailbox starts in observe mode: watch for a week, read
        // what it would have done, then turn things on.
        settings: seedSettingsForNewAccount(identity),
      })
    }
  })
  accessTokens.set(accountId, { token: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 })
  forgetMailbox(accountId)

  const account = db.read.accounts.find((a) => a.id === accountId)!
  await db.log({ accountId, kind: 'sync', actor: 'user', detail: `${account.address} connected through Microsoft Entra ID` })

  await refreshFolders(account)
  await syncAccount(account)
  await ensureSubscription(account)
  emit({ type: 'account', accountId })
  return account
}

export async function refreshFolders(account: Account): Promise<void> {
  const folders = await mailboxFor(account).listFolders()
  await store().mutate((d) => {
    const known = new Map(d.folders.filter((f) => f.accountId === account.id).map((f) => [f.id, f]))
    d.folders = [
      ...d.folders.filter((f) => f.accountId !== account.id),
      ...folders.map((f) => ({ ...f, createdByAgent: known.get(f.id)?.createdByAgent ?? f.createdByAgent })),
    ]
  })
}

/* ------------------------------------------------------------- sync -- */

export async function syncAccount(account: Account): Promise<number> {
  if (account.provider !== 'graph' || account.status !== 'connected') return 0
  const mailbox = mailboxFor(account) as GraphMailbox
  const since = new Date(Date.now() - INITIAL_SYNC_DAYS * 86_400_000)
  const links = { ...(account.deltaLinks ?? {}) }
  let fresh = 0

  for (const folder of ['inbox', 'sentitems'] as const) {
    let result: { messages: MailMessage[]; deltaLink: string }
    try {
      result = await mailbox.folderDelta(folder, links[folder], since)
    } catch (err) {
      // An expired or invalid delta token is a 410; start that folder over.
      if (String(err).includes('410') || String(err).includes('SyncStateNotFound')) {
        result = await mailbox.folderDelta(folder, undefined, since)
      } else {
        throw err
      }
    }
    links[folder] = result.deltaLink
    fresh += await ingest(account, result.messages)
  }

  await store().mutate((d) => {
    const a = d.accounts.find((x) => x.id === account.id)
    if (a) {
      a.deltaLinks = links
      a.lastSyncAt = new Date().toISOString()
    }
  })
  if (fresh > 0) await store().log({ accountId: account.id, kind: 'sync', actor: 'system', detail: `Synced ${fresh} new message(s)` })
  return fresh
}

async function ingest(account: Account, messages: MailMessage[]): Promise<number> {
  const db = store()
  const added: MailMessage[] = []
  await db.mutate((d) => {
    for (const m of messages) {
      const i = d.messages.findIndex((x) => x.id === m.id)
      if (i === -1) {
        d.messages.push(m)
        added.push(m)
      } else {
        d.messages[i] = { ...d.messages[i]!, ...m }
      }
    }
  })
  for (const m of added) enqueueMessage(account.id, m.id)
  return added.length
}

/* ---------------------------------------------------- notifications -- */

export async function handleNotification(n: AcceptedNotification): Promise<void> {
  const account = store().read.accounts.find((a) => a.id === n.accountId)
  if (!account) return

  if (n.lifecycleEvent === 'missed') {
    await syncAccount(account)
    return
  }
  if (n.lifecycleEvent === 'reauthorizationRequired' || n.lifecycleEvent === 'subscriptionRemoved') {
    await ensureSubscription(account, { force: n.lifecycleEvent === 'subscriptionRemoved' })
    return
  }
  if (!n.messageId) return

  const mailbox = mailboxFor(account) as GraphMailbox
  const message = await mailbox.getMessage(n.messageId)
  await store().log({ accountId: account.id, messageId: message.id, kind: 'received', actor: 'system', detail: `New mail from ${message.from.address}` })
  await ingest(account, [message])
}

export function subscriptionLookup(subscriptionId: string): { accountId: string; clientState: string } | undefined {
  const account = store().read.accounts.find((a) => a.subscription?.id === subscriptionId)
  return account?.subscription ? { accountId: account.id, clientState: account.subscription.clientState } : undefined
}

/* ---------------------------------------------------- subscriptions -- */

export async function ensureSubscription(account: Account, opts: { force?: boolean } = {}): Promise<void> {
  const origin = env().GRAPH_NOTIFICATION_ORIGIN
  if (!origin || account.provider !== 'graph' || account.status !== 'connected') return

  const mailbox = mailboxFor(account) as GraphMailbox
  const expiresAt = new Date(Date.now() + SUBSCRIPTION_HOURS * 3_600_000)
  const current = account.subscription
  const db = store()

  try {
    if (current && !opts.force && Date.parse(current.expiresAt) - Date.now() > 24 * 3_600_000) return

    if (current && !opts.force) {
      const renewed = await mailbox.renewSubscription(current.id, expiresAt)
      await db.mutate((d) => {
        const a = d.accounts.find((x) => x.id === account.id)
        if (a?.subscription) a.subscription.expiresAt = renewed.expirationDateTime
      })
      await db.log({ accountId: account.id, kind: 'subscription', actor: 'system', detail: `Change notifications renewed until ${renewed.expirationDateTime}` })
      return
    }

    const clientState = randomToken()
    const created = await mailbox.subscribe(
      `${origin}/api/graph/notifications`,
      `${origin}/api/graph/lifecycle`,
      clientState,
      expiresAt,
    )
    await db.mutate((d) => {
      const a = d.accounts.find((x) => x.id === account.id)
      if (a) a.subscription = { id: created.id, expiresAt: created.expirationDateTime, clientState }
    })
    await db.log({ accountId: account.id, kind: 'subscription', actor: 'system', detail: `Subscribed to new-mail notifications until ${created.expirationDateTime}` })
  } catch (err) {
    // A renew on a subscription Graph already deleted is a 404: re-create.
    if (current && !opts.force && String(err).includes('404')) return ensureSubscription(account, { force: true })
    await db.log({ accountId: account.id, kind: 'error', actor: 'system', detail: `Subscription: ${String(err).slice(0, 200)} — delta sync continues every 15 minutes` })
  }
}

export function startGraphMaintenance(): NodeJS.Timeout[] {
  const graphAccounts = () => store().read.accounts.filter((a) => a.provider === 'graph' && a.status === 'connected')
  const each = (fn: (a: Account) => Promise<unknown>) => () => {
    for (const a of graphAccounts()) void fn(a).catch((err) => store().log({ accountId: a.id, kind: 'error', actor: 'system', detail: String(err).slice(0, 200) }))
  }
  each(syncAccount)()
  each(ensureSubscription)()
  return [setInterval(each(syncAccount), 15 * 60_000), setInterval(each(ensureSubscription), 60 * 60_000)]
}

function pickColour(i: number): string {
  return ['#2f6f8f', '#2f7d52', '#a56b12', '#5c4b8f', '#b0422f', '#3d6b5e'][i % 6]!
}
