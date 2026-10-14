'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/**
 * Application chrome. A client component only for `usePathname`; it receives
 * plain serialisable props — counts and account labels — never store objects.
 */

export interface ShellProps {
  counts: { approvals: number; followUps: number; overdue: number; urgent: number }
  accounts: Array<{ id: string; name: string; color: string; pending: number }>
  workspace: string | null
  topbar: ReactNode
  mark: ReactNode
  children: ReactNode
}

type IconName = 'overview' | 'inbox' | 'approvals' | 'followups' | 'rules' | 'mailboxes' | 'activity' | 'addin' | 'integrations'

const NAV: Array<{ href: string; label: string; icon: IconName; key?: 'urgent' | 'approvals' | 'followUps' }> = [
  { href: '/', label: 'Overview', icon: 'overview' },
  { href: '/inbox', label: 'Inbox', icon: 'inbox', key: 'urgent' },
  { href: '/approvals', label: 'Approvals', icon: 'approvals', key: 'approvals' },
  { href: '/follow-ups', label: 'Follow-ups', icon: 'followups', key: 'followUps' },
]

const CONFIG: Array<{ href: string; label: string; icon: IconName }> = [
  { href: '/rules', label: 'Rules', icon: 'rules' },
  { href: '/accounts', label: 'Mailboxes', icon: 'mailboxes' },
  { href: '/activity', label: 'Activity log', icon: 'activity' },
  { href: '/addin', label: 'Outlook add-in', icon: 'addin' },
  { href: '/settings', label: 'Integrations', icon: 'integrations' },
]

export function Shell({ counts, accounts, workspace, topbar, mark, children }: ShellProps) {
  const pathname = usePathname()
  const current = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`))

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <nav className="sidebar" aria-label="Main">
        <Link className="brand" href="/">
          {mark}
          <span>
            Sendero
            {workspace && <span className="brand-sub">{workspace}</span>}
          </span>
        </Link>

        {NAV.map((item) => {
          const n = item.key ? counts[item.key] : 0
          const hot = item.key === 'approvals' ? n > 0 : item.key === 'followUps' ? counts.overdue > 0 : item.key === 'urgent' && n > 0
          return (
            <Link key={item.href} className="nav-item" href={item.href} aria-current={current(item.href) ? 'page' : undefined}>
              <Icon name={item.icon} />
              <span className="nav-label">{item.label}</span>
              {n > 0 && (
                <span className={`nav-count${hot ? ' hot' : ''}`} aria-label={`${n} ${item.key === 'urgent' ? 'urgent' : 'open'}`}>
                  {n}
                </span>
              )}
            </Link>
          )
        })}

        <div className="nav-heading">Configure</div>
        {CONFIG.map((item) => (
          <Link key={item.href} className="nav-item" href={item.href} aria-current={current(item.href) ? 'page' : undefined}>
            <Icon name={item.icon} />
            <span className="nav-label">{item.label}</span>
          </Link>
        ))}

        <div className="nav-heading">Mailboxes</div>
        <div className="nav-accounts">
          {accounts.map((a) => (
            <Link key={a.id} className="nav-account" href={`/inbox?account=${a.id}`}>
              <span className="swatch" style={{ background: a.color }} aria-hidden />
              <span className="ellipsis" style={{ flex: 1 }}>
                {a.name}
              </span>
              {a.pending > 0 && (
                <span className="tiny tnum muted" title={`${a.pending} drafts awaiting approval`}>
                  {a.pending}
                </span>
              )}
            </Link>
          ))}
        </div>
      </nav>

      <div className="main">
        <header className="topbar">{topbar}</header>
        <main id="main" className="content">
          {children}
        </main>
      </div>
    </div>
  )
}

const PATHS: Record<IconName, ReactNode> = {
  overview: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  inbox: (
    <>
      <path d="M3 13l2.5-8h13L21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M3 13h5l1.5 3h5L16 13h5" />
    </>
  ),
  approvals: (
    <>
      <path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8" />
      <path d="M9 11l3 3 9-9" />
    </>
  ),
  followups: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  rules: (
    <>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </>
  ),
  mailboxes: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  addin: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M15 3v18" />
    </>
  ),
  integrations: (
    <>
      <path d="M9 7V3M15 7V3" />
      <path d="M6 7h12v4a6 6 0 0 1-12 0z" />
      <path d="M12 17v4" />
    </>
  ),
}

function Icon({ name }: { name: IconName }) {
  return (
    <svg className="nav-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      {PATHS[name]}
    </svg>
  )
}
