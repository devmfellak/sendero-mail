import type { AccountSettings } from '../types'

/**
 * Settings for a mailbox connected for the first time.
 *
 * Observe mode, always. The agent classifies and records what it *would* have
 * done; the owner reads a week of that, adjusts the rules, and only then lets
 * it touch the mailbox. Trust is earned in that order or not at all.
 */
export function seedSettingsForNewAccount(identity: { name: string; email: string }): AccountSettings {
  const domain = identity.email.split('@')[1]?.toLowerCase() ?? ''
  const name = identity.name || identity.email
  return {
    mode: 'observe',
    autoReplyMinConfidence: 0.85,
    maxAutoRepliesPerHour: 10,
    quietHours: { start: 20, end: 7 },
    timeZone: 'America/Mexico_City',
    internalDomains: domain ? [domain] : [],
    vipSenders: [],
    defaultLanguage: 'en',
    followUpDays: 2,
    signature: { en: `Best regards,\n${name}`, es: `Un saludo,\n${name}` },
    knowledge: '',
    tone: 'neutral',
  }
}
