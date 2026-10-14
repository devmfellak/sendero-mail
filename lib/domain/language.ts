import type { Language } from '../types'

/**
 * English / Spanish detection without a model.
 *
 * The language of a reply is too important to leave to the model's mood: a
 * client who writes in Spanish and gets an answer in English has been told
 * something about how much attention they are getting. So the language is
 * decided here, deterministically, from the sender's own words, and the model
 * is instructed rather than asked.
 *
 * Stop-word frequency is crude and very good at this particular job: the two
 * languages share an alphabet but almost none of their hundred most common
 * words. Diacritics and inverted punctuation are a strong secondary signal.
 * Quoted history must be stripped before calling this — an English reply on
 * top of a Spanish thread is an English message.
 */

const EN = new Set(
  `the and to of a in is it you that for on with this be are have i we as at
  your our will can not but from or by please thanks thank would could should
  if an was do let me my any know just about get there here what when which
  hi hello regards best dear sincerely kind morning afternoon`.split(/\s+/),
)

const ES = new Set(
  `el la los las de que y en un una es por con para no se su al lo como mas
  pero sus le ya o este esta si porque muy sin sobre también me hay donde
  quien desde todo nos durante uno les ni contra otros ese eso ante ellos
  e esto mí antes algunos qué unos yo otro otras otra él tanto esa estos
  mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros
  hola gracias saludos estimado estimada atentamente buenos buenas días favor
  usted ustedes quedo pendiente cordial cordiales`.split(/\s+/),
)

export interface LanguageGuess {
  language: Language
  /** 0–1. Below ~0.6 the caller should fall back to the account default. */
  confidence: number
}

export function detectLanguage(text: string, fallback: Language = 'en'): LanguageGuess {
  const lower = text.toLowerCase()
  const words = lower.match(/[a-záéíóúüñ]+/g) ?? []
  if (words.length === 0) return { language: fallback, confidence: 0 }

  let en = 0
  let es = 0
  for (const w of words) {
    if (EN.has(w)) en++
    if (ES.has(w)) es++
  }

  // Characters English does not use. Weighted per occurrence but capped, so a
  // single "Señor" in an English email does not flip it.
  const marks = (lower.match(/[ñáéíóú¿¡]/g) ?? []).length
  es += Math.min(marks, 6) * 0.75

  const total = en + es
  if (total < 2) return { language: fallback, confidence: 0.3 }

  const language: Language = es > en ? 'es' : 'en'
  const margin = Math.abs(es - en) / total
  // Short texts are less certain however lopsided they look.
  const lengthFactor = Math.min(1, words.length / 25)
  return { language, confidence: round(0.5 + margin * 0.5 * lengthFactor) }
}

export function resolveLanguage(text: string, fallback: Language): Language {
  const guess = detectLanguage(text, fallback)
  return guess.confidence >= 0.6 ? guess.language : fallback
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
