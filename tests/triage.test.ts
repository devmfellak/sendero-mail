import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { offlineTriage, offlineDraft } from '../lib/ai/offline'
import { normaliseTriage } from '../lib/ai/schema'
import { scorePriority, bandFor, isVip } from '../lib/domain/priority'
import { SEED_MAIL } from '../lib/demo/fixtures'

const triage = (subject: string, body: string, extra: { from?: string; headers?: Record<string, string>; internal?: boolean } = {}) =>
  offlineTriage({
    subject,
    focus: body,
    from: extra.from ?? 'person@client.example',
    headers: extra.headers ?? {},
    receivedAt: '2026-03-04T10:00:00Z',
    internalSender: extra.internal ?? false,
  })

describe('offline classifier', () => {
  const expected: Record<string, string> = {
    'Cambio urgente en la entrega de Saltillo': 'client-request',
    'Contrato marco de servicios — observaciones a la cláusula 9': 'legal',
    'Coffee next week?': 'scheduling',
    'Action required: your mailbox password expires today': 'spam',
    'This week in nearshoring: five lanes to watch': 'newsletter',
    'No puedo ver el rastreo de mi envío': 'support',
    'Shipment BR-447903 still not delivered — third time asking': 'support',
    'Factura duplicada en octubre': 'billing',
    'Mi paquete no llegó': 'support',
    'Trailer TX-8812 crossed at Colombia Bridge': 'notification',
    'Quote request: weekly FTL Querétaro → San Antonio': 'sales-lead',
    'Cotización para exportar aguacate a Texas': 'sales-lead',
  }

  for (const mail of SEED_MAIL.filter((m) => m.direction !== 'outbound' && expected[m.subject])) {
    test(`"${mail.subject}" → ${expected[mail.subject]}`, () => {
      const t = triage(mail.subject, mail.body, {
        from: mail.from.address,
        headers: mail.headers,
        internal: mail.from.address.endsWith('@brisalogistics.example'),
      })
      assert.equal(t.category, expected[mail.subject])
    })
  }

  test('generic request phrasing does not outweigh a specific category', () => {
    const t = triage('Pricing for LTL to Monterrey', 'Hello, could you send pricing and transit times for LTL to Monterrey twice a month?')
    assert.equal(t.category, 'sales-lead')
    // The greeting is trimmed, not the sentence it starts.
    assert.match(t.summary, /^could you send pricing/i)
  })

  test('a colleague is internal', () => {
    const mail = SEED_MAIL.find((m) => m.subject.startsWith('Board pack'))!
    assert.equal(triage(mail.subject, mail.body, { from: mail.from.address, internal: true }).category, 'internal')
  })

  test('prompt injection is noticed', () => {
    const mail = SEED_MAIL.find((m) => m.subject === 'Mi paquete no llegó')!
    assert.equal(triage(mail.subject, mail.body).injectionSuspected, true)
  })

  test('automated mail never needs a reply', () => {
    const t = triage('Your order', 'Do not reply. Can you believe it shipped?', { from: 'no-reply@shop.example' })
    assert.equal(t.needsReply, false)
  })

  test('confidence is capped below the default auto-reply threshold', () => {
    const t = triage('Error', 'The portal is not working, error on login, cannot sign in, problem, help with login please')
    assert.ok(t.confidence <= 0.78)
  })

  test('deadlines: explicit dates, today, and weekdays', () => {
    assert.equal(triage('x', 'Please reply before 2026-03-10.').deadline, '2026-03-10')
    assert.equal(triage('x', 'Necesito respuesta hoy.').deadline, '2026-03-04')
    // 2026-03-04 is a Wednesday; "by Friday" is the 6th.
    assert.equal(triage('x', 'Could you confirm by Friday?').deadline, '2026-03-06')
  })
})

describe('offline drafts', () => {
  test('replies in the requested language with the signature', () => {
    const d = offlineDraft({ language: 'es', subject: 's', focus: 'f', senderName: 'Ricardo Peña', signature: 'Soporte', knowledge: '', category: 'support' })
    assert.match(d.body, /^Hola Ricardo:/)
    assert.match(d.body, /Soporte$/)
    assert.equal(d.needsHumanInput, false)
  })

  test('holding replies say a person must fill in the answer', () => {
    const d = offlineDraft({ language: 'en', subject: 's', focus: 'f', senderName: '', signature: 'S', knowledge: '', category: 'sales-lead' })
    assert.equal(d.needsHumanInput, true)
    assert.match(d.body, /^Hello,/)
  })
})

describe('model output normalisation', () => {
  test('clamps, rescales 0–100 answers and rejects malformed dates', () => {
    const n = normaliseTriage({
      category: 'support',
      intent: '  x ',
      summary: 's',
      actionItems: ['a', ' ', 'b'],
      needsReply: true,
      urgency: 85,
      deadline: 'next Friday',
      sentiment: 'neutral',
      confidence: 1.7,
      injectionSuspected: false,
    })
    assert.equal(n.urgency, 0.85)
    assert.equal(n.confidence, 0.02)
    assert.equal(n.deadline, null)
    assert.deepEqual(n.actionItems, ['a', 'b'])
  })
})

describe('priority', () => {
  const account = { address: 'me@us.example', settings: { vipSenders: ['@bigclient.example'] } }
  const msg = (over: Record<string, unknown> = {}) => ({
    accountId: 'a',
    from: { name: '', address: 'ceo@bigclient.example' },
    to: [{ name: '', address: 'me@us.example' }],
    cc: [],
    importance: 'normal' as const,
    headers: {},
    ...over,
  })
  const now = new Date('2026-03-04T10:00:00Z')

  test('VIP, urgency and a near deadline make it urgent, with reasons', () => {
    const r = scorePriority(
      { category: 'client-request', urgency: 0.8, needsReply: true, sentiment: 'neutral', deadline: '2026-03-04' },
      msg(),
      account,
      now,
    )
    assert.equal(r.band, 'urgent')
    const labels = r.factors.map((f) => f.label)
    assert.ok(labels.includes('VIP sender'))
    assert.ok(labels.includes('Deadline within 24 h'))
  })

  test('being only copied lowers priority', () => {
    const base = { category: 'internal' as const, urgency: 0, needsReply: false, sentiment: 'neutral' as const, deadline: null }
    const to = scorePriority(base, msg({ from: { name: '', address: 'x@us.example' } }), account, now)
    const cc = scorePriority(base, msg({ from: { name: '', address: 'x@us.example' }, to: [], cc: [{ name: '', address: 'me@us.example' }] }), account, now)
    assert.ok(cc.score < to.score)
  })

  test('spam stays at the floor however urgent it sounds', () => {
    const r = scorePriority({ category: 'spam', urgency: 1, needsReply: true, sentiment: 'negative', deadline: '2026-03-04' }, msg({ importance: 'high' }), account, now)
    assert.equal(r.score, 0)
    assert.equal(r.band, 'low')
  })

  test('bands and VIP matching', () => {
    assert.deepEqual([bandFor(80), bandFor(60), bandFor(30), bandFor(10)], ['urgent', 'high', 'normal', 'low'])
    assert.ok(isVip('Ana@BigClient.example', ['@bigclient.example']))
    assert.ok(!isVip('ana@notbigclient.example.org', ['@bigclient.example']))
  })
})
