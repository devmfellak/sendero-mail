import Link from 'next/link'
import { DraftEditor } from '@/components/draft-editor'
import { BandBadge, Card, CategoryBadge, Empty, heldReason, PageHead, When } from '@/components/ui'
import { stripQuoted } from '@/lib/domain/quoting'
import { pendingDrafts } from '@/lib/queries'
import { store } from '@/lib/runtime'

export const metadata = { title: 'Approvals' }

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const { account } = await searchParams
  const items = pendingDrafts(account)
  const rules = new Map(store().read.rules.map((r) => [r.id, r.name]))

  return (
    <>
      <PageHead
        title="Approvals"
        lede="Replies the agent wrote but did not send. Edit if needed, then send or discard. Each draft is also in the mailbox’s Outlook Drafts folder, so it can be finished from Outlook too."
        action={items.length > 0 ? <span className="small muted tnum">{items.length} waiting</span> : undefined}
      />

      {items.length === 0 ? (
        <Card>
          <Empty>All caught up. New drafts appear here the moment they are written.</Empty>
        </Card>
      ) : (
        <div className="stack">
          {items.map(({ draft, message, analysis, account: acc }) => {
            const reason = heldReason(draft.reason)
            return (
              <article key={draft.id} className="card approval">
                <header className="approval-head">
                  <span className="stripe" style={{ background: acc.color }} aria-hidden />
                  <div className="approval-title">
                    <h2>
                      <Link href={`/inbox/${encodeURIComponent(message.id)}`}>{message.subject}</Link>
                    </h2>
                    <div className="small muted">
                      <span className="strong" style={{ color: 'var(--text)' }}>
                        {message.from.name || message.from.address}
                      </span>{' '}
                      to {acc.displayName} · <When value={message.receivedAt} />
                      {draft.ruleId && <> · rule “{rules.get(draft.ruleId) ?? 'deleted'}”</>}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    {analysis && <CategoryBadge category={analysis.category} />}
                    {analysis && <BandBadge band={analysis.band} />}
                  </div>
                </header>

                {reason && (
                  <div className="approval-reason">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden focusable="false">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 8v5M12 16h.01" />
                    </svg>
                    <span>
                      <span className="strong">Held for review:</span> {reason}
                    </span>
                  </div>
                )}

                <div className="approval-body">
                  <section className="pane original" aria-label="Original message">
                    <div className="pane-label">Original · {draft.language === 'es' ? 'Spanish' : 'English'}</div>
                    <div className="message-body">{stripQuoted(message.bodyText)}</div>
                  </section>
                  <section className="pane" aria-label="Proposed reply">
                    <div className="pane-label">Proposed reply</div>
                    <DraftEditor key={draft.id} draftId={draft.id} messageId={message.id} body={draft.body} language={draft.language} compact />
                  </section>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </>
  )
}
