import Link from 'next/link'
import type { Account, ActivityEvent } from '@/lib/types'
import { Empty, When, type Tone } from './ui'

const KIND: Partial<Record<ActivityEvent['kind'], { tone: Tone; label: string }>> = {
  analysed: { tone: 'blue', label: 'Analysed' },
  moved: { tone: 'grey', label: 'Filed' },
  'folder-created': { tone: 'teal', label: 'New folder' },
  categorised: { tone: 'grey', label: 'Category' },
  flagged: { tone: 'amber', label: 'Flagged' },
  'marked-read': { tone: 'grey', label: 'Read' },
  'draft-created': { tone: 'violet', label: 'Draft' },
  'reply-sent': { tone: 'green', label: 'Sent' },
  'reply-blocked': { tone: 'amber', label: 'Held' },
  'draft-discarded': { tone: 'grey', label: 'Discarded' },
  'follow-up-opened': { tone: 'blue', label: 'Follow-up' },
  'follow-up-closed': { tone: 'green', label: 'Closed' },
  webhook: { tone: 'teal', label: 'Webhook' },
  'rule-skipped': { tone: 'grey', label: 'Skipped' },
  error: { tone: 'red', label: 'Error' },
  sync: { tone: 'grey', label: 'System' },
  received: { tone: 'blue', label: 'Received' },
  subscription: { tone: 'grey', label: 'Graph' },
}

export function ActivityFeed({ events, accounts }: { events: ActivityEvent[]; accounts: Account[] }) {
  if (events.length === 0) return <Empty>Nothing yet.</Empty>
  const byId = new Map(accounts.map((a) => [a.id, a]))
  return (
    <ul className="feed">
      {events.map((e) => {
        const k = KIND[e.kind] ?? { tone: 'grey' as Tone, label: e.kind }
        const account = e.accountId ? byId.get(e.accountId) : undefined
        return (
          <li key={e.id}>
            <span className="when">
              <When value={e.at} />
            </span>
            <span className="what">
              <span className={`kind ${k.tone}`}>
                <span className="dot" aria-hidden />
                {k.label}
                {account && <span className="acct">· {account.displayName}</span>}
              </span>
              <span className="detail">
                {e.messageId ? <Link href={`/inbox/${encodeURIComponent(e.messageId)}`}>{e.detail}</Link> : e.detail}
              </span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
