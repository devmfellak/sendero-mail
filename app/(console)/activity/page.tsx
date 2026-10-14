import Link from 'next/link'
import { ActivityFeed } from '@/components/activity-feed'
import { Card, PageHead } from '@/components/ui'
import { store } from '@/lib/runtime'
import type { ActivityEvent } from '@/lib/types'

export const metadata = { title: 'Activity log' }

const GROUPS: Record<string, { label: string; kinds: ActivityEvent['kind'][] }> = {
  replies: { label: 'Replies', kinds: ['reply-sent', 'reply-blocked', 'draft-created', 'draft-discarded'] },
  filing: { label: 'Filing', kinds: ['moved', 'folder-created', 'categorised', 'flagged', 'marked-read'] },
  people: { label: 'By people', kinds: [] },
  errors: { label: 'Errors', kinds: ['error'] },
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ account?: string; group?: string }> }) {
  const { account, group } = await searchParams
  const db = store().read
  const g = group ? GROUPS[group] : undefined

  const events = db.activity
    .filter((e) => !account || e.accountId === account)
    .filter((e) => (group === 'people' ? e.actor === 'user' : !g || g.kinds.includes(e.kind)))
    .slice(-400)
    .reverse()

  const link = (patch: { account?: string; group?: string }) => {
    const p = new URLSearchParams()
    const next = { account, group, ...patch }
    if (next.account) p.set('account', next.account)
    if (next.group) p.set('group', next.group)
    return `/activity?${p}`
  }

  return (
    <>
      <PageHead title="Activity log" lede="Everything the agent and its operators did, newest first. Each entry links to the message it concerns." />
      <div className="filters">
        <nav className="segmented" aria-label="Kind">
          <Link href={link({ group: undefined })} aria-current={!group ? 'true' : undefined}>
            All
          </Link>
          {Object.entries(GROUPS).map(([key, v]) => (
            <Link key={key} href={link({ group: key })} aria-current={group === key ? 'true' : undefined}>
              {v.label}
            </Link>
          ))}
        </nav>
        <nav className="segmented" aria-label="Mailbox">
          <Link href={link({ account: undefined })} aria-current={!account ? 'true' : undefined}>
            All mailboxes
          </Link>
          {db.accounts.map((a) => (
            <Link key={a.id} href={link({ account: a.id })} aria-current={account === a.id ? 'true' : undefined}>
              {a.displayName}
            </Link>
          ))}
        </nav>
      </div>
      <Card tight>
        <ActivityFeed events={events} accounts={db.accounts} />
      </Card>
    </>
  )
}
