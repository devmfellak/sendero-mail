import { emptyData, id, stableId, type Data } from '../store/store'
import type { Account, AccountSettings, Folder, MailMessage, Rule } from '../types'
import { DEMO_ACCOUNTS, SEED_MAIL, type DemoAccountKey, type DemoMail } from './fixtures'

/**
 * The first-run state: three demo mailboxes, their folders, a starter rule
 * set, and a backlog of mail that the agent works through on boot — which is
 * the most honest demo available, because it is the real pipeline running.
 */

const INTERNAL = ['brisalogistics.mx']

function settings(over: Partial<AccountSettings>): AccountSettings {
  return {
    mode: 'assist',
    autoReplyMinConfidence: 0.85,
    maxAutoRepliesPerHour: 20,
    quietHours: null,
    timeZone: 'America/Mexico_City',
    internalDomains: INTERNAL,
    vipSenders: [],
    defaultLanguage: 'en',
    followUpDays: 2,
    signature: { en: '', es: '' },
    knowledge: '',
    tone: 'neutral',
    ...over,
  }
}

export const ACCOUNT_IDS: Record<DemoAccountKey, string> = {
  elena: 'acc_elena',
  support: 'acc_support',
  sales: 'acc_sales',
}

function accounts(now: string): Account[] {
  return [
    {
      id: ACCOUNT_IDS.elena,
      displayName: DEMO_ACCOUNTS.elena.name,
      address: DEMO_ACCOUNTS.elena.address,
      provider: 'demo',
      color: '#2f6f8f',
      status: 'connected',
      connectedAt: now,
      settings: settings({
        mode: 'assist',
        vipSenders: ['@gruponorte.com.mx', 'jorge.salinas@brisalogistics.mx'],
        defaultLanguage: 'es',
        tone: 'warm',
        signature: {
          en: 'Best regards,\nElena Ruiz\nManaging Director · Brisa Logistics',
          es: 'Un saludo,\nElena Ruiz\nDirectora General · Brisa Logistics',
        },
        knowledge:
          'Elena takes external meetings Tuesday to Thursday, 15:00–18:00 Mexico City time.\nRate or contract changes are confirmed in writing by Elena personally.',
      }),
    },
    {
      id: ACCOUNT_IDS.support,
      displayName: DEMO_ACCOUNTS.support.name,
      address: DEMO_ACCOUNTS.support.address,
      provider: 'demo',
      color: '#2f7d52',
      status: 'connected',
      connectedAt: now,
      settings: settings({
        mode: 'auto',
        // The offline engine caps its confidence at 0.78, so clear support
        // requests are acknowledged automatically even without a model key,
        // while vague or angry ones fall below the bar and wait for a person.
        autoReplyMinConfidence: 0.75,
        maxAutoRepliesPerHour: 30,
        quietHours: { start: 22, end: 7 },
        defaultLanguage: 'es',
        followUpDays: 1,
        signature: {
          en: 'Brisa Logistics Support\nhttps://track.brisalogistics.mx',
          es: 'Soporte Brisa Logistics\nhttps://track.brisalogistics.mx',
        },
        knowledge: [
          'Support hours: Monday to Friday, 08:00–18:00 Mexico City time.',
          'Every support request receives a reply from a person within one business day.',
          'Shipment tracking portal: https://track.brisalogistics.mx',
          'Portal login problems: use "Forgot password" on the portal; if that fails, support resets the account manually.',
          'Damaged goods claims must be filed within 7 days of delivery, with photos, by replying to this address.',
          'Urgent shipment issues by phone: +52 55 5000 1234.',
        ].join('\n'),
      }),
    },
    {
      id: ACCOUNT_IDS.sales,
      displayName: DEMO_ACCOUNTS.sales.name,
      address: DEMO_ACCOUNTS.sales.address,
      provider: 'demo',
      color: '#a56b12',
      status: 'connected',
      connectedAt: now,
      settings: settings({
        mode: 'assist',
        defaultLanguage: 'en',
        followUpDays: 3,
        signature: {
          en: 'Best regards,\nBrisa Logistics Sales\nsales@brisalogistics.mx',
          es: 'Saludos cordiales,\nVentas Brisa Logistics\nsales@brisalogistics.mx',
        },
        knowledge: [
          'Services: full truckload (FTL), less than truckload (LTL), refrigerated, cross-dock in Laredo, and customs brokerage on both sides of the border.',
          'Quotes are prepared by the sales team within two business days once lane, volume and start date are known.',
          'Book a demo of the tracking portal: https://brisalogistics.mx/demo',
        ].join('\n'),
      }),
    },
  ]
}

function folders(accountId: string): Folder[] {
  const make = (displayName: string, wellKnown: Folder['wellKnown']): Folder => ({
    id: `fld_${accountId}_${wellKnown}`,
    accountId,
    parentId: null,
    displayName,
    path: displayName,
    wellKnown,
  })
  return [
    make('Inbox', 'inbox'),
    make('Drafts', 'drafts'),
    make('Sent Items', 'sentitems'),
    make('Archive', 'archive'),
    make('Junk Email', 'junkemail'),
  ]
}

export function starterRules(now: string): Rule[] {
  const rule = (r: Omit<Rule, 'id' | 'updatedAt' | 'enabled'> & { enabled?: boolean }): Rule => ({
    id: stableId('rule', r.name),
    updatedAt: now,
    enabled: r.enabled ?? true,
    ...r,
  })
  const { elena, support, sales } = ACCOUNT_IDS

  return [
    rule({
      accountId: null,
      name: 'Quarantine suspicious mail',
      order: 10,
      when: [{ field: 'category', op: 'is', value: 'spam' }],
      then: [{ type: 'categorize', category: 'Suspicious' }, { type: 'move', folder: 'Review/Suspicious' }],
      stop: true,
    }),
    rule({
      accountId: null,
      name: 'File newsletters to Reading',
      order: 20,
      when: [{ field: 'category', op: 'is', value: 'newsletter' }],
      then: [{ type: 'move', folder: 'Reading' }, { type: 'markRead' }],
      stop: true,
    }),
    rule({
      accountId: null,
      name: 'File notifications by sender',
      order: 30,
      when: [{ field: 'category', op: 'is', value: 'notification' }],
      then: [{ type: 'move', folder: 'Notifications/{senderOrg}' }, { type: 'markRead' }],
      stop: true,
    }),
    rule({
      accountId: null,
      name: 'Colour-code by category',
      order: 40,
      when: [],
      then: [{ type: 'categorize', category: '{category}' }],
      stop: false,
    }),
    rule({
      accountId: null,
      name: 'Flag anything urgent',
      order: 50,
      when: [{ field: 'band', op: 'is', value: 'urgent' }],
      then: [{ type: 'flag' }],
      stop: false,
    }),

    rule({
      accountId: elena,
      name: 'Clients — file by organisation and draft a reply',
      order: 60,
      when: [{ field: 'category', op: 'is', value: 'client-request' }],
      then: [{ type: 'move', folder: 'Clientes/{senderOrg}' }, { type: 'draftReply' }],
      stop: false,
    }),
    rule({
      accountId: elena,
      name: 'Legal — hold for review',
      order: 60,
      when: [{ field: 'category', op: 'is', value: 'legal' }],
      then: [{ type: 'move', folder: 'Legal/Por revisar' }, { type: 'flag' }],
      stop: false,
    }),
    rule({
      accountId: elena,
      name: 'Meeting requests — propose times',
      order: 60,
      when: [
        { field: 'category', op: 'is', value: 'scheduling' },
        { field: 'needsReply', op: 'is', value: true },
      ],
      then: [{ type: 'draftReply', instructions: 'Offer Tuesday to Thursday afternoons, per the knowledge. Keep it to three sentences.' }],
      stop: false,
    }),
    rule({
      accountId: elena,
      name: 'Colleague requests — draft a reply',
      order: 60,
      when: [
        { field: 'category', op: 'is', value: 'internal' },
        { field: 'needsReply', op: 'is', value: true },
      ],
      then: [{ type: 'draftReply' }],
      stop: false,
    }),

    rule({
      accountId: support,
      name: 'Acknowledge support requests',
      order: 60,
      when: [
        { field: 'category', op: 'is', value: 'support' },
        { field: 'needsReply', op: 'is', value: true },
      ],
      then: [
        {
          type: 'autoReply',
          instructions:
            'Acknowledge the problem, point to the tracking portal or the password reset if relevant, and say a person will reply within one business day.',
        },
        { type: 'move', folder: 'Tickets/{year}-{month}' },
        { type: 'followUp', days: 1 },
      ],
      stop: false,
    }),
    rule({
      accountId: support,
      name: 'Billing — to Finance, draft for review',
      order: 60,
      when: [{ field: 'category', op: 'is', value: 'billing' }],
      then: [{ type: 'move', folder: 'Finance/Billing' }, { type: 'draftReply' }],
      stop: false,
    }),
    rule({
      accountId: support,
      name: 'Notify n8n of billing disputes',
      enabled: false,
      order: 70,
      when: [
        { field: 'category', op: 'is', value: 'billing' },
        { field: 'sentiment', op: 'is', value: 'negative' },
      ],
      then: [{ type: 'webhook', url: 'https://n8n.brisalogistics.mx/webhook/billing-dispute' }],
      stop: false,
    }),

    rule({
      accountId: sales,
      name: 'Leads — file by language, draft, follow up',
      order: 60,
      when: [{ field: 'category', op: 'is', value: 'sales-lead' }],
      then: [
        { type: 'move', folder: 'Leads/{language}' },
        {
          type: 'draftReply',
          instructions: 'Thank them, confirm which services from the knowledge fit, ask for lanes, weekly volume and start date, and offer the demo link.',
        },
        { type: 'followUp', days: 3 },
      ],
      stop: false,
    }),
  ]
}

export function demoMessage(mail: Omit<DemoMail, 'minutesAgo'>, receivedAt: Date, key: string, read = false): MailMessage {
  const accountId = ACCOUNT_IDS[mail.account]
  const own = DEMO_ACCOUNTS[mail.account]
  const direction = mail.direction ?? 'inbound'
  const msgId = stableId('msg', key)
  return {
    id: msgId,
    accountId,
    providerId: msgId,
    conversationId: mail.thread ? `conv_${mail.account}_${mail.thread}` : `conv_${msgId}`,
    internetMessageId: `<${msgId}@${mail.from.address.split('@')[1]}>`,
    folderId: `fld_${accountId}_${direction === 'outbound' ? 'sentitems' : 'inbox'}`,
    direction,
    from: mail.from,
    to: direction === 'outbound' && mail.to ? [mail.to] : mail.cc ? [] : [{ name: own.name, address: own.address }],
    cc: mail.cc ? [{ name: own.name, address: own.address }] : [],
    subject: mail.subject,
    bodyText: mail.body,
    receivedAt: receivedAt.toISOString(),
    isRead: read || direction === 'outbound',
    flagged: false,
    importance: mail.importance ?? 'normal',
    categories: [],
    hasAttachments: mail.hasAttachments ?? false,
    headers: mail.headers ?? {},
  }
}

export function seedData(): Data {
  const nowMs = Date.now()
  const now = new Date(nowMs).toISOString()
  const data = emptyData()
  data.accounts = accounts(new Date(nowMs - 41 * 86_400_000).toISOString())
  data.folders = data.accounts.flatMap((a) => folders(a.id))
  data.rules = starterRules(now)
  // Mail older than a few hours has been opened by somebody already.
  data.messages = SEED_MAIL.map((m, i) => demoMessage(m, new Date(nowMs - m.minutesAgo * 60_000), `seed:${i}`, m.minutesAgo > 240))
  const oldest = Math.max(...SEED_MAIL.map((m) => m.minutesAgo))
  data.activity.push({
    id: id('evt'),
    at: new Date(nowMs - (oldest + 90) * 60_000).toISOString(),
    accountId: null,
    kind: 'sync',
    actor: 'system',
    detail: `Initial sync complete: ${data.accounts.length} mailboxes, change notifications active`,
  })
  return data
}
