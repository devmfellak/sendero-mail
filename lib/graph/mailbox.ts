import type { MailProvider } from '../mail/types'
import type { Account, Folder, MailMessage } from '../types'
import { GraphClient, GraphError } from './client'
import { MESSAGE_SELECT, mapMessage, type GraphMessage } from './mapping'

/**
 * An Outlook / Exchange Online mailbox through Microsoft Graph.
 *
 * Paths are `/me/…` because tokens are delegated: "me" is the mailbox whose
 * owner consented. Everything the agent does here is visible to that owner in
 * Outlook desktop, Outlook on the web and mobile, because it *is* their
 * mailbox — folders appear in the folder pane, drafts in Drafts, categories
 * in their colours.
 */

interface GraphFolder {
  id: string
  displayName: string
  parentFolderId: string
  childFolderCount: number
}

const WELL_KNOWN = ['inbox', 'drafts', 'sentitems', 'archive', 'junkemail'] as const

/** Outlook preset colours for the categories the agent applies. */
const CATEGORY_COLOURS: Record<string, string> = {
  Client: 'preset7',
  Lead: 'preset4',
  Support: 'preset1',
  Finance: 'preset3',
  Meeting: 'preset8',
  Legal: 'preset0',
  HR: 'preset5',
  Vendor: 'preset9',
  Internal: 'preset12',
  Reading: 'preset14',
  Automated: 'preset13',
  Personal: 'preset6',
  Suspicious: 'preset15',
}

export class GraphMailbox implements MailProvider {
  readonly kind = 'graph' as const
  private masterCategories: Set<string> | null = null

  constructor(
    private readonly client: GraphClient,
    private readonly account: Pick<Account, 'id' | 'address'>,
  ) {}

  async listFolders(): Promise<Folder[]> {
    const wellKnown = new Map<string, Folder['wellKnown']>()
    await Promise.all(
      WELL_KNOWN.map(async (name) => {
        try {
          const f = await this.client.get<{ id: string }>(`/me/mailFolders/${name}?$select=id`)
          wellKnown.set(f.id, name)
        } catch {
          // Not every mailbox has an Archive folder.
        }
      }),
    )

    const out: Folder[] = []
    const walk = async (url: string, parent: Folder | null): Promise<void> => {
      const children = await this.client.list<GraphFolder>(url)
      for (const g of children) {
        const folder: Folder = {
          id: g.id,
          accountId: this.account.id,
          parentId: parent?.id ?? null,
          displayName: g.displayName,
          path: parent ? `${parent.path}/${g.displayName}` : g.displayName,
          wellKnown: wellKnown.get(g.id),
        }
        out.push(folder)
        if (g.childFolderCount > 0) {
          await walk(`/me/mailFolders/${g.id}/childFolders?$top=100&$select=id,displayName,parentFolderId,childFolderCount`, folder)
        }
      }
    }
    await walk('/me/mailFolders?$top=100&$select=id,displayName,parentFolderId,childFolderCount', null)
    return out
  }

  async createFolder(parent: Folder | null, displayName: string): Promise<Folder> {
    const url = parent ? `/me/mailFolders/${parent.id}/childFolders` : '/me/mailFolders'
    let created: GraphFolder
    try {
      created = await this.client.post<GraphFolder>(url, { displayName, isHidden: false })
    } catch (err) {
      // Someone made it in Outlook between our listing and now. Use theirs.
      if (err instanceof GraphError && err.status === 409) {
        const siblings = await this.client.list<GraphFolder>(`${url}?$top=100&$select=id,displayName,parentFolderId,childFolderCount`)
        const match = siblings.find((f) => f.displayName.toLowerCase() === displayName.toLowerCase())
        if (!match) throw err
        created = match
      } else {
        throw err
      }
    }
    return {
      id: created.id,
      accountId: this.account.id,
      parentId: parent?.id ?? null,
      displayName: created.displayName,
      path: parent ? `${parent.path}/${created.displayName}` : created.displayName,
      createdByAgent: true,
    }
  }

  async move(message: MailMessage, folder: Folder): Promise<{ providerId: string }> {
    const moved = await this.client.post<GraphMessage>(`/me/messages/${enc(message.providerId)}/move`, {
      destinationId: folder.id,
    })
    return { providerId: moved.id }
  }

  async setCategories(message: MailMessage, categories: string[]): Promise<void> {
    await this.ensureMasterCategories(categories)
    await this.client.patch(`/me/messages/${enc(message.providerId)}`, {
      categories: [...new Set([...message.categories, ...categories])],
    })
  }

  async flag(message: MailMessage, dueAt?: string): Promise<void> {
    const flag: Record<string, unknown> = { flagStatus: 'flagged' }
    if (dueAt) {
      flag.startDateTime = { dateTime: new Date().toISOString(), timeZone: 'UTC' }
      flag.dueDateTime = { dateTime: dueAt, timeZone: 'UTC' }
    }
    await this.client.patch(`/me/messages/${enc(message.providerId)}`, { flag })
  }

  async markRead(message: MailMessage): Promise<void> {
    await this.client.patch(`/me/messages/${enc(message.providerId)}`, { isRead: true })
  }

  async createReplyDraft(message: MailMessage, body: string): Promise<{ providerDraftId: string }> {
    // `comment` is placed above Outlook's own quoted copy of the original, so
    // the draft looks exactly like one the user started with "Reply".
    const draft = await this.client.post<GraphMessage>(`/me/messages/${enc(message.providerId)}/createReply`, {
      comment: textToHtml(body),
    })
    return { providerDraftId: draft.id }
  }

  async sendDraft(providerDraftId: string): Promise<void> {
    await this.client.post(`/me/messages/${enc(providerDraftId)}/send`)
  }

  async deleteDraft(providerDraftId: string): Promise<void> {
    try {
      await this.client.delete(`/me/messages/${enc(providerDraftId)}`)
    } catch (err) {
      // Already gone — deleted in Outlook, or sent from there. Same outcome.
      if (!(err instanceof GraphError && err.status === 404)) throw err
    }
  }

  async getConversation(conversationId: string): Promise<MailMessage[]> {
    // No $orderby: combined with a conversationId filter Exchange rejects it
    // as an inefficient query. Sorting 50 messages here costs nothing.
    const filter = encodeURIComponent(`conversationId eq '${conversationId.replace(/'/g, "''")}'`)
    const items = await this.client.list<GraphMessage>(`/me/messages?$filter=${filter}&$select=${MESSAGE_SELECT}&$top=50`, 50)
    return items
      .filter((g) => !g.isDraft)
      .map((g) => this.map(g))
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
  }

  /* ----------------------------------------- Graph-only, used by sync.ts -- */

  async getMessage(providerId: string): Promise<MailMessage> {
    const g = await this.client.get<GraphMessage>(`/me/messages/${enc(providerId)}?$select=${MESSAGE_SELECT}`)
    return this.map(g)
  }

  /**
   * Folder delta. First call (no link) starts from `since`; later calls resume
   * from the stored delta link and return only what changed. Returns the next
   * link to store. Sent Items is synced as well as the Inbox so that a reply
   * sent from a phone closes a follow-up just as one sent from here does.
   */
  async folderDelta(
    folder: 'inbox' | 'sentitems',
    deltaLink: string | undefined,
    since: Date,
  ): Promise<{ messages: MailMessage[]; deltaLink: string }> {
    let url =
      deltaLink ??
      `/me/mailFolders/${folder}/messages/delta?$select=${MESSAGE_SELECT}&$filter=${encodeURIComponent(`receivedDateTime ge ${since.toISOString()}`)}`
    const messages: MailMessage[] = []

    for (let pages = 0; pages < 50; pages++) {
      const page: { value: GraphMessage[]; '@odata.nextLink'?: string; '@odata.deltaLink'?: string } =
        await this.client.get(url)
      for (const g of page.value) if (!g['@removed'] && !g.isDraft) messages.push(this.map(g))
      if (page['@odata.deltaLink']) return { messages, deltaLink: page['@odata.deltaLink'] }
      if (!page['@odata.nextLink']) break
      url = page['@odata.nextLink']
    }
    throw new Error('Delta query did not complete; will resume from the previous link')
  }

  async subscribe(notificationUrl: string, lifecycleUrl: string, clientState: string, expiresAt: Date) {
    return this.client.post<{ id: string; expirationDateTime: string }>('/subscriptions', {
      changeType: 'created',
      notificationUrl,
      lifecycleNotificationUrl: lifecycleUrl,
      resource: "me/mailFolders('inbox')/messages",
      expirationDateTime: expiresAt.toISOString(),
      clientState,
    })
  }

  async renewSubscription(subscriptionId: string, expiresAt: Date) {
    return this.client.patch<{ id: string; expirationDateTime: string }>(`/subscriptions/${enc(subscriptionId)}`, {
      expirationDateTime: expiresAt.toISOString(),
    })
  }

  async me(): Promise<{ displayName: string; mail: string | null; userPrincipalName: string }> {
    return this.client.get('/me?$select=displayName,mail,userPrincipalName')
  }

  private map(g: GraphMessage): MailMessage {
    return mapMessage(g, { accountId: this.account.id, mailboxAddress: this.account.address, localFolderId: g.parentFolderId ?? '' })
  }

  private async ensureMasterCategories(names: string[]): Promise<void> {
    if (!this.masterCategories) {
      const list = await this.client.list<{ displayName: string }>('/me/outlook/masterCategories')
      this.masterCategories = new Set(list.map((c) => c.displayName.toLowerCase()))
    }
    for (const name of names) {
      if (this.masterCategories.has(name.toLowerCase())) continue
      try {
        await this.client.post('/me/outlook/masterCategories', { displayName: name, color: CATEGORY_COLOURS[name] ?? 'preset10' })
      } catch (err) {
        if (!(err instanceof GraphError && err.status === 409)) throw err
      }
      this.masterCategories.add(name.toLowerCase())
    }
  }
}

function enc(id: string): string {
  return encodeURIComponent(id)
}

export function textToHtml(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escaped
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('')
}
