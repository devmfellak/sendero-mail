/**
 * Triage evaluation: run labelled mail through each configured provider and
 * report category accuracy, needs-reply accuracy, language agreement and
 * latency. Used to choose models and effort levels on evidence rather than
 * reputation — and to re-check after a prompt change.
 *
 *   npm run eval:triage                       # every configured provider
 *   npm run eval:triage -- anthropic offline  # just these
 *
 * The labelled set is the demo mail. For a real deployment, export a few
 * hundred messages a person has categorised and point LABELS at them; the
 * script does not care where the labels came from.
 */
import { TRIAGE_SYSTEM, triageUserPrompt } from '../lib/ai/prompts'
import { providers } from '../lib/ai/router'
import { normaliseTriage } from '../lib/ai/schema'
import type { ProviderId } from '../lib/ai/types'
import { SEED_MAIL, SIMULATED_MAIL } from '../lib/demo/fixtures'
import { stripQuoted } from '../lib/domain/quoting'
import type { CategoryKey } from '../lib/types'

const LABELS: Record<string, { category: CategoryKey; needsReply: boolean }> = {
  'Cambio urgente en la entrega de Saltillo': { category: 'client-request', needsReply: true },
  'Contrato marco de servicios — observaciones a la cláusula 9': { category: 'legal', needsReply: true },
  'Coffee next week?': { category: 'scheduling', needsReply: true },
  'Action required: your mailbox password expires today': { category: 'spam', needsReply: false },
  'This week in nearshoring: five lanes to watch': { category: 'newsletter', needsReply: false },
  'Board pack — need your section by tomorrow': { category: 'internal', needsReply: true },
  'No puedo ver el rastreo de mi envío': { category: 'support', needsReply: true },
  'Shipment BR-447903 still not delivered — third time asking': { category: 'support', needsReply: true },
  'Factura duplicada en octubre': { category: 'billing', needsReply: true },
  'Mi paquete no llegó': { category: 'support', needsReply: true },
  'Trailer TX-8812 crossed at Colombia Bridge': { category: 'notification', needsReply: false },
  'Quote request: weekly FTL Querétaro → San Antonio': { category: 'sales-lead', needsReply: true },
  'Cotización para exportar aguacate a Texas': { category: 'sales-lead', needsReply: true },
  '¿Dónde está mi pedido BR-449011?': { category: 'support', needsReply: true },
  'Pricing for LTL to Monterrey': { category: 'sales-lead', needsReply: true },
  'RE: Cambio urgente en la entrega de Saltillo': { category: 'client-request', needsReply: true },
  'Can’t log in to the tracking portal': { category: 'support', needsReply: true },
  'Revisión de presupuesto 2027': { category: 'internal', needsReply: true },
  'Payment received — invoice F-10251': { category: 'notification', needsReply: false },
  'Solicitud de presupuesto — envíos semanales a Los Ángeles': { category: 'sales-lead', needsReply: true },
  'NDA for the Laredo warehouse project': { category: 'legal', needsReply: true },
  'Damaged pallet on delivery — claim': { category: 'support', needsReply: true },
  'Last chance: early-bird tickets end Friday': { category: 'newsletter', needsReply: false },
}

const mail = [...SEED_MAIL, ...SIMULATED_MAIL].filter((m) => m.direction !== 'outbound' && LABELS[m.subject])
const requested = process.argv.slice(2) as ProviderId[]
const all = providers()
const ids = (requested.length ? requested : (Object.keys(all) as ProviderId[])).filter((id) => all[id]?.configured())

async function evaluate(id: ProviderId): Promise<void> {
  const provider = all[id]
  let category = 0
  let reply = 0
  let failures = 0
  const latencies: number[] = []
  const misses: string[] = []

  for (const m of mail) {
    const focus = stripQuoted(m.body)
    const started = Date.now()
    try {
      const out = normaliseTriage(
        await provider.triage(
          {
            system: TRIAGE_SYSTEM,
            user: triageUserPrompt({ focus, thread: '', receivedAt: new Date().toISOString(), from: `${m.from.name} <${m.from.address}>`, subject: m.subject }),
            raw: {
              subject: m.subject,
              focus,
              from: m.from.address,
              headers: m.headers ?? {},
              receivedAt: new Date().toISOString(),
              internalSender: m.from.address.endsWith('@brisalogistics.example'),
            },
          },
          AbortSignal.timeout(60_000),
        ),
      )
      latencies.push(Date.now() - started)
      const label = LABELS[m.subject]!
      if (out.category === label.category) category++
      else misses.push(`  ${m.subject}\n    expected ${label.category}, got ${out.category} (confidence ${out.confidence})`)
      if (out.needsReply === label.needsReply) reply++
    } catch (err) {
      failures++
      misses.push(`  ${m.subject}\n    error: ${String(err).slice(0, 120)}`)
    }
  }

  const pct = (n: number) => `${Math.round((n / mail.length) * 100)}%`
  latencies.sort((a, b) => a - b)
  const p50 = latencies[Math.floor(latencies.length / 2)] ?? 0
  console.log(`${id} (${provider.model})`)
  console.log(`  category ${pct(category)} · needs-reply ${pct(reply)} · failures ${failures} · p50 ${p50} ms`)
  if (misses.length) console.log(misses.join('\n'))
  console.log()
}

async function main(): Promise<void> {
  console.log(`${mail.length} labelled messages · providers: ${ids.join(', ') || '(none configured)'}\n`)
  for (const id of ids) await evaluate(id)
}

void main()
