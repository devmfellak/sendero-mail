import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'

import { Store } from '../lib/store/store'
import { seedData, ACCOUNT_IDS } from '../lib/demo/seed'
import { setStore, store } from '../lib/runtime'
import { processMessage } from '../lib/agent/pipeline'
import { approveDraft } from '../lib/agent/drafts'
import { setProviders, providers } from '../lib/ai/router'
import { resetEnv } from '../lib/env'

// Run against the offline engine only, whatever keys the shell has.
// Configuration is read lazily, so setting it here, after the imports, is in time.
process.env.AI_TRIAGE_ORDER = 'offline'
process.env.AI_DRAFT_ORDER = 'offline'
resetEnv()

/**
 * The whole agent, end to end, against the simulated mailboxes: real rules,
 * real guardrails, real folder creation — everything but a network.
 */

const bySubject = (subject: string) => store().read.messages.find((m) => m.subject === subject)!
const folderOf = (subject: string) => store().read.folders.find((f) => f.id === bySubject(subject).folderId)?.path

before(async () => {
  setStore(new Store(null, seedData))
  const inbound = store().read.messages.filter((m) => m.direction === 'inbound')
  for (const m of inbound) await processMessage(m.id, { now: new Date() })
  for (const m of store().read.messages.filter((x) => x.direction === 'outbound')) await processMessage(m.id)
})

describe('pipeline (offline engine, demo mailboxes)', () => {
  test('every inbound message is analysed exactly once', async () => {
    const inbound = store().read.messages.filter((m) => m.direction === 'inbound')
    assert.equal(Object.keys(store().read.analyses).length, inbound.length)
    const before = store().read.activity.length
    await processMessage(inbound[0]!.id)
    assert.equal(store().read.activity.length, before, 're-processing is a no-op')
  })

  test('phishing is quarantined and nothing else happens to it', () => {
    const subject = 'Action required: your mailbox password expires today'
    assert.equal(folderOf(subject), 'Review/Suspicious')
    assert.deepEqual(bySubject(subject).categories, ['Suspicious'])
    assert.equal(store().read.drafts.filter((d) => d.messageId === bySubject(subject).id).length, 0)
  })

  test('newsletters are filed and marked read', () => {
    const m = bySubject('This week in nearshoring: five lanes to watch')
    assert.equal(folderOf(m.subject), 'Reading')
    assert.equal(m.isRead, true)
  })

  test('notifications are filed by sender organisation, creating the folders', () => {
    assert.equal(folderOf('Trailer TX-8812 crossed at Colombia Bridge'), 'Notifications/Carrier Updates')
  })

  test('a VIP client’s urgent Spanish request is urgent, filed, flagged and drafted in Spanish', () => {
    const m = bySubject('Cambio urgente en la entrega de Saltillo')
    const a = store().read.analyses[m.id]!
    assert.equal(a.band, 'urgent')
    assert.equal(a.language, 'es')
    assert.equal(folderOf(m.subject), 'Clientes/Gruponorte')
    assert.equal(m.flagged, true)
    const draft = store().read.drafts.find((d) => d.messageId === m.id)!
    assert.equal(draft.language, 'es')
    assert.equal(draft.status, 'pending')
    assert.match(draft.body, /^Hola Mariana:/)
  })

  test('legal mail is held for review and never drafted automatically', () => {
    const m = bySubject('Contrato marco de servicios — observaciones a la cláusula 9')
    assert.equal(folderOf(m.subject), 'Legal/Por revisar')
    assert.equal(m.flagged, true)
    assert.equal(store().read.drafts.filter((d) => d.messageId === m.id).length, 0)
  })

  test('a clear support request is acknowledged automatically and filed', () => {
    const m = bySubject('No puedo ver el rastreo de mi envío')
    const draft = store().read.drafts.find((d) => d.messageId === m.id)!
    assert.equal(draft.status, 'sent')
    assert.equal(draft.decidedBy, 'agent')
    assert.match(folderOf(m.subject)!, /^Tickets\/\d{4}-\d{2}$/)
  })

  test('a vague, angry support request stays below the confidence bar and is held, with reasons', () => {
    const m = bySubject('Shipment BR-447903 still not delivered — third time asking')
    const draft = store().read.drafts.find((d) => d.messageId === m.id)!
    assert.equal(draft.status, 'pending')
    assert.match(draft.reason, /confidence/i)
    assert.ok(store().read.followUps.some((f) => f.messageId === m.id && f.status === 'open'))
  })

  test('the prompt-injection attempt is flagged and its reply held', () => {
    const m = bySubject('Mi paquete no llegó')
    assert.equal(store().read.analyses[m.id]!.injectionSuspected, true)
    const draft = store().read.drafts.find((d) => d.messageId === m.id)
    if (draft) assert.match(draft.reason, /instructions aimed at an AI/)
  })

  test('automated notifications get no reply at all', () => {
    const m = bySubject('Trailer TX-8812 crossed at Colombia Bridge')
    assert.equal(store().read.drafts.filter((d) => d.messageId === m.id).length, 0)
  })

  test('our own unanswered question becomes an awaiting-them follow-up', () => {
    const f = store().read.followUps.find((x) => x.accountId === ACCOUNT_IDS.sales && x.kind === 'awaiting-them')
    assert.ok(f)
    assert.equal(f.counterpart.address, 'mark.ellison@orbit-parts.com')
  })

  test('approving a draft sends it, threads it, and closes the follow-up', async () => {
    const m = bySubject('Quote request: weekly FTL Querétaro → San Antonio')
    const draft = store().read.drafts.find((d) => d.messageId === m.id && d.status === 'pending')!
    assert.ok(store().read.followUps.some((f) => f.conversationId === m.conversationId && f.status === 'open'))

    await approveDraft(draft.id, `${draft.body}\n\nP.S. Yes, we handle customs brokerage.`, 'tester')
    await processMessage(store().read.messages.at(-1)!.id)

    const sent = store().read.messages.filter((x) => x.conversationId === m.conversationId && x.direction === 'outbound')
    assert.equal(sent.length, 1)
    assert.match(sent[0]!.bodyText, /customs brokerage/)
    assert.equal(sent[0]!.subject, `Re: ${m.subject}`)
    assert.equal(store().read.drafts.find((d) => d.id === draft.id)!.status, 'sent')
    assert.ok(!store().read.followUps.some((f) => f.conversationId === m.conversationId && f.status === 'open'))
  })
})

describe('pipeline with a confident model', () => {
  test('a clean support request is acknowledged automatically, and only once', async () => {
    setStore(new Store(null, seedData))
    process.env.AI_TRIAGE_ORDER = 'anthropic'
    process.env.AI_DRAFT_ORDER = 'anthropic'
    const real = providers()
    setProviders({
      ...real,
      anthropic: {
        id: 'anthropic',
        model: 'fake',
        configured: () => true,
        triage: async () => ({
          category: 'support', intent: 'Portal login problem', summary: 'No puede ver el rastreo.', actionItems: [],
          needsReply: true, urgency: 0.3, deadline: null, sentiment: 'neutral', confidence: 0.95, injectionSuspected: false,
        }),
        draft: async () => ({
          body: 'Hola Ricardo:\n\nGracias por avisarnos. Puede restablecer su acceso con "Olvidé mi contraseña" en https://track.brisalogistics.mx y una persona del equipo le responderá en un día hábil.\n\nSoporte Brisa Logistics\nhttps://track.brisalogistics.mx',
          needsHumanInput: false,
          missingInfo: [],
        }),
      },
    })

    resetEnv()

    const m = store().read.messages.find((x) => x.subject === 'No puedo ver el rastreo de mi envío')!
    // Noon in Mexico City, outside the support account's quiet hours.
    await processMessage(m.id, { now: new Date('2026-03-04T18:00:00Z') })

    const draft = store().read.drafts.find((d) => d.messageId === m.id)!
    assert.equal(draft.status, 'sent', draft.reason)
    assert.equal(draft.decidedBy, 'agent')

    await processMessage(m.id, { force: true, now: new Date('2026-03-04T18:05:00Z') })
    const again = store().read.drafts.filter((d) => d.messageId === m.id && d.status === 'pending')
    assert.equal(again.length, 1)
    assert.match(again[0]!.reason, /Already replied automatically/)
    setProviders(null)
  })
})
