import { isAutomatedSender } from '../domain/guardrails'
import type { CategoryKey, Language } from '../types'
import type { DraftOutput, TriageOutput } from './schema'
import type { DraftInput, ModelProvider, TriageInput } from './types'

/**
 * The offline engine: a bilingual lexical classifier and a template drafter.
 *
 * It exists so that the whole system — pipeline, rules, guardrails, Outlook
 * writes — runs and can be evaluated with no API key, and so that a provider
 * outage degrades the service instead of stopping it. It is the last link in
 * every fallback chain. It is not as good as a model and does not pretend to
 * be: its confidence is capped below the default auto-reply threshold, so mail
 * it classified is never answered without a person.
 */

const MAX_CONFIDENCE = 0.78

type Lexicon = Record<Exclude<CategoryKey, 'internal'>, string[]>

const LEXICON: Lexicon = {
  spam: [
    'verify your account', 'confirm your password', 'account suspended', 'account will be suspended', 'click here',
    'gift card', 'wire transfer', 'bitcoin', 'crypto', 'update your payment details', 'unusual sign-in',
    'verifique su cuenta', 'verifica tu cuenta', 'contraseña', 'cuenta suspendida', 'haga clic', 'haz clic',
    'tarjeta regalo', 'transferencia urgente', 'premio', 'you have won', 'ha ganado',
  ],
  billing: [
    'invoice', 'payment', 'overdue', 'refund', 'receipt', 'remittance', 'billing', 'credit note', 'past due',
    'factura', 'pago', 'vencida', 'reembolso', 'recibo', 'cobro', 'facturación', 'nota de crédito', 'abono',
  ],
  legal: [
    'contract', 'nda', 'non-disclosure', 'agreement', 'terms and conditions', 'clause', 'lawsuit', 'gdpr',
    'data subject', 'legal', 'counsel', 'liability', 'breach',
    'contrato', 'confidencialidad', 'acuerdo', 'cláusula', 'demanda', 'rgpd', 'protección de datos', 'abogado', 'jurídico',
  ],
  scheduling: [
    'meeting', 'reschedule', 'calendar', 'availability', 'are you free', 'call on', 'catch up', 'invite', 'move our',
    'reunión', 'llamada', 'reprogramar', 'agenda', 'disponibilidad', 'cita', 'videollamada', 'nos vemos', 'quedamos',
  ],
  'sales-lead': [
    'quote', 'pricing', 'price list', 'demo', 'interested in', 'proposal', 'how much', 'trial', 'purchase', 'buy',
    'cotización', 'presupuesto', 'precio', 'tarifa', 'interesados', 'propuesta', 'demostración', 'cuánto cuesta', 'comprar',
  ],
  support: [
    'error', 'not working', "doesn't work", 'issue', 'problem', 'bug', "can't", 'cannot', 'unable to', 'help with',
    'login', 'log in', 'crash', 'broken', 'stopped working', 'not delivered', "hasn't arrived", 'where is my', 'tracking',
    'damaged', 'claim',
    'no funciona', 'problema', 'fallo', 'ayuda', 'incidencia', 'no puedo', 'no me deja', 'se cae', 'no carga',
    'no ha llegado', 'no llegó', 'dónde está', 'rastreo', 'dañado', 'reclamación',
  ],
  hr: [
    'resume', 'cv', 'application', 'vacancy', 'interview', 'payroll', 'annual leave', 'sick leave', 'job opening',
    'currículum', 'candidatura', 'vacante', 'entrevista', 'nómina', 'vacaciones', 'baja médica', 'puesto',
  ],
  vendor: [
    'supplier', 'shipment', 'purchase order', 'delivery', 'lead time', 'restock', 'our catalogue',
    'proveedor', 'envío', 'pedido', 'orden de compra', 'entrega', 'albarán', 'plazo de entrega',
  ],
  newsletter: ['newsletter', 'unsubscribe', 'weekly digest', 'this week in', 'boletín', 'darse de baja', 'darte de baja'],
  notification: [
    'do not reply', 'automated message', 'notification', 'has been shipped', 'your order', 'password was changed',
    'no responda', 'mensaje automático', 'notificación', 'su pedido', 'ha sido enviado',
  ],
  personal: ['birthday', 'dinner', 'family', 'weekend plans', 'cumpleaños', 'cena', 'familia', 'fin de semana'],
  'client-request': [
    'could you', 'can you', 'please send', 'we need', 'please update', 'as discussed', 'following up', 'our account',
    'podrían', 'podrías', 'por favor', 'necesitamos', 'nos envíen', 'según lo hablado', 'nuestra cuenta', 'le escribo',
  ],
}

const URGENT = [
  'urgent', 'asap', 'as soon as possible', 'immediately', 'today', 'critical', 'right away', 'is down', 'outage', 'blocking',
  'urgente', 'lo antes posible', 'cuanto antes', 'inmediato', 'hoy', 'crítico', 'caído', 'bloqueado', 'de inmediato',
]

const NEGATIVE = [
  'disappointed', 'unacceptable', 'frustrated', 'complaint', 'still not', 'again', 'third time', 'cancel',
  'decepcionado', 'decepcionada', 'inaceptable', 'molesto', 'molesta', 'queja', 'otra vez', 'todavía no', 'cancelar',
]

const POSITIVE = ['thank you so much', 'great job', 'delighted', 'excellent', 'muchas gracias', 'excelente', 'encantados', 'genial']

const INJECTION = [
  'ignore previous instructions', 'ignore all previous', 'ignore your instructions', 'disregard the above',
  'you are an ai', 'as an ai assistant', 'system prompt', 'ai assistant reading this', 'forward this email to',
  'ignora las instrucciones', 'ignora todas las instrucciones', 'asistente de ia', 'si eres una ia',
]

const REQUEST = [
  'please', 'could you', 'can you', 'would you', 'let me know', 'need', 'send', 'confirm',
  'por favor', 'podría', 'podrías', 'puede', 'puedes', 'necesit', 'envíe', 'envía', 'confirm', 'avísame', 'indíqueme',
]

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  domingo: 0, lunes: 1, martes: 2, miércoles: 3, miercoles: 3, jueves: 4, viernes: 5, sábado: 6, sabado: 6,
}

export function offlineTriage(raw: TriageInput['raw']): TriageOutput {
  const text = `${raw.subject}\n${raw.focus}`.toLowerCase()
  const automated = isAutomatedSender(raw.from, raw.headers)

  const scores = new Map<CategoryKey, number>()
  for (const [key, words] of Object.entries(LEXICON) as Array<[CategoryKey, string[]]>) {
    let s = 0
    for (const w of words) if (text.includes(w)) s += w.includes(' ') ? 1.5 : 1
    // "Could you…" and "por favor" appear in every kind of request; they are
    // the fallback signal, not evidence against a more specific category.
    if (key === 'client-request') s *= 0.5
    if (s > 0) scores.set(key, s)
  }

  // Structural evidence outweighs vocabulary.
  if (raw.headers['list-unsubscribe'] || raw.headers['list-id']) bump(scores, 'newsletter', 4)
  if (automated && !raw.headers['list-unsubscribe']) bump(scores, 'notification', 3)
  if (raw.internalSender) bump(scores, 'internal', 3.5)
  if ((scores.get('spam') ?? 0) >= 2) bump(scores, 'spam', 2)

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1])
  const [top, second] = ranked
  const category: CategoryKey = top ? top[0] : raw.internalSender ? 'internal' : 'client-request'
  const margin = top ? (top[1] - (second?.[1] ?? 0)) / top[1] : 0
  const confidence = round(Math.min(MAX_CONFIDENCE, 0.4 + margin * 0.3 + Math.min(top?.[1] ?? 0, 4) * 0.05))

  const urgencyHits = URGENT.filter((w) => text.includes(w)).length
  const negative = NEGATIVE.some((w) => text.includes(w))
  const positive = POSITIVE.some((w) => text.includes(w))
  const asks = raw.focus.includes('?') || raw.focus.includes('¿') || REQUEST.some((w) => text.includes(w))
  const quiet: CategoryKey[] = ['newsletter', 'notification', 'spam']

  const sentences = splitSentences(raw.focus)

  return {
    category,
    intent: INTENTS[category],
    summary: sentences.slice(0, 2).join(' ').slice(0, 280) || raw.subject,
    actionItems: quiet.includes(category)
      ? []
      : sentences.filter((s) => REQUEST.some((w) => s.toLowerCase().includes(w))).slice(0, 3),
    needsReply: !quiet.includes(category) && !automated && asks,
    urgency: round(Math.min(1, urgencyHits * 0.35 + (negative ? 0.15 : 0))),
    deadline: findDeadline(text, new Date(raw.receivedAt)),
    sentiment: negative ? 'negative' : positive ? 'positive' : 'neutral',
    confidence,
    injectionSuspected: INJECTION.some((w) => text.includes(w)),
  }
}

const INTENTS: Record<CategoryKey, string> = {
  'client-request': 'Client asks for something to be done',
  'sales-lead': 'Prospect asks about buying or pricing',
  support: 'User reports a problem or needs help',
  billing: 'Question or notice about an invoice or payment',
  scheduling: 'Arrange or change a meeting',
  legal: 'Contract or legal matter to review',
  hr: 'People or hiring matter',
  vendor: 'Supplier update or request',
  internal: 'Colleague request or update',
  newsletter: 'Newsletter or marketing content',
  notification: 'Automated notification',
  personal: 'Personal message',
  spam: 'Unsolicited or suspicious message',
}

/* ---------------------------------------------------------------- drafts -- */

const TEMPLATES: Record<Language, Partial<Record<CategoryKey, string>> & { default: string }> = {
  en: {
    support:
      "Thank you for letting us know, and sorry for the trouble. I've logged this with our support team so it is tracked, and someone will come back to you with an update shortly.",
    'sales-lead':
      "Thank you for your interest. I'd be glad to help — I'm putting together the details you asked for and will send them over shortly. If it would help, we can also set up a short call.",
    scheduling:
      "Thanks for reaching out about this. Could you share two or three times that suit you? I'll confirm one as soon as I have them.",
    'client-request':
      "Thank you for your message. I've noted your request and I'm looking into it now; I'll come back to you as soon as I have an answer.",
    vendor: "Thank you for the update. I've passed this on internally and will come back to you if we need anything further.",
    default: "Thank you for your email. I've received it and will come back to you shortly.",
  },
  es: {
    support:
      'Gracias por avisarnos y disculpe las molestias. He registrado la incidencia con nuestro equipo de soporte para que quede en seguimiento, y le escribiremos en breve con novedades.',
    'sales-lead':
      'Gracias por su interés. Con gusto le ayudo: estoy preparando la información que nos solicita y se la enviaré en breve. Si le resulta útil, también podemos agendar una llamada corta.',
    scheduling:
      '¡Gracias por escribirnos! ¿Podría indicarme dos o tres horarios que le vengan bien? Le confirmo uno en cuanto los tenga.',
    'client-request':
      'Gracias por su mensaje. He tomado nota de su solicitud y ya lo estoy revisando; le respondo en cuanto tenga una respuesta.',
    vendor: 'Gracias por la actualización. Lo he trasladado internamente y le escribiré si necesitamos algo más.',
    default: 'Gracias por su correo. Lo he recibido y le respondo a la mayor brevedad.',
  },
}

/** Categories where the template is a complete answer, not a holding reply. */
const COMPLETE: ReadonlySet<CategoryKey> = new Set(['support', 'scheduling'])

export function offlineDraft(raw: DraftInput['raw']): DraftOutput {
  const lang = raw.language
  const first = firstName(raw.senderName)
  const greeting = lang === 'es' ? (first ? `Hola ${first}:` : 'Hola:') : first ? `Hi ${first},` : 'Hello,'
  const body = TEMPLATES[lang][raw.category] ?? TEMPLATES[lang].default
  const complete = COMPLETE.has(raw.category)

  return {
    body: `${greeting}\n\n${body}\n\n${raw.signature}`.trim(),
    needsHumanInput: !complete,
    missingInfo: complete
      ? []
      : ['a specific answer to the request (rates, dates or a decision)'],
  }
}

export function offlineProvider(): ModelProvider {
  return {
    id: 'offline',
    model: 'sendero-lexical-1',
    configured: () => true,
    triage: async (input) => offlineTriage(input.raw),
    draft: async (input) => offlineDraft(input.raw),
  }
}

/* --------------------------------------------------------------- helpers -- */

function findDeadline(text: string, received: Date): string | null {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)
  if (iso) return iso[1]!

  const base = Number.isNaN(received.getTime()) ? new Date() : received
  if (/\b(today|end of day|eod|hoy|antes de que acabe el día)\b/.test(text)) return day(base, 0)
  if (/\b(tomorrow|mañana)\b/.test(text) && !/\bmañana por la\b/.test(text)) return day(base, 1)

  const m = text.match(/\b(?:by|before|until|antes del?|para el|hasta el)\s+(\w+)/)
  const target = m ? WEEKDAYS[m[1]!] : undefined
  if (target !== undefined) {
    const delta = (target - base.getUTCDay() + 7) % 7 || 7
    return day(base, delta)
  }
  return null
}

function day(from: Date, plus: number): string {
  const d = new Date(from)
  d.setUTCDate(d.getUTCDate() + plus)
  return d.toISOString().slice(0, 10)
}

const GREETING = /^(hi|hello|hey|dear|good (morning|afternoon)|hola|estimad[oa]s?|buen[oa]s (días|tardes|noches)|buen día)\b[^,:.!?\n]{0,40}[,:]\s*/i
const SIGNOFF = /^(thanks|thank you|regards|best|cheers|gracias|saludos|atentamente|un saludo)\b/i

function splitSentences(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((para) => para.replace(/\s+/g, ' ').trim().replace(GREETING, ''))
    .filter((para) => para && !SIGNOFF.test(para))
    .join(' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3)
}

function firstName(name: string): string {
  const cleaned = name.replace(/[<"].*$/, '').trim()
  if (!cleaned || cleaned.includes('@')) return ''
  return cleaned.split(/\s+/)[0] ?? ''
}

function bump(map: Map<CategoryKey, number>, key: CategoryKey, by: number): void {
  map.set(key, (map.get(key) ?? 0) + by)
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
