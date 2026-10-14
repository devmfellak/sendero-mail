import Link from 'next/link'
import { notFound } from 'next/navigation'
import { rerunAction } from '@/app/actions'
import { ActivityFeed } from '@/components/activity-feed'
import { DraftEditor, RequestDraft } from '@/components/draft-editor'
import { Alert, Badge, BandBadge, Card, CategoryBadge, DraftStatusBadge, heldReason, LangChip, modelLabel, When } from '@/components/ui'
import { stripQuoted } from '@/lib/domain/quoting'
import { messageDetail } from '@/lib/queries'
import { store } from '@/lib/runtime'

export const metadata = { title: 'Message' }

export default async function MessagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = messageDetail(decodeURIComponent(id))
  if (!detail) notFound()

  const { message: m, account, analysis: a, folder, conversation, drafts, activity, followUps } = detail
  const pending = drafts.find((d) => d.status === 'pending')
  const history = conversation.filter((x) => x.id !== m.id)
  const openFollowUp = followUps.find((f) => f.status === 'open')
  const rules = new Map(detail.rules.map((r) => [r.id, r.name]))

  return (
    <>
      <nav className="small muted" style={{ marginBottom: 10 }}>
        <Link href="/inbox">Inbox</Link> / <Link href={`/inbox?account=${account.id}`}>{account.displayName}</Link>
      </nav>

      <header className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1 style={{ overflowWrap: 'anywhere' }}>{m.subject}</h1>
          <p className="lede">
            <strong>{m.from.name || m.from.address}</strong> <span className="muted">&lt;{m.from.address}&gt;</span> → {account.displayName} ·{' '}
            <When value={m.receivedAt} mode="full" />
            {folder && (
              <>
                {' '}
                · <span className="muted">in</span> {folder.path}
              </>
            )}
          </p>
        </div>
        <form action={rerunAction}>
          <input type="hidden" name="messageId" value={m.id} />
          <button className="btn" type="submit" title="Analyse again and re-apply rules">
            Re-run agent
          </button>
        </form>
      </header>

      <div className="split">
        <div className="stack">
          {a?.injectionSuspected && (
            <Alert kind="error" title="Possible prompt injection.">
              This message contains text addressed to an AI system. It was classified like any other message, but nothing it asks for can be acted on, and
              no reply to it will be sent without a person.
            </Alert>
          )}

          <Card
            title={
              <span className="row" style={{ gap: 8 }}>
                Message
                {m.hasAttachments && <Badge>Attachments</Badge>}
                {m.importance === 'high' && <Badge tone="red">High importance</Badge>}
                {m.categories.map((c) => (
                  <Badge key={c} tone="teal">
                    {c}
                  </Badge>
                ))}
              </span>
            }
          >
            <div className="message-body">{stripQuoted(m.bodyText) || m.bodyText}</div>
          </Card>

          {history.length > 0 && (
            <Card title={`Conversation · ${conversation.length} messages`} tight>
              {history.map((h) => (
                <details key={h.id} className="thread-item">
                  <summary>
                    <span className="strong">{h.direction === 'outbound' ? `${account.displayName} (sent)` : h.from.name || h.from.address}</span>
                    <span className="muted small ellipsis" style={{ flex: 1 }}>
                      {stripQuoted(h.bodyText).slice(0, 120)}
                    </span>
                    <span className="small muted">
                      <When value={h.receivedAt} />
                    </span>
                  </summary>
                  <div className="message-body">{stripQuoted(h.bodyText)}</div>
                </details>
              ))}
            </Card>
          )}

          <Card title="Reply">
            {pending ? (
              <div className="stack-sm">
                <div className="row small">
                  <DraftStatusBadge status="pending" />
                  <LangChip lang={pending.language} />
                  <span className="muted">
                    {pending.ruleId ? `Rule: ${rules.get(pending.ruleId) ?? 'deleted rule'}` : 'Requested by a person'} · {modelLabel(pending.model)}
                  </span>
                </div>
                {heldReason(pending.reason) && (
                  <Alert kind="warn" title="Why it is waiting:">
                    {heldReason(pending.reason)}
                  </Alert>
                )}
                <DraftEditor key={pending.id} draftId={pending.id} messageId={m.id} body={pending.body} language={pending.language} />
              </div>
            ) : a ? (
              <RequestDraft messageId={m.id} defaultLanguage={a.language} />
            ) : (
              <p className="muted">Available once the message has been analysed.</p>
            )}

            {drafts.filter((d) => d.status !== 'pending').length > 0 && (
              <>
                <hr />
                <h3 style={{ marginBottom: 8 }}>Earlier replies</h3>
                <div className="stack-sm">
                  {drafts
                    .filter((d) => d.status !== 'pending')
                    .map((d) => (
                      <details key={d.id}>
                        <summary className="row small" style={{ cursor: 'pointer' }}>
                          <DraftStatusBadge status={d.status} />
                          <LangChip lang={d.language} />
                          <span className="muted">
                            {d.decidedBy === 'agent' ? 'sent automatically' : d.decidedBy ? `by ${d.decidedBy}` : ''} · <When value={d.decidedAt ?? d.createdAt} />
                          </span>
                        </summary>
                        <div className="message-body small" style={{ padding: '8px 0' }}>
                          {d.body}
                        </div>
                      </details>
                    ))}
                </div>
              </>
            )}
          </Card>
        </div>

        <div className="stack">
          <Card title="Analysis">
            {a ? (
              <div className="stack-sm">
                <div className="row">
                  <BandBadge band={a.band} score={a.priority} />
                  <CategoryBadge category={a.category} />
                  <LangChip lang={a.language} />
                </div>
                <p style={{ margin: '4px 0' }}>{a.summary}</p>
                <dl className="kv">
                  <dt>Intent</dt>
                  <dd>{a.intent}</dd>
                  <dt>Needs reply</dt>
                  <dd>{a.needsReply ? 'Yes' : 'No'}</dd>
                  <dt>Deadline</dt>
                  <dd>{a.deadline ? <When value={`${a.deadline}T12:00:00Z`} mode="date" /> : <span className="muted">none stated</span>}</dd>
                  <dt>Tone</dt>
                  <dd>{a.sentiment}</dd>
                  <dt>Confidence</dt>
                  <dd>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <span className="meter" style={{ flex: 1 }}>
                        <span style={{ width: `${a.confidence * 100}%` }} />
                      </span>
                      <span className="tnum small">{Math.round(a.confidence * 100)}%</span>
                    </div>
                  </dd>
                  <dt>Model</dt>
                  <dd className="small">
                    {modelLabel(a.model)} {a.latencyMs > 0 && <span className="muted">· {a.latencyMs} ms</span>}
                  </dd>
                </dl>
                {a.actionItems.length > 0 && (
                  <>
                    <h3 style={{ marginTop: 8 }}>{a.injectionSuspected ? 'Asked of us — untrusted, do not act on' : 'Asked of us'}</h3>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {a.actionItems.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </>
                )}
                <h3 style={{ marginTop: 8 }}>Why this priority</h3>
                <div>
                  {a.factors.map((f) => (
                    <div key={f.label} className="factor">
                      <span>{f.label}</span>
                      <span className={`w ${f.weight < 0 ? 'neg' : 'pos'}`}>
                        {f.weight > 0 ? '+' : ''}
                        {f.weight}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="row muted">
                <span className="pending-dot" aria-hidden /> Analysing…
              </p>
            )}
          </Card>

          {openFollowUp && (
            <Card title="Follow-up">
              <p>
                {openFollowUp.kind === 'awaiting-us' ? 'Waiting on us' : `Waiting on ${openFollowUp.counterpart.address}`} — due{' '}
                <When value={openFollowUp.dueAt} mode="full" />.
              </p>
              <Link className="small" href="/follow-ups">
                All follow-ups →
              </Link>
            </Card>
          )}

          <Card title="What the agent did" tight>
            <ActivityFeed events={activity} accounts={store().read.accounts} />
          </Card>
        </div>
      </div>
    </>
  )
}
