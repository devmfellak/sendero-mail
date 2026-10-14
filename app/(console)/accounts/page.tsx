import Link from 'next/link'
import { AccountStatus, Alert, Badge, Card, ModeBadge, PageHead, When } from '@/components/ui'
import { graphConfigured } from '@/lib/env'
import { accountSummary } from '@/lib/queries'
import { store } from '@/lib/runtime'

export const metadata = { title: 'Mailboxes' }

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const sp = await searchParams
  const db = store().read
  const canConnect = graphConfigured()

  return (
    <>
      <PageHead
        title="Mailboxes"
        lede="Each mailbox has its own mode, guardrails, signatures, knowledge and rules. New mailboxes start in Observe mode."
        action={
          canConnect ? (
            <a className="btn primary" href="/api/auth/microsoft/start">
              Connect an Outlook mailbox
            </a>
          ) : (
            <button className="btn primary" type="button" disabled title="An administrator enables this under Integrations → Microsoft 365">
              Connect an Outlook mailbox
            </button>
          )
        }
      />

      {sp.connected && (
        <div style={{ marginBottom: 16 }}>
          <Alert kind="success" title="Connected.">
            {sp.connected} is syncing. It is in Observe mode: the agent will classify mail but change nothing until you switch the mode.
          </Alert>
        </div>
      )}
      {sp.error && (
        <div style={{ marginBottom: 16 }}>
          <Alert kind="error" title="Could not connect.">
            {sp.error}
          </Alert>
        </div>
      )}

      <div className="grid grid-3">
        {db.accounts.map((a) => {
          const s = accountSummary(a)
          return (
            <section key={a.id} className="card" style={{ borderTop: `3px solid ${a.color}` }}>
              <div className="card-body stack-sm">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h2>
                    <Link href={`/accounts/${a.id}`}>{a.displayName}</Link>
                  </h2>
                  <ModeBadge mode={a.settings.mode} />
                </div>
                <div className="small muted">{a.address}</div>
                <div className="row">
                  <AccountStatus account={a} />
                  <Badge>Outlook</Badge>
                  <Badge>{a.settings.defaultLanguage === 'es' ? 'Spanish default' : 'English default'}</Badge>
                </div>
                <dl className="kv small" style={{ marginTop: 6 }}>
                  <dt>Messages</dt>
                  <dd className="tnum">
                    {s.messages} <span className="muted">· {s.unread} unread</span>
                  </dd>
                  <dt>Awaiting you</dt>
                  <dd className="tnum">
                    {s.pending} drafts · {s.followUps} follow-ups
                  </dd>
                  <dt>Folders made</dt>
                  <dd className="tnum">{s.folders}</dd>
                  {a.provider === 'graph' && (
                    <>
                      <dt>Last sync</dt>
                      <dd>
                        <When value={a.lastSyncAt} />
                      </dd>
                      <dt>Push</dt>
                      <dd>{a.subscription ? <>until <When value={a.subscription.expiresAt} mode="full" /></> : <span className="muted">delta sync only</span>}</dd>
                    </>
                  )}
                </dl>
                <div className="row" style={{ marginTop: 6 }}>
                  <Link className="btn small" href={`/accounts/${a.id}`}>
                    Settings
                  </Link>
                  <Link className="btn small ghost" href={`/inbox?account=${a.id}`}>
                    Inbox
                  </Link>
                  {a.status === 'needs-consent' && (
                    <a className="btn small primary" href={`/api/auth/microsoft/start?login_hint=${encodeURIComponent(a.address)}`}>
                      Reconnect
                    </a>
                  )}
                </div>
              </div>
            </section>
          )
        })}
      </div>
    </>
  )
}
