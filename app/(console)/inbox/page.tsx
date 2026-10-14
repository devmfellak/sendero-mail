import Link from 'next/link'
import { MailRow } from '@/components/mail-row'
import { Card, Empty, PageHead } from '@/components/ui'
import { CATEGORIES } from '@/lib/domain/categories'
import { inbox, type InboxFilter } from '@/lib/queries'
import { store } from '@/lib/runtime'
import { CATEGORY_KEYS, type CategoryKey, type Language, type PriorityBand } from '@/lib/types'

export const metadata = { title: 'Inbox' }

type Search = Record<string, string | string[] | undefined>

const VIEWS = [
  { key: 'triage', label: 'By priority' },
  { key: 'needs-reply', label: 'Awaiting reply' },
  { key: 'all', label: 'Newest first' },
  { key: 'filed', label: 'Filed by agent' },
] as const

export default async function InboxPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams
  const one = (k: string) => (typeof sp[k] === 'string' && sp[k] ? (sp[k] as string) : undefined)
  const view = (one('view') ?? 'triage') as (typeof VIEWS)[number]['key']

  const filter: InboxFilter = {
    account: one('account'),
    band: one('band') as PriorityBand | undefined,
    category: CATEGORY_KEYS.includes(one('category') as CategoryKey) ? (one('category') as CategoryKey) : undefined,
    lang: one('lang') as Language | undefined,
    q: one('q'),
    view: view === 'triage' ? undefined : view,
  }
  const rows = inbox(filter)
  const accounts = store().read.accounts
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => typeof v === 'string')), ...patch })) {
      if (v) p.set(k, v as string)
    }
    return `/inbox?${p}`
  }

  return (
    <>
      <PageHead
        title="Inbox"
        lede="Every mailbox in one list, ordered by what matters. The colour on the left is the mailbox."
        action={
          <nav className="segmented" aria-label="View">
            {VIEWS.map((v) => (
              <Link key={v.key} href={qs({ view: v.key === 'triage' ? undefined : v.key })} aria-current={view === v.key ? 'true' : undefined}>
                {v.label}
              </Link>
            ))}
          </nav>
        }
      />

      <form className="filters" method="get" action="/inbox">
        {view !== 'triage' && <input type="hidden" name="view" value={view} />}
        <label className="visually-hidden" htmlFor="f-account">Mailbox</label>
        <select id="f-account" className="select" name="account" defaultValue={filter.account ?? ''}>
          <option value="">All mailboxes</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName}
            </option>
          ))}
        </select>
        <label className="visually-hidden" htmlFor="f-band">Priority</label>
        <select id="f-band" className="select" name="band" defaultValue={filter.band ?? ''}>
          <option value="">Any priority</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
        <label className="visually-hidden" htmlFor="f-cat">Category</label>
        <select id="f-cat" className="select" name="category" defaultValue={filter.category ?? ''}>
          <option value="">Any category</option>
          {CATEGORY_KEYS.map((k) => (
            <option key={k} value={k}>
              {CATEGORIES[k].label.en}
            </option>
          ))}
        </select>
        <label className="visually-hidden" htmlFor="f-lang">Language</label>
        <select id="f-lang" className="select" name="lang" defaultValue={filter.lang ?? ''}>
          <option value="">EN + ES</option>
          <option value="en">English</option>
          <option value="es">Spanish</option>
        </select>
        <label className="visually-hidden" htmlFor="f-q">Search</label>
        <input id="f-q" className="input" type="search" name="q" placeholder="Search sender, subject, summary" defaultValue={filter.q ?? ''} />
        <button className="btn" type="submit">
          Filter
        </button>
        {(filter.account || filter.band || filter.category || filter.lang || filter.q) && (
          <Link className="btn ghost" href={view === 'triage' ? '/inbox' : `/inbox?view=${view}`}>
            Clear
          </Link>
        )}
        <span className="spacer" />
        <span className="small muted tnum">{rows.length} messages</span>
      </form>

      <Card tight>
        {rows.length ? (
          <ul className="mail-list">
            {rows.map((row) => (
              <MailRow key={row.message.id} row={row} showAccount={!filter.account} />
            ))}
          </ul>
        ) : (
          <Empty>No messages match.</Empty>
        )}
      </Card>
    </>
  )
}
