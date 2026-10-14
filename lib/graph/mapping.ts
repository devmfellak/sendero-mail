import type { Address, MailMessage } from '../types'

/**
 * Graph message resource → MailMessage.
 *
 * Bodies are requested as text (`Prefer: outlook.body-content-type="text"`) so
 * Exchange does the HTML-to-text conversion; it handles Outlook's own markup
 * better than any sanitiser we could ship. Only the headers the agent acts on
 * are kept — loop-prevention and bulk-mail markers.
 */

export interface GraphRecipient {
  emailAddress?: { name?: string; address?: string }
}

export interface GraphMessage {
  id: string
  conversationId?: string
  internetMessageId?: string
  parentFolderId?: string
  subject?: string | null
  body?: { contentType?: string; content?: string }
  bodyPreview?: string
  from?: GraphRecipient
  sender?: GraphRecipient
  toRecipients?: GraphRecipient[]
  ccRecipients?: GraphRecipient[]
  receivedDateTime?: string
  sentDateTime?: string
  isRead?: boolean
  isDraft?: boolean
  importance?: 'low' | 'normal' | 'high'
  categories?: string[]
  hasAttachments?: boolean
  flag?: { flagStatus?: 'notFlagged' | 'flagged' | 'complete' }
  internetMessageHeaders?: Array<{ name: string; value: string }>
  '@removed'?: { reason: string }
}

const KEPT_HEADERS = new Set([
  'auto-submitted',
  'x-auto-response-suppress',
  'precedence',
  'list-unsubscribe',
  'list-id',
  'in-reply-to',
  'references',
])

export const MESSAGE_SELECT = [
  'id',
  'conversationId',
  'internetMessageId',
  'parentFolderId',
  'subject',
  'body',
  'from',
  'sender',
  'toRecipients',
  'ccRecipients',
  'receivedDateTime',
  'sentDateTime',
  'isRead',
  'isDraft',
  'importance',
  'categories',
  'hasAttachments',
  'flag',
  'internetMessageHeaders',
].join(',')

export function mapMessage(
  g: GraphMessage,
  ctx: { accountId: string; mailboxAddress: string; localFolderId: string },
): MailMessage {
  const from = addr(g.from ?? g.sender)
  const headers: Record<string, string> = {}
  for (const h of g.internetMessageHeaders ?? []) {
    const name = h.name.toLowerCase()
    if (KEPT_HEADERS.has(name)) headers[name] = h.value
  }

  return {
    id: `${ctx.accountId}:${g.id}`,
    accountId: ctx.accountId,
    providerId: g.id,
    conversationId: g.conversationId ?? g.id,
    internetMessageId: g.internetMessageId ?? '',
    folderId: ctx.localFolderId,
    direction: from.address.toLowerCase() === ctx.mailboxAddress.toLowerCase() ? 'outbound' : 'inbound',
    from,
    to: (g.toRecipients ?? []).map(addr),
    cc: (g.ccRecipients ?? []).map(addr),
    subject: g.subject ?? '(no subject)',
    bodyText: g.body?.content ?? g.bodyPreview ?? '',
    receivedAt: g.receivedDateTime ?? g.sentDateTime ?? new Date().toISOString(),
    isRead: g.isRead ?? false,
    flagged: g.flag?.flagStatus === 'flagged',
    importance: g.importance ?? 'normal',
    categories: g.categories ?? [],
    hasAttachments: g.hasAttachments ?? false,
    headers,
  }
}

function addr(r: GraphRecipient | undefined): Address {
  return { name: r?.emailAddress?.name ?? '', address: r?.emailAddress?.address ?? '' }
}
