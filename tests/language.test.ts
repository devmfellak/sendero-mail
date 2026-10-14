import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { detectLanguage, resolveLanguage } from '../lib/domain/language'
import { stripQuoted } from '../lib/domain/quoting'

describe('language detection', () => {
  test('recognises plain Spanish business mail', () => {
    const g = detectLanguage('Hola Elena, te escribo porque necesitamos que el embarque llegue un día antes. ¿Podrían confirmarme hoy?')
    assert.equal(g.language, 'es')
    assert.ok(g.confidence >= 0.6)
  })

  test('recognises plain English business mail', () => {
    const g = detectLanguage('Hi there, could you send me the revised rates for the lane we discussed? Thanks for your help.')
    assert.equal(g.language, 'en')
    assert.ok(g.confidence >= 0.6)
  })

  test('one Spanish name in an English email does not flip it', () => {
    const g = detectLanguage('Hi Señor Muñoz, thank you for the update. We will send the documents to you this afternoon.')
    assert.equal(g.language, 'en')
  })

  test('too little text falls back to the account default', () => {
    assert.equal(resolveLanguage('OK', 'es'), 'es')
    assert.equal(resolveLanguage('', 'en'), 'en')
  })

  test('an English reply on top of a Spanish thread is English once quotes are stripped', () => {
    const body = `Thanks, that works for us. Please go ahead and book it.

El mar, 3 mar 2026 a las 10:02, Ana Torres <ana@x.example> escribió:
> Hola, ¿les parece bien el jueves para la entrega? Quedo pendiente de su confirmación.`
    assert.equal(resolveLanguage(stripQuoted(body), 'es'), 'en')
  })
})

describe('quoted text removal', () => {
  test('cuts at an Outlook header block', () => {
    const body = `Sounds good.

From: Daniel Ortega <d@acme.example>
Sent: Tuesday, March 3, 2026 10:00 AM
To: Elena
Subject: rates

Old text`
    assert.equal(stripQuoted(body), 'Sounds good.')
  })

  test('cuts at a Spanish Outlook header block', () => {
    const body = `Perfecto, gracias.

De: Mariana Castillo <m@x.example>
Enviado: martes, 3 de marzo de 2026 10:00
Para: Elena`
    assert.equal(stripQuoted(body), 'Perfecto, gracias.')
  })

  test('removes > quoted lines and mobile sign-offs', () => {
    const body = `Yes, Thursday.\n> Can you do Thursday?\n\nSent from my iPhone`
    assert.equal(stripQuoted(body), 'Yes, Thursday.')
  })
})
