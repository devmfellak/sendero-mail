import Link from 'next/link'
import { MailRow } from '@/components/mail-row'
import { ActivityFeed } from '@/components/activity-feed'
import { Card, Empty, ModeBadge, PageHead, Stat, AccountStatus, Alert } from '@/components/ui'
import { CATEGORIES } from '@/lib/domain/categories'
import { accountSummary, categoryBreakdown, counts, inbox } from '@/lib/queries'
import { store } from '@/lib/runtime'

export const metadata = { title: 'Overview' }

export default function OverviewPage() {
  const db = store().read
  const c = counts()
  // One row per conversation: a client chasing their own email is one thing to
  // deal with, not two. The list is already in priority order, so the first
  // row seen for a conversation is the one to keep.
  const seen = new Set<string>()
  const needsYou = inbox({ view: 'needs-reply' }, 80)
    .filter((r) => r.analysis && (r.analysis.band === 'urgent' || r.analysis.band === 'high'))
    .filter((r) => !seen.has(r.message.conversationId) && Boolean(seen.add(r.message.conversationId)))
    .slice(0, 7)
  const breakdown = categoryBreakdown()
  const max = Math.max(1, ...breakdown.map((b) => b.count))

  return (
    <>
      <PageHead
        title="Overview"
        lede={`${db.accounts.length} mailboxes, one queue. What the agent did in the last 24 hours, and what is waiting for a person.`}
      />

      {c.unprocessed > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Alert kind="info">
            Working through {c.unprocessed} message{c.unprocessed === 1 ? '' : 's'}… this page updates as each one lands.
          </Alert>
        </div>
      )}

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <Stat label="Analysed today" value={c.analysedToday} note={`${c.filedToday} filed into folders`} />
        <Stat label="Waiting for approval" value={c.pendingDrafts} tone={c.pendingDrafts ? 'amber' : undefined} note={<Link className="link" href="/approvals">Review drafts →</Link>} />
        <Stat label="Replies sent" value={c.autoSentToday + c.approvedToday} note={`${c.autoSentToday} automatic · ${c.approvedToday} approved · ${c.heldToday} held`} />
        <Stat label="Follow-ups open" value={c.openFollowUps} tone={c.overdueFollowUps ? 'red' : undefined} note={c.overdueFollowUps ? `${c.overdueFollowUps} overdue` : 'none overdue'} />
      </div>

      <div className="split-wide">
        <div className="stack">
          <Card title="Needs you now" action={<Link className="card-link" href="/inbox?view=needs-reply">All awaiting reply →</Link>} tight>
            {needsYou.length ? (
              <ul className="mail-list">
                {needsYou.map((row) => (
                  <MailRow key={row.message.id} row={row} />
                ))}
              </ul>
            ) : (
              <Empty>Nothing urgent is waiting on a reply.</Empty>
            )}
          </Card>

          <Card title="Mailboxes" tight>
            <table className="table">
              <thead>
                <tr>
                  <th>Mailbox</th>
                  <th>Mode</th>
                  <th className="nowrap">Urgent</th>
                  <th className="nowrap">Drafts</th>
                  <th className="nowrap">Follow-ups</th>
                  <th>EN / ES</th>
                </tr>
              </thead>
              <tbody>
                {db.accounts.map((a) => {
                  const s = accountSummary(a)
                  return (
                    <tr key={a.id}>
                      <td>
                        <Link href={`/accounts/${a.id}`} className="row" style={{ gap: 8, textDecoration: 'none', flexWrap: 'nowrap' }}>
                          <span className="swatch" style={{ background: a.color }} aria-hidden />
                          <span>
                            <span className="strong">{a.displayName}</span>
                            <div className="tiny muted">{a.address}</div>
                          </span>
                        </Link>
                      </td>
                      <td>
                        <div className="stack-sm" style={{ gap: 4 }}>
                          <ModeBadge mode={a.settings.mode} />
                          {a.status !== 'connected' && <AccountStatus account={a} />}
                        </div>
                      </td>
                      <td className="tnum">{s.urgent}</td>
                      <td className="tnum">{s.pending}</td>
                      <td className="tnum">{s.followUps}</td>
                      <td className="tnum muted">
                        {s.languages.en} / {s.languages.es}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        </div>

        <div className="stack">
          <Card title="Mail by category">
            {breakdown.length ? (
              <div className="bars">
                {breakdown.map((b) => (
                  <Link key={b.category} href={`/inbox?category=${b.category}&view=all`} className="bar" style={{ textDecoration: 'none' }}>
                    <span className="ellipsis">{CATEGORIES[b.category].label.en}</span>
                    <span className="track">
                      <span className="fill" style={{ width: `${(b.count / max) * 100}%`, display: 'block' }} />
                    </span>
                    <span className="tnum muted" style={{ textAlign: 'right' }}>
                      {b.count}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <Empty>No mail analysed yet.</Empty>
            )}
          </Card>

          <Card title="Agent activity" action={<Link className="card-link" href="/activity">Full log →</Link>} tight>
            <ActivityFeed events={db.activity.slice(-12).reverse()} accounts={db.accounts} />
          </Card>
        </div>
      </div>
    </>
  )
}
