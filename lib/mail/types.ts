import type { Folder, MailMessage } from '../types'

/**
 * A mailbox, as far as the agent is concerned.
 *
 * Two implementations: Microsoft Graph for real Outlook / Exchange Online
 * mailboxes, and a simulated mailbox for the demo and for tests. The simulated
 * one is not a stub — it keeps folders, moves messages, holds drafts and sends
 * replies into a Sent Items folder — so the pipeline exercised in development is
 * the pipeline that runs against a tenant.
 *
 * Every method is idempotent from the agent's point of view or documented as
 * not: Graph retries (429, 503, network) re-issue calls, and a duplicate
 * webhook delivery re-runs the pipeline.
 */
export interface MailProvider {
  readonly kind: 'demo' | 'graph'

  /** All folders, as the mailbox currently has them. */
  listFolders(): Promise<Folder[]>

  /** Create one folder under `parent` (null = mailbox root). */
  createFolder(parent: Folder | null, displayName: string): Promise<Folder>

  /**
   * Move a message. Returns the message's id afterwards: Graph issues a new id
   * on move unless immutable ids are requested — which this client always does,
   * but the contract does not rely on it.
   */
  move(message: MailMessage, folder: Folder): Promise<{ providerId: string }>

  setCategories(message: MailMessage, categories: string[]): Promise<void>
  flag(message: MailMessage, dueAt?: string): Promise<void>
  markRead(message: MailMessage): Promise<void>

  /**
   * A reply draft in the mailbox's Drafts folder, threaded to the message, with
   * the original quoted beneath as Outlook would. Editing a draft is a delete
   * and a re-create: patching the body through Graph would drop the quote.
   */
  createReplyDraft(message: MailMessage, body: string): Promise<{ providerDraftId: string }>
  sendDraft(providerDraftId: string): Promise<void>
  deleteDraft(providerDraftId: string): Promise<void>

  /** Every message in a conversation that the mailbox can see, any folder. */
  getConversation(conversationId: string): Promise<MailMessage[]>
}
