import Link from 'next/link'
import { toggleRuleAction } from '@/app/actions'
import { Badge, Card, Empty, PageHead } from '@/components/ui'
import { describeAction, describeCondition } from '@/lib/domain/describe'
import { store } from '@/lib/runtime'
import type { Rule } from '@/lib/types'

export const metadata = { title: 'Rules' }

export default function RulesPage() {
  const db = store().read
  const groups: Array<{ key: string; title: string; color?: string; rules: Rule[] }> = [
    { key: 'all', title: 'All mailboxes', rules: db.rules.filter((r) => r.accountId === null) },
    ...db.accounts.map((a) => ({ key: a.id, title: a.displayName, color: a.color, rules: db.rules.filter((r) => r.accountId === a.id) })),
  ]

  return (
    <>
      <PageHead
        title="Rules"
        lede="The model classifies; rules decide what happens. Rules run in order — account rules before shared ones at the same step — and a rule marked “stop” ends the run."
        action={
          <Link className="btn primary" href="/rules/new">
            New rule
          </Link>
        }
      />
      <div className="stack">
        {groups.map((g) => (
          <Card
            key={g.key}
            title={
              <span className="row" style={{ gap: 8 }}>
                {g.color && <span className="swatch" style={{ background: g.color }} aria-hidden />}
                {g.title}
              </span>
            }
            action={
              <Link className="small" href={`/rules/new?account=${g.key === 'all' ? '' : g.key}`}>
                Add rule
              </Link>
            }
            tight
          >
            {g.rules.length === 0 ? (
              <Empty>No rules of its own — the shared rules apply.</Empty>
            ) : (
              [...g.rules]
                .sort((a, b) => a.order - b.order)
                .map((r) => (
                  <div key={r.id} className={`rule${r.enabled ? '' : ' disabled'}`}>
                    <div style={{ minWidth: 0 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="chip tnum" title="Order">
                          {r.order}
                        </span>
                        <Link className="strong" href={`/rules/${r.id}`}>
                          {r.name}
                        </Link>
                        {r.stop && <Badge>stop</Badge>}
                        {!r.enabled && <Badge tone="amber">off</Badge>}
                        {r.then.some((a) => a.type === 'autoReply') && <Badge tone="green">auto-reply</Badge>}
                      </div>
                      <div className="rule-logic">
                        <b>When</b> {r.when.length ? r.when.map(describeCondition).join(' and ') : 'any message'} <b>then</b>{' '}
                        {r.then.map(describeAction).join(', ')}
                      </div>
                    </div>
                    <form action={toggleRuleAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="btn small" type="submit">
                        {r.enabled ? 'Turn off' : 'Turn on'}
                      </button>
                    </form>
                  </div>
                ))
            )}
          </Card>
        ))}
      </div>
    </>
  )
}
