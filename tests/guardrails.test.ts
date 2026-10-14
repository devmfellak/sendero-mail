import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { checkAutoReply, findUngroundedEntities, inQuietHours, isAutomatedSender, type GuardInput } from '../lib/domain/guardrails'
import type { AccountSettings } from '../lib/types'

const settings = (over: Partial<AccountSettings> = {}): AccountSettings => ({
  mode: 'auto',
  autoReplyMinConfidence: 0.8,
  maxAutoRepliesPerHour: 10,
  quietHours: null,
  timeZone: 'UTC',
  internalDomains: [],
  vipSenders: [],
  defaultLanguage: 'en',
  followUpDays: 2,
  signature: { en: 'Support', es: 'Soporte' },
  knowledge: 'Tracking: https://track.example.com',
  tone: 'neutral',
  ...over,
})

const input = (over: Partial<GuardInput> = {}): GuardInput => ({
  settings: settings(),
  analysis: { category: 'support', confidence: 0.92, injectionSuspected: false, needsReply: true },
  message: { from: { name: 'Ana', address: 'ana@client.example' }, headers: {}, conversationId: 'c1' },
  draftBody: 'Hi Ana, thanks for letting us know. You can follow the shipment at https://track.example.com.',
  groundingText: 'Tracking: https://track.example.com',
  sentLastHour: 0,
  autoRepliedRecently: false,
  now: new Date('2026-03-04T12:00:00Z'),
  ...over,
})

describe('auto-reply guardrails', () => {
  test('a clean, grounded support reply may send', () => {
    assert.deepEqual(checkAutoReply(input()), { decision: 'send', reasons: [] })
  })

  test('assist mode downgrades to a draft', () => {
    const r = checkAutoReply(input({ settings: settings({ mode: 'assist' }) }))
    assert.equal(r.decision, 'draft')
    assert.match(r.reasons[0]!, /assist mode/)
  })

  test('sensitive categories are never auto-answered', () => {
    for (const category of ['legal', 'billing', 'hr', 'spam'] as const) {
      const r = checkAutoReply(input({ analysis: { category, confidence: 0.99, injectionSuspected: false, needsReply: true } }))
      assert.equal(r.decision, 'draft', category)
    }
  })

  test('every failing check is reported, not just the first', () => {
    const r = checkAutoReply(
      input({
        settings: settings({ mode: 'assist' }),
        analysis: { category: 'support', confidence: 0.5, injectionSuspected: true, needsReply: true },
        sentLastHour: 10,
      }),
    )
    assert.equal(r.reasons.length, 4)
  })

  test('suspected prompt injection holds the reply', () => {
    const r = checkAutoReply(input({ analysis: { category: 'support', confidence: 0.95, injectionSuspected: true, needsReply: true } }))
    assert.equal(r.decision, 'draft')
  })

  test('automated senders are skipped entirely, to prevent mail loops', () => {
    assert.equal(checkAutoReply(input({ message: { from: { name: '', address: 'no-reply@x.example' }, headers: {}, conversationId: 'c' } })).decision, 'skip')
    assert.equal(
      checkAutoReply(input({ message: { from: { name: '', address: 'a@x.example' }, headers: { 'auto-submitted': 'auto-replied' }, conversationId: 'c' } })).decision,
      'skip',
    )
  })

  test('one automatic reply per conversation per day', () => {
    assert.equal(checkAutoReply(input({ autoRepliedRecently: true })).decision, 'draft')
  })

  test('quiet hours, including windows that wrap midnight', () => {
    const quiet = { start: 22, end: 7 }
    assert.ok(inQuietHours(new Date('2026-03-04T23:30:00Z'), quiet, 'UTC'))
    assert.ok(inQuietHours(new Date('2026-03-04T03:00:00Z'), quiet, 'UTC'))
    assert.ok(!inQuietHours(new Date('2026-03-04T12:00:00Z'), quiet, 'UTC'))
    // 05:00 UTC is 23:00 the previous day in Mexico City (UTC-6).
    assert.ok(inQuietHours(new Date('2026-03-04T05:00:00Z'), quiet, 'America/Mexico_City'))
  })
})

describe('grounding', () => {
  test('flags links, phone numbers and amounts that came from nowhere', () => {
    const found = findUngroundedEntities(
      'Pay $2,500 at https://evil.example/pay or call +1 (555) 010-9999. Tracking: https://track.example.com',
      'Tracking: https://track.example.com',
    )
    assert.ok(found.includes('$2,500'))
    assert.ok(found.includes('https://evil.example/pay'))
    assert.ok(found.some((f) => f.includes('555')))
    assert.ok(!found.includes('https://track.example.com'))
  })

  test('a phone number formatted differently from the knowledge still counts as grounded', () => {
    assert.deepEqual(findUngroundedEntities('Call us on +52 55 5000 1234.', 'Phone: +52-55-5000-1234'), [])
  })

  test('an injected message cannot get its link sent', () => {
    const r = checkAutoReply(input({ draftBody: 'Hi, please confirm your details at https://evil.example/login so we can help.' }))
    assert.equal(r.decision, 'draft')
    assert.match(r.reasons.join(' '), /evil\.example/)
  })
})

describe('automated sender detection', () => {
  test('headers and addresses', () => {
    assert.ok(isAutomatedSender('news@x.example', { 'list-unsubscribe': '<mailto:u@x>' }))
    assert.ok(isAutomatedSender('mailer-daemon@x.example', {}))
    assert.ok(isAutomatedSender('notifications+abc@x.example', {}))
    assert.ok(!isAutomatedSender('ana@x.example', { 'auto-submitted': 'no' }))
  })
})
