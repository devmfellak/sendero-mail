import { id, stableId, type Store } from '../store/store'
import type { Folder, MailMessage } from '../types'
import type { MailProvider } from './types'

/**
 * A simulated Outlook mailbox backed by the store.
 *
 * Behaves like Exchange where it matters to the agent: folder names are unique
 * per parent (case-insensitive), a sent reply lands in Sent Items threaded to
 * the conversation, a draft lives until it is sent or deleted, and a reply
 * draft carries "Re:" on the subject exactly once.
 */
export class DemoMailbox implements MailProvider {
  readonly kind = 'demo' as const
  private drafts = new Map<string, { messageId: string; body: string }>()

  constructor(
    private readonly store: Store,
    private readonly accountId: string,
  ) {}

  async listFolders(): Promise<Folder[]> {
    return this.store.read.folders.filter((f) => f.accountId === this.accountId)
  }

  async createFolder(parent: Folder | null, displayName: string): Promise<Folder> {
    const existing = this.store.read.folders.find(
      (f) =>
        f.accountId === this.accountId &&
        f.parentId === (parent?.id ?? null) &&
        f.displayName.toLowerCase() === displayName.toLowerCase(),
    )
    if (existing) return existing

    return {
      id: stableId('fld', `${this.accountId}:${parent ? `${parent.path}/${displayName}` : displayName}`),
      accountId: this.accountId,
      parentId: parent?.id ?? null,
      displayName,
      path: parent ? `${parent.path}/${displayName}` : displayName,
      createdByAgent: true,
    }
  }

  async move(message: MailMessage, folder: Folder): Promise<{ providerId: string }> {
    await this.patch(message.id, (m) => {
      m.folderId = folder.id
    })
    return { providerId: message.providerId }
  }

  async setCategories(message: MailMessage, categories: string[]): Promise<void> {
    await this.patch(message.id, (m) => {
      m.categories = [...new Set([...m.categories, ...categories])]
    })
  }

  async flag(message: MailMessage): Promise<void> {
    await this.patch(message.id, (m) => {
      m.flagged = true
    })
  }

  async markRead(message: MailMessage): Promise<void> {
    await this.patch(message.id, (m) => {
      m.isRead = true
    })
  }

  async createReplyDraft(message: MailMessage, body: string): Promise<{ providerDraftId: string }> {
    const providerDraftId = id('draft')
    this.drafts.set(providerDraftId, { messageId: message.id, body })
    return { providerDraftId }
  }

  async deleteDraft(providerDraftId: string): Promise<void> {
    this.drafts.delete(providerDraftId)
  }

  async sendDraft(providerDraftId: string): Promise<void> {
    // The in-memory map does not survive a restart; the store's Draft record
    // does, so fall back to it rather than losing an approved reply.
    const record = this.store.read.drafts.find((d) => d.providerDraftId === providerDraftId)
    const pending = this.drafts.get(providerDraftId)
    const messageId = pending?.messageId ?? record?.messageId
    const body = record?.body ?? pending?.body
    if (!messageId || body === undefined) throw new Error('Draft not found in mailbox')

    await this.store.mutate((d) => {
      const original = d.messages.find((m) => m.id === messageId)
      const account = d.accounts.find((a) => a.id === this.accountId)
      const sent = d.folders.find((f) => f.accountId === this.accountId && f.wellKnown === 'sentitems')
      if (!original || !account || !sent) throw new Error('Cannot send: mailbox incomplete')

      const providerId = stableId('msg', `sent:${providerDraftId}:${messageId}`)
      d.messages.push({
        id: providerId,
        accountId: this.accountId,
        providerId,
        conversationId: original.conversationId,
        internetMessageId: `<${providerId}@${account.address.split('@')[1]}>`,
        folderId: sent.id,
        direction: 'outbound',
        from: { name: account.displayName, address: account.address },
        to: [original.from],
        cc: [],
        subject: replySubject(original.subject),
        bodyText: body,
        receivedAt: new Date().toISOString(),
        isRead: true,
        flagged: false,
        importance: 'normal',
        categories: [],
        hasAttachments: false,
        headers: {},
      })
    })
    this.drafts.delete(providerDraftId)
  }

  async getConversation(conversationId: string): Promise<MailMessage[]> {
    return this.store.read.messages.filter(
      (m) => m.accountId === this.accountId && m.conversationId === conversationId,
    )
  }

  private patch(messageId: string, fn: (m: MailMessage) => void): Promise<void> {
    return this.store.mutate((d) => {
      const m = d.messages.find((x) => x.id === messageId)
      if (m) fn(m)
    })
  }
}

export function replySubject(subject: string): string {
  return /^(re|rv|aw|sv):/i.test(subject.trim()) ? subject : `Re: ${subject}`
}
