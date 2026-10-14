import Link from 'next/link'
import { CATEGORIES } from '@/lib/domain/categories'
import type { InboxRow } from '@/lib/queries'
import { When } from './ui'

/**
 * One message in a list. Two lines, always the same shape: who and what on
 * the left, when and the one or two states that need attention on the right.
 * Category and filing are context, so they sit in the summary line as text
 * rather than competing as badges; priority is only shown when it is high.
 */
export function MailRow({ row, showAccount = true }: { row: InboxRow; showAccount?: boolean }) {
  const { message: m, analysis: a, account, folder, draft } = row
  const filed = folder && !folder.wellKnown ? folder.path : null

  return (
    <li>
      <Link className={`mail-row${m.isRead ? '' : ' unread'}`} href={`/inbox/${encodeURIComponent(m.id)}`}>
        <span className="stripe" style={{ background: account.color }} aria-hidden />

        <span className="who">
          <span className="name ellipsis">{m.from.name || m.from.address}</span>
          {showAccount && <span className="to ellipsis">to {account.displayName}</span>}
        </span>

        <span className="body">
          <span className="subject">
            {m.flagged && (
              <svg className="flag" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-label="Flagged" role="img">
                <path d="M5 21V4h11l-1.5 4L16 12H7v9z" />
              </svg>
            )}
            <span className="ellipsis">{m.subject}</span>
          </span>
          <span className="summary">
            {a ? (
              <>
                <span className="cat">{CATEGORIES[a.category]?.label.en ?? a.category}</span>
                {filed && <span className="filed"> · {filed}</span>}
                <span className="sep"> — </span>
                {a.summary}
              </>
            ) : (
              <span className="row" style={{ gap: 6 }}>
                <span className="pending-dot" aria-hidden /> Analysing…
              </span>
            )}
          </span>
        </span>

        <span className="meta">
          <When value={m.receivedAt} />
          <span className="tags">
            {a?.injectionSuspected && <span className="tag red">Suspicious</span>}
            {draft?.status === 'pending' && <span className="tag amber">Draft ready</span>}
            {draft?.status === 'sent' && <span className="tag green">Replied</span>}
            {a && (a.band === 'urgent' || a.band === 'high') && (
              <span className={`prio ${a.band}`} title={`Priority ${a.priority}/100`}>
                {a.band === 'urgent' ? 'Urgent' : 'High'}
              </span>
            )}
          </span>
        </span>
      </Link>
    </li>
  )
}
