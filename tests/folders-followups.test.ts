import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { planFolder, folderTree } from '../lib/domain/folders'
import { addBusinessDays, asksForResponse, followUpFor } from '../lib/domain/followups'
import { buildThread, renderThread } from '../lib/domain/thread'
import type { Folder, MailMessage } from '../lib/types'

const folder = (id: string, name: string, parentId: string | null, path: string, wellKnown?: Folder['wellKnown']): Folder => ({
  id,
  accountId: 'a',
  parentId,
  displayName: name,
  path,
  wellKnown,
})

describe('folder planning', () => {
  const existing = [folder('1', 'Inbox', null, 'Inbox', 'inbox'), folder('2', 'Clients', null, 'Clients'), folder('3', 'Acme', '2', 'Clients/Acme')]

  test('only the missing levels are created, outermost first', () => {
    const plan = planFolder(existing, 'a', 'Clients/Acme/Invoices/2026')
    assert.equal(plan.existing?.id, '3')
    assert.deepEqual(plan.toCreate, ['Invoices', '2026'])
  })

  test('matching is case-insensitive, as in Exchange', () => {
    assert.deepEqual(planFolder(existing, 'a', 'clients/ACME').toCreate, [])
  })

  test('another account’s folders do not count', () => {
    assert.deepEqual(planFolder(existing, 'b', 'Clients').toCreate, ['Clients'])
  })

  test('the tree puts well-known folders first', () => {
    const tree = folderTree([...existing, folder('4', 'Archive', null, 'Archive', 'archive')])
    assert.deepEqual(tree.map((f) => `${f.depth}:${f.displayName}`), ['0:Inbox', '0:Archive', '0:Clients', '1:Acme'])
  })
})

const msg = (over: Partial<MailMessage>): MailMessage => ({
  id: 'm',
  accountId: 'a',
  providerId: 'm',
  conversationId: 'c',
  internetMessageId: '',
  folderId: 'f',
  direction: 'inbound',
  from: { name: 'Ana', address: 'ana@client.example' },
  to: [{ name: 'Me', address: 'me@us.example' }],
  cc: [],
  subject: 'S',
  bodyText: 'Hello',
  receivedAt: '2026-03-02T10:00:00Z',
  isRead: false,
  flagged: false,
  importance: 'normal',
  categories: [],
  hasAttachments: false,
  headers: {},
  ...over,
})

describe('follow-ups', () => {
  test('business days skip the weekend', () => {
    // Friday + 1 business day = Monday.
    assert.equal(addBusinessDays(new Date('2026-03-06T10:00:00Z'), 1).toISOString().slice(0, 10), '2026-03-09')
  })

  test('their unanswered question is on us', () => {
    const c = followUpFor([msg({ id: 'q' })], new Map([['q', { needsReply: true, category: 'client-request' as const }]]), 2)
    assert.equal(c?.kind, 'awaiting-us')
  })

  test('our unanswered question is on them', () => {
    const c = followUpFor([msg({ id: 'o', direction: 'outbound', bodyText: '¿Nos confirma el jueves?' })], new Map(), 2)
    assert.equal(c?.kind, 'awaiting-them')
  })

  test('a reply closes it, wherever it was sent from', () => {
    const conversation = [
      msg({ id: 'q', receivedAt: '2026-03-02T10:00:00Z' }),
      msg({ id: 'r', direction: 'outbound', bodyText: 'Done, attached.', receivedAt: '2026-03-02T11:00:00Z' }),
    ]
    assert.equal(followUpFor(conversation, new Map([['q', { needsReply: true, category: 'client-request' as const }]]), 2), null)
  })

  test('statements are not questions', () => {
    assert.equal(asksForResponse('Attached is the signed copy. Thanks!'), false)
    assert.equal(asksForResponse('Quedo atento a sus comentarios.'), true)
  })
})

describe('thread context', () => {
  test('keeps the focus message whole and marks omitted history', () => {
    const long = 'x'.repeat(600)
    const messages = Array.from({ length: 6 }, (_, i) => msg({ id: `m${i}`, bodyText: long, receivedAt: `2026-03-0${i + 1}T10:00:00Z` }))
    const ctx = buildThread(messages, 'm5', 1500)
    assert.equal(ctx.turns.at(-1)!.text, long)
    assert.ok(ctx.omitted > 0)
    assert.match(renderThread(ctx), /earlier message\(s\) omitted/)
  })

  test('messages after the focus are not included', () => {
    const ctx = buildThread([msg({ id: 'a', receivedAt: '2026-03-01T00:00:00Z' }), msg({ id: 'b', receivedAt: '2026-03-02T00:00:00Z' })], 'a')
    assert.equal(ctx.turns.length, 1)
  })
})
