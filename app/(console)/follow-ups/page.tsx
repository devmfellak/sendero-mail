import Link from 'next/link'
import { followUpAction } from '@/app/actions'
import { Badge, Card, Empty, PageHead, When } from '@/components/ui'
import { openFollowUps } from '@/lib/queries'

export const metadata = { title: 'Follow-ups' }

export default function FollowUpsPage() {
  const all = openFollowUps()
  const onUs = all.filter((f) => f.kind === 'awaiting-us')
  const onThem = all.filter((f) => f.kind === 'awaiting-them')

  const list = (items: typeof all, empty: string) =>
    items.length === 0 ? (
      <Empty>{empty}</Empty>
    ) : (
      <table className="table">
        <thead>
          <tr>
            <th>Conversation</th>
            <th>Mailbox</th>
            <th>Due</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {items.map((f) => (
            <tr key={f.id}>
              <td style={{ minWidth: 0 }}>
                <Link href={`/inbox/${encodeURIComponent(f.messageId)}`} className="strong">
                  {f.subject}
                </Link>
                <div className="small muted">{f.counterpart.name ? `${f.counterpart.name} · ${f.counterpart.address}` : f.counterpart.address}</div>
              </td>
              <td className="nowrap">
                <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                  <span className="swatch" style={{ background: f.account.color }} aria-hidden />
                  <span className="small">{f.account.displayName}</span>
                </span>
              </td>
              <td className="nowrap">
                {f.overdue ? <Badge tone="red">Overdue</Badge> : null} <When value={f.dueAt} mode="full" />
              </td>
              <td className="nowrap" style={{ textAlign: 'right' }}>
                <form action={followUpAction} className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                  <input type="hidden" name="id" value={f.id} />
                  <button className="btn small" name="op" value="snooze" type="submit">
                    Snooze 2 days
                  </button>
                  <button className="btn small" name="op" value="done" type="submit">
                    Done
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )

  return (
    <>
      <PageHead
        title="Follow-ups"
        lede="Conversations where someone is waiting. They close themselves when the other side writes — including replies sent from Outlook on a phone."
      />
      <div className="stack">
        <Card title={`Waiting on us · ${onUs.length}`} tight>
          {list(onUs, 'Nobody is waiting on a reply from us.')}
        </Card>
        <Card title={`Waiting on them · ${onThem.length}`} tight>
          {list(onThem, 'No unanswered questions of ours.')}
        </Card>
      </div>
    </>
  )
}
