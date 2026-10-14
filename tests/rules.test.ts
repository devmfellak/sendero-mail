import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateRules, orgFromDomain, renderFolderTemplate, safeRegex, testCondition, type Facts } from '../lib/domain/rules'
import type { Rule } from '../lib/types'

const facts = (over: { analysis?: Partial<Facts['analysis']>; message?: Partial<Facts['message']> } = {}): Facts => ({
  message: {
    from: { name: 'Ana Torres', address: 'ana@acme-retail.example' },
    subject: 'Invoice 4411',
    bodyText: 'Please find the invoice attached.',
    hasAttachments: true,
    receivedAt: '2026-03-04T10:00:00Z',
    ...over.message,
  },
  analysis: {
    category: 'billing',
    band: 'normal',
    priority: 40,
    language: 'en',
    needsReply: true,
    confidence: 0.9,
    sentiment: 'neutral',
    ...over.analysis,
  },
})

let n = 0
const rule = (over: Partial<Rule>): Rule => ({
  id: `r${++n}`,
  accountId: null,
  name: 'rule',
  enabled: true,
  order: 10,
  when: [],
  then: [],
  stop: false,
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
})

describe('conditions', () => {
  test('is / isNot are case-insensitive', () => {
    assert.ok(testCondition({ field: 'category', op: 'is', value: 'BILLING' }, facts()))
    assert.ok(testCondition({ field: 'language', op: 'isNot', value: 'es' }, facts()))
  })

  test('in accepts a list or a comma string', () => {
    assert.ok(testCondition({ field: 'category', op: 'in', value: ['legal', 'billing'] }, facts()))
    assert.ok(testCondition({ field: 'category', op: 'in', value: 'legal, billing' }, facts()))
  })

  test('fromDomain and numeric comparisons', () => {
    assert.ok(testCondition({ field: 'fromDomain', op: 'is', value: 'acme-retail.example' }, facts()))
    assert.ok(testCondition({ field: 'priority', op: 'gte', value: 40 }, facts()))
    assert.ok(!testCondition({ field: 'confidence', op: 'lte', value: 0.5 }, facts()))
  })

  test('body matches what the sender wrote, not what they quoted', () => {
    const f = facts({ message: { bodyText: 'Thanks!\n\nOn Tue, 3 Mar 2026 at 10:02, X <x@y.example> wrote:\n> cancel the contract' } })
    assert.ok(!testCondition({ field: 'body', op: 'contains', value: 'cancel' }, f))
  })

  test('dangerous regexes are refused rather than run', () => {
    assert.equal(safeRegex('(a+)+$'), null)
    assert.ok(safeRegex('^invoice\\s+\\d+'))
    assert.ok(!testCondition({ field: 'subject', op: 'matches', value: '(a+)+$' }, facts()))
  })
})

describe('evaluation', () => {
  test('disabled rules and other accounts are ignored', () => {
    const plan = evaluateRules(
      [
        rule({ enabled: false, then: [{ type: 'flag' }] }),
        rule({ accountId: 'other', then: [{ type: 'markRead' }] }),
        rule({ accountId: 'mine', then: [{ type: 'categorize', category: 'Finance' }] }),
      ],
      facts(),
      'mine',
    )
    assert.deepEqual(plan.actions.map((a) => a.type), ['categorize'])
  })

  test('stop halts later rules', () => {
    const plan = evaluateRules(
      [rule({ order: 1, stop: true, then: [{ type: 'flag' }] }), rule({ order: 2, then: [{ type: 'markRead' }] })],
      facts(),
      'a',
    )
    assert.deepEqual(plan.actions.map((a) => a.type), ['flag'])
  })

  test('the first move wins and moves run last', () => {
    const plan = evaluateRules(
      [
        rule({ order: 1, then: [{ type: 'move', folder: 'Finance' }] }),
        rule({ order: 2, then: [{ type: 'move', folder: 'Elsewhere' }, { type: 'flag' }] }),
      ],
      facts(),
      'a',
    )
    assert.deepEqual(plan.actions.map((a) => a.type), ['flag', 'move'])
    assert.equal((plan.actions[1] as { folder: string }).folder, 'Finance')
  })

  test('only one reply per message, and autoReply outranks draftReply', () => {
    const plan = evaluateRules(
      [rule({ order: 1, then: [{ type: 'draftReply' }] }), rule({ order: 2, then: [{ type: 'autoReply' }] })],
      facts(),
      'a',
    )
    const replies = plan.actions.filter((a) => a.type === 'draftReply' || a.type === 'autoReply')
    assert.equal(replies.length, 1)
    assert.equal(replies[0]!.type, 'autoReply')
  })

  test('account rules run before global rules at the same order', () => {
    const plan = evaluateRules(
      [
        rule({ order: 5, accountId: null, then: [{ type: 'move', folder: 'Global' }] }),
        rule({ order: 5, accountId: 'a', then: [{ type: 'move', folder: 'Mine' }] }),
      ],
      facts(),
      'a',
    )
    assert.equal((plan.actions[0] as { folder: string }).folder, 'Mine')
  })
})

describe('folder templates', () => {
  test('fills placeholders and sanitises', () => {
    assert.equal(renderFolderTemplate('Clients/{senderOrg}/{year}', facts(), 'en'), 'Clients/Acme Retail/2026')
    assert.equal(renderFolderTemplate('Leads/{language}', facts({ analysis: { language: 'es' } }), 'en'), 'Leads/ES')
    assert.equal(renderFolderTemplate('By/{category}', facts(), 'es'), 'By/Facturación')
  })

  test('an empty value collapses its segment', () => {
    const f = facts({ message: { from: { name: '', address: 'broken' } } })
    assert.equal(renderFolderTemplate('Clients/{senderOrg}', f, 'en'), 'Clients')
  })

  test('organisation names from domains, including two-level TLDs', () => {
    assert.equal(orgFromDomain('mail.acme-corp.co.uk'), 'Acme Corp')
    assert.equal(orgFromDomain('gruponorte.com.mx'), 'Gruponorte')
    assert.equal(orgFromDomain('sat.gob.mx'), 'Sat')
  })
})
