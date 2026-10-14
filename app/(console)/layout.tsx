import { LiveStatus } from '@/components/live'
import { Shell } from '@/components/shell'
import { Mark } from '@/components/ui'
import { startWorker } from '@/lib/agent/worker'
import { WORKSPACE_NAME } from '@/lib/demo/fixtures'
import { deliverDue } from '@/lib/demo/simulator'
import { counts } from '@/lib/queries'
import { store } from '@/lib/runtime'

export const dynamic = 'force-dynamic'

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  // instrumentation.ts starts the worker; this is a no-op unless a host
  // skipped instrumentation (some serverless adapters do).
  await startWorker()
  // Serverless hosts freeze the process between requests, so timers cannot be
  // relied on to deliver sample mail; a page view does it instead.
  await deliverDue().catch(() => undefined)

  const c = counts()
  const db = store().read
  const sample = db.accounts.some((a) => a.provider === 'demo')
  const connected = db.accounts.filter((a) => a.status === 'connected').length

  const accounts = db.accounts.map((a) => ({
    id: a.id,
    name: a.displayName,
    color: a.color,
    pending: db.drafts.filter((d) => d.accountId === a.id && d.status === 'pending').length,
  }))

  return (
    <Shell
      mark={<Mark />}
      workspace={sample ? WORKSPACE_NAME : null}
      counts={{ approvals: c.pendingDrafts, followUps: c.openFollowUps, overdue: c.overdueFollowUps, urgent: c.urgentOpen }}
      accounts={accounts}
      topbar={
        <>
          <LiveStatus mailboxes={db.accounts.length} stream={!process.env.VERCEL} />
          <span className="spacer" />
          <form className="top-search" method="get" action="/inbox" role="search">
            <label className="visually-hidden" htmlFor="top-q">
              Search mail
            </label>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden focusable="false">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input id="top-q" type="search" name="q" placeholder="Search mail" autoComplete="off" />
          </form>
          <span className="top-health" title={`${connected} of ${db.accounts.length} mailboxes connected`}>
            <span className="dot" aria-hidden />
            {connected}/{db.accounts.length} connected
          </span>
        </>
      }
    >
      {children}
    </Shell>
  )
}
