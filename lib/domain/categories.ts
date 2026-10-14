import type { CategoryKey, Language } from '../types'

/**
 * The category taxonomy.
 *
 * Fixed and small on purpose. A model asked to invent categories produces a
 * different taxonomy every week; rules written against it break silently.
 * Accounts customise where things go — folder paths, Outlook category names —
 * not what things are.
 */

export interface CategoryInfo {
  key: CategoryKey
  label: Record<Language, string>
  /** Where the starter rules file it. Rules can override per account. */
  defaultFolder: Record<Language, string> | null
  /** Outlook colour-category name applied by the starter rules. */
  outlookCategory: string
  description: string
}

export const CATEGORIES: Record<CategoryKey, CategoryInfo> = {
  'client-request': {
    key: 'client-request',
    label: { en: 'Client request', es: 'Solicitud de cliente' },
    defaultFolder: { en: 'Clients', es: 'Clientes' },
    outlookCategory: 'Client',
    description: 'An existing client asking for something to be done, changed or answered.',
  },
  'sales-lead': {
    key: 'sales-lead',
    label: { en: 'Sales lead', es: 'Oportunidad comercial' },
    defaultFolder: { en: 'Sales/Leads', es: 'Ventas/Oportunidades' },
    outlookCategory: 'Lead',
    description: 'A prospective customer enquiring about buying, pricing, a quote or a demo.',
  },
  support: {
    key: 'support',
    label: { en: 'Support', es: 'Soporte' },
    defaultFolder: { en: 'Support', es: 'Soporte' },
    outlookCategory: 'Support',
    description: 'A user reporting a problem or asking how to use something.',
  },
  billing: {
    key: 'billing',
    label: { en: 'Billing', es: 'Facturación' },
    defaultFolder: { en: 'Finance/Billing', es: 'Finanzas/Facturación' },
    outlookCategory: 'Finance',
    description: 'Invoices, payments, refunds, receipts, overdue notices.',
  },
  scheduling: {
    key: 'scheduling',
    label: { en: 'Scheduling', es: 'Agenda' },
    defaultFolder: { en: 'Meetings', es: 'Reuniones' },
    outlookCategory: 'Meeting',
    description: 'Arranging, moving or cancelling a meeting or call.',
  },
  legal: {
    key: 'legal',
    label: { en: 'Legal / contracts', es: 'Legal / contratos' },
    defaultFolder: { en: 'Legal', es: 'Legal' },
    outlookCategory: 'Legal',
    description: 'Contracts, NDAs, terms, disputes, compliance, data-protection requests.',
  },
  hr: {
    key: 'hr',
    label: { en: 'People / HR', es: 'Personas / RR. HH.' },
    defaultFolder: { en: 'People', es: 'Personas' },
    outlookCategory: 'HR',
    description: 'Hiring, applications, leave, payroll, staff matters.',
  },
  vendor: {
    key: 'vendor',
    label: { en: 'Vendor', es: 'Proveedor' },
    defaultFolder: { en: 'Vendors', es: 'Proveedores' },
    outlookCategory: 'Vendor',
    description: 'A supplier writing about something we buy from them.',
  },
  internal: {
    key: 'internal',
    label: { en: 'Internal', es: 'Interno' },
    defaultFolder: null,
    outlookCategory: 'Internal',
    description: 'A colleague inside the organisation.',
  },
  newsletter: {
    key: 'newsletter',
    label: { en: 'Newsletter', es: 'Boletín' },
    defaultFolder: { en: 'Reading', es: 'Lectura' },
    outlookCategory: 'Reading',
    description: 'Bulk editorial or marketing mail the recipient subscribed to.',
  },
  notification: {
    key: 'notification',
    label: { en: 'Notification', es: 'Notificación' },
    defaultFolder: { en: 'Notifications', es: 'Notificaciones' },
    outlookCategory: 'Automated',
    description: 'Machine-generated: alerts, receipts, shipping updates, system messages.',
  },
  personal: {
    key: 'personal',
    label: { en: 'Personal', es: 'Personal' },
    defaultFolder: null,
    outlookCategory: 'Personal',
    description: 'Not work.',
  },
  spam: {
    key: 'spam',
    label: { en: 'Spam / phishing', es: 'Spam / phishing' },
    defaultFolder: { en: 'Review/Suspicious', es: 'Revisar/Sospechoso' },
    outlookCategory: 'Suspicious',
    description: 'Unsolicited, deceptive, or credential-phishing mail.',
  },
}

/**
 * Categories where an automatic reply is never appropriate, whatever a rule
 * says. Saying the wrong thing about a contract or an invoice costs more than
 * the minutes saved, and replying to spam confirms the address is live.
 */
export const NEVER_AUTO_REPLY: ReadonlySet<CategoryKey> = new Set([
  'legal',
  'billing',
  'hr',
  'spam',
  'newsletter',
  'notification',
  'personal',
])

export function categoryLabel(key: CategoryKey, lang: Language = 'en'): string {
  return CATEGORIES[key]?.label[lang] ?? key
}
