import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { GraphClient, GraphError } from '../lib/graph/client'
import { decryptToken, encryptToken, pkcePair } from '../lib/graph/crypto'
import { mapMessage } from '../lib/graph/mapping'
import { messageIdFromResource, parseNotifications } from '../lib/graph/notifications'
import { textToHtml } from '../lib/graph/mailbox'

describe('change notifications', () => {
  const lookup = (id: string) => (id === 'sub-1' ? { accountId: 'acc-1', clientState: 'secret-state' } : undefined)

  test('accepts notifications carrying our clientState', () => {
    const { accepted, rejected } = parseNotifications(
      { value: [{ subscriptionId: 'sub-1', clientState: 'secret-state', changeType: 'created', resource: 'Users/u/Messages/AAMk=', resourceData: { id: 'AAMk=' } }] },
      lookup,
    )
    assert.equal(rejected, 0)
    assert.deepEqual(accepted[0], { subscriptionId: 'sub-1', accountId: 'acc-1', messageId: 'AAMk=', changeType: 'created', lifecycleEvent: undefined })
  })

  test('drops forged or unknown notifications', () => {
    const { accepted, rejected } = parseNotifications(
      {
        value: [
          { subscriptionId: 'sub-1', clientState: 'guess', changeType: 'created', resource: 'x' },
          { subscriptionId: 'sub-1', changeType: 'created', resource: 'x' },
          { subscriptionId: 'sub-9', clientState: 'secret-state', changeType: 'created', resource: 'x' },
        ],
      },
      lookup,
    )
    assert.equal(accepted.length, 0)
    assert.equal(rejected, 3)
  })

  test('tolerates garbage bodies', () => {
    assert.deepEqual(parseNotifications(null, lookup), { accepted: [], rejected: 0 })
    assert.deepEqual(parseNotifications({ value: 'x' }, lookup), { accepted: [], rejected: 0 })
  })

  test('message id from a resource path', () => {
    assert.equal(messageIdFromResource("Users/abc/Messages/AAMkAD%3D"), 'AAMkAD=')
    assert.equal(messageIdFromResource(undefined), null)
  })
})

describe('token encryption', () => {
  const key = randomBytes(32).toString('base64')

  test('round-trips', () => {
    assert.equal(decryptToken(encryptToken('refresh-token', key, 'acc-1'), key, 'acc-1'), 'refresh-token')
  })

  test('is bound to the account it was issued for', () => {
    const sealed = encryptToken('refresh-token', key, 'acc-1')
    assert.throws(() => decryptToken(sealed, key, 'acc-2'))
  })

  test('detects tampering', () => {
    const sealed = encryptToken('refresh-token', key, 'acc-1')
    const parts = sealed.split('.')
    parts[3] = Buffer.from('tampered').toString('base64url')
    assert.throws(() => decryptToken(parts.join('.'), key, 'acc-1'))
  })

  test('rejects a key of the wrong size', () => {
    assert.throws(() => encryptToken('x', Buffer.from('short').toString('base64'), 'a'), /32 bytes/)
  })

  test('PKCE challenge is base64url and differs from the verifier', () => {
    const { verifier, challenge } = pkcePair()
    assert.match(challenge, /^[A-Za-z0-9_-]{43}$/)
    assert.notEqual(verifier, challenge)
  })
})

describe('Graph client', () => {
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

  test('honours Retry-After on 429 and then succeeds', async () => {
    const waits: number[] = []
    const responses = [json(429, {}, { 'retry-after': '3' }), json(200, { ok: true })]
    const client = new GraphClient({
      getToken: async () => 't',
      fetchImpl: async () => responses.shift()!,
      sleep: async (ms) => void waits.push(ms),
    })
    assert.deepEqual(await client.get('/me'), { ok: true })
    assert.deepEqual(waits, [3000])
  })

  test('refreshes the token once on 401', async () => {
    const forced: boolean[] = []
    const responses = [json(401, {}), json(200, { id: 'x' })]
    const client = new GraphClient({
      getToken: async (force) => (forced.push(force), 't'),
      fetchImpl: async () => responses.shift()!,
      sleep: async () => undefined,
    })
    await client.get('/me')
    assert.deepEqual(forced, [false, true])
  })

  test('sends immutable-id and text-body preferences', async () => {
    let prefer = ''
    const client = new GraphClient({
      getToken: async () => 't',
      fetchImpl: async (_url, init) => {
        prefer = new Headers(init?.headers).get('prefer') ?? ''
        return json(200, {})
      },
    })
    await client.get('/me/messages')
    assert.match(prefer, /IdType="ImmutableId"/)
    assert.match(prefer, /outlook\.body-content-type="text"/)
  })

  test('surfaces Graph error codes', async () => {
    const client = new GraphClient({
      getToken: async () => 't',
      fetchImpl: async () => json(403, { error: { code: 'ErrorAccessDenied', message: 'Access is denied.' } }),
    })
    await assert.rejects(client.get('/me'), (err: unknown) => err instanceof GraphError && err.status === 403 && err.code === 'ErrorAccessDenied')
  })

  test('follows nextLink when listing', async () => {
    const pages = [json(200, { value: [1, 2], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next' }), json(200, { value: [3] })]
    const client = new GraphClient({ getToken: async () => 't', fetchImpl: async () => pages.shift()! })
    assert.deepEqual(await client.list('/me/mailFolders'), [1, 2, 3])
  })
})

describe('message mapping', () => {
  test('maps a Graph message and keeps only the headers we act on', () => {
    const m = mapMessage(
      {
        id: 'AAMk1',
        conversationId: 'conv',
        subject: 'Hello',
        body: { contentType: 'text', content: 'Body' },
        from: { emailAddress: { name: 'Ana', address: 'ana@x.example' } },
        toRecipients: [{ emailAddress: { name: 'Me', address: 'me@us.example' } }],
        receivedDateTime: '2026-03-04T10:00:00Z',
        importance: 'high',
        flag: { flagStatus: 'flagged' },
        internetMessageHeaders: [
          { name: 'Auto-Submitted', value: 'auto-replied' },
          { name: 'X-MS-Exchange-Organization-SCL', value: '1' },
        ],
      },
      { accountId: 'acc', mailboxAddress: 'me@us.example', localFolderId: 'inbox' },
    )
    assert.equal(m.id, 'acc:AAMk1')
    assert.equal(m.direction, 'inbound')
    assert.equal(m.flagged, true)
    assert.deepEqual(m.headers, { 'auto-submitted': 'auto-replied' })
  })

  test('mail from the mailbox owner is outbound', () => {
    const m = mapMessage(
      { id: 'x', from: { emailAddress: { address: 'ME@us.example' } } },
      { accountId: 'acc', mailboxAddress: 'me@us.example', localFolderId: 'sent' },
    )
    assert.equal(m.direction, 'outbound')
  })

  test('draft bodies are escaped before going into Outlook HTML', () => {
    assert.equal(textToHtml('Hi <b>\n\nLine 1\nLine 2'), '<p>Hi &lt;b&gt;</p><p>Line 1<br>Line 2</p>')
  })
})
