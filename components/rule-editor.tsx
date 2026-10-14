'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { deleteRuleAction, previewRuleAction, saveRuleAction, type RuleInput } from '@/app/actions'
import type { Condition, ConditionField, ConditionOp, RuleAction } from '@/lib/types'

type Option = { value: string; label: string }

const ENUMS: Partial<Record<ConditionField, Option[]>> = {
  band: ['urgent', 'high', 'normal', 'low'].map((v) => ({ value: v, label: v })),
  language: [
    { value: 'en', label: 'English' },
    { value: 'es', label: 'Spanish' },
  ],
  sentiment: ['positive', 'neutral', 'negative'].map((v) => ({ value: v, label: v })),
}
const BOOLEAN: ConditionField[] = ['needsReply', 'hasAttachments']
const NUMERIC: ConditionField[] = ['priority', 'confidence']

const FIELDS: Option[] = [
  { value: 'category', label: 'Category' },
  { value: 'band', label: 'Priority band' },
  { value: 'priority', label: 'Priority score' },
  { value: 'language', label: 'Language' },
  { value: 'needsReply', label: 'Needs a reply' },
  { value: 'sentiment', label: 'Tone' },
  { value: 'confidence', label: 'Confidence (0–1)' },
  { value: 'from', label: 'Sender address' },
  { value: 'fromDomain', label: 'Sender domain' },
  { value: 'subject', label: 'Subject' },
  { value: 'body', label: 'Body' },
  { value: 'hasAttachments', label: 'Has attachments' },
]

const ACTIONS: Option[] = [
  { value: 'move', label: 'File in folder' },
  { value: 'categorize', label: 'Outlook category' },
  { value: 'flag', label: 'Flag' },
  { value: 'markRead', label: 'Mark read' },
  { value: 'draftReply', label: 'Draft a reply' },
  { value: 'autoReply', label: 'Reply automatically' },
  { value: 'followUp', label: 'Follow up' },
  { value: 'webhook', label: 'Webhook (n8n, Power Automate)' },
]

function opsFor(field: ConditionField): ConditionOp[] {
  if (BOOLEAN.includes(field)) return ['is']
  if (NUMERIC.includes(field)) return ['gte', 'lte']
  if (field === 'category' || ENUMS[field]) return ['is', 'isNot', 'in']
  return ['contains', 'is', 'matches']
}

const OP_LABEL: Record<ConditionOp, string> = { is: 'is', isNot: 'is not', in: 'is one of', contains: 'contains', matches: 'matches regex', gte: 'at least', lte: 'at most' }

function blankAction(type: RuleAction['type']): RuleAction {
  switch (type) {
    case 'move':
      return { type, folder: 'Clients/{senderOrg}' }
    case 'categorize':
      return { type, category: '{category}' }
    case 'followUp':
      return { type, days: 2 }
    case 'webhook':
      return { type, url: 'https://' }
    case 'draftReply':
    case 'autoReply':
      return { type, instructions: '' }
    default:
      return { type } as RuleAction
  }
}

export function RuleEditor({
  initial,
  accounts,
  categories,
}: {
  initial: RuleInput
  accounts: Option[]
  categories: Option[]
}) {
  const router = useRouter()
  const [rule, setRule] = useState<RuleInput>(initial)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewRuleAction>> | null>(null)
  const [pending, start] = useTransition()

  const set = <K extends keyof RuleInput>(key: K, value: RuleInput[K]) => setRule((r) => ({ ...r, [key]: value }))
  const setCond = (i: number, c: Partial<Condition>) => set('when', rule.when.map((x, j) => (j === i ? ({ ...x, ...c } as Condition) : x)))
  const setAction = (i: number, a: RuleAction) => set('then', rule.then.map((x, j) => (j === i ? a : x)) as RuleInput['then'])

  const clean = (): RuleInput => ({
    ...rule,
    when: rule.when.map((c) => ({
      ...c,
      value: NUMERIC.includes(c.field) ? Number(c.value) : BOOLEAN.includes(c.field) ? c.value === true || c.value === 'true' : c.op === 'in' && typeof c.value === 'string' ? c.value.split(',').map((s) => s.trim()).filter(Boolean) : c.value,
    })),
    then: rule.then.map((a) => (a.type === 'draftReply' || a.type === 'autoReply' ? { ...a, instructions: a.instructions?.trim() || undefined } : a)) as RuleInput['then'],
  })

  const save = () =>
    start(async () => {
      setError(null)
      const res = await saveRuleAction(clean())
      if (res.error) setError(res.error)
      else router.push('/rules')
    })

  const runPreview = () =>
    start(async () => {
      setError(null)
      const res = await previewRuleAction(clean())
      if (res.error) setError(res.error)
      setPreview(res)
    })

  const valueInput = (c: Condition, i: number) => {
    const id = `cond-value-${i}`
    if (BOOLEAN.includes(c.field))
      return (
        <select id={id} aria-label="Value" className="select" value={String(c.value)} onChange={(e) => setCond(i, { value: e.target.value === 'true' })}>
          <option value="true">yes</option>
          <option value="false">no</option>
        </select>
      )
    const options = c.field === 'category' ? categories : ENUMS[c.field]
    if (options && c.op !== 'in')
      return (
        <select id={id} aria-label="Value" className="select" value={String(c.value)} onChange={(e) => setCond(i, { value: e.target.value })}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )
    return (
      <input
        id={id}
        aria-label="Value"
        className="input"
        type={NUMERIC.includes(c.field) ? 'number' : 'text'}
        step={c.field === 'confidence' ? '0.05' : '1'}
        value={Array.isArray(c.value) ? c.value.join(', ') : String(c.value)}
        placeholder={c.op === 'in' ? 'comma, separated' : c.field === 'fromDomain' ? 'client.com' : ''}
        onChange={(e) => setCond(i, { value: e.target.value })}
      />
    )
  }

  return (
    <div className="split">
      <div className="stack">
        <section className="card">
          <div className="card-body form-grid">
            <label className="field full">
              <span>Name</span>
              <input className="input" value={rule.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Invoices to Finance" />
            </label>
            <label className="field">
              <span>Applies to</span>
              <select className="select" value={rule.accountId ?? ''} onChange={(e) => set('accountId', e.target.value || null)}>
                <option value="">All mailboxes</option>
                {accounts.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Order</span>
              <input className="input" type="number" min={0} max={1000} value={rule.order} onChange={(e) => set('order', Number(e.target.value))} />
            </label>
            <label className="check">
              <input type="checkbox" checked={rule.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Enabled
            </label>
            <label className="check">
              <input type="checkbox" checked={rule.stop} onChange={(e) => set('stop', e.target.checked)} /> Stop after this rule
            </label>
          </div>
        </section>

        <section className="card">
          <header className="card-head">
            <h2>When all of these are true</h2>
            <button className="btn small" type="button" onClick={() => set('when', [...rule.when, { field: 'category', op: 'is', value: 'client-request' }])}>
              Add condition
            </button>
          </header>
          <div className="card-body stack-sm">
            {rule.when.length === 0 && <p className="muted small">No conditions — matches every message.</p>}
            {rule.when.map((c, i) => (
              <div key={i} className="builder-row">
                <select
                  aria-label="Field"
                  className="select"
                  value={c.field}
                  onChange={(e) => {
                    const field = e.target.value as ConditionField
                    const op = opsFor(field)[0]!
                    const value = BOOLEAN.includes(field) ? true : NUMERIC.includes(field) ? (field === 'confidence' ? 0.8 : 50) : field === 'category' ? 'client-request' : ENUMS[field]?.[0]?.value ?? ''
                    setCond(i, { field, op, value })
                  }}
                >
                  {FIELDS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <select aria-label="Operator" className="select" value={c.op} onChange={(e) => setCond(i, { op: e.target.value as ConditionOp })}>
                  {opsFor(c.field).map((op) => (
                    <option key={op} value={op}>
                      {OP_LABEL[op]}
                    </option>
                  ))}
                </select>
                {valueInput(c, i)}
                <button className="btn ghost small" type="button" aria-label="Remove condition" onClick={() => set('when', rule.when.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <header className="card-head">
            <h2>Then</h2>
            <button className="btn small" type="button" onClick={() => set('then', [...rule.then, blankAction('flag')] as RuleInput['then'])}>
              Add action
            </button>
          </header>
          <div className="card-body stack-sm">
            {rule.then.map((a, i) => (
              <div key={i} className="builder-row action">
                <select aria-label="Action" className="select" value={a.type} onChange={(e) => setAction(i, blankAction(e.target.value as RuleAction['type']))}>
                  {ACTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <div>
                  {a.type === 'move' && (
                    <input aria-label="Folder path" className="input" value={a.folder} onChange={(e) => setAction(i, { ...a, folder: e.target.value })} />
                  )}
                  {a.type === 'categorize' && (
                    <input aria-label="Category name" className="input" value={a.category} onChange={(e) => setAction(i, { ...a, category: e.target.value })} />
                  )}
                  {(a.type === 'draftReply' || a.type === 'autoReply') && (
                    <input
                      aria-label="Guidance for the reply"
                      className="input"
                      value={a.instructions ?? ''}
                      placeholder="Guidance for the model (optional)"
                      onChange={(e) => setAction(i, { ...a, instructions: e.target.value })}
                    />
                  )}
                  {a.type === 'followUp' && (
                    <input aria-label="Business days" className="input" type="number" min={1} max={30} value={a.days ?? 2} onChange={(e) => setAction(i, { ...a, days: Number(e.target.value) })} />
                  )}
                  {a.type === 'webhook' && (
                    <input aria-label="Webhook URL" className="input" type="url" value={a.url} onChange={(e) => setAction(i, { ...a, url: e.target.value })} />
                  )}
                  {(a.type === 'flag' || a.type === 'markRead') && <span className="muted small">No options</span>}
                </div>
                <button className="btn ghost small" type="button" aria-label="Remove action" onClick={() => set('then', rule.then.filter((_, j) => j !== i) as RuleInput['then'])}>
                  ✕
                </button>
              </div>
            ))}
            <p className="hint">
              Folder paths accept {'{senderOrg}'}, {'{senderDomain}'}, {'{senderName}'}, {'{category}'}, {'{language}'}, {'{year}'}, {'{month}'}. Missing folders are created. Automatic replies are
              still subject to every guardrail and to the mailbox’s mode.
            </p>
          </div>
        </section>

        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        <div className="row">
          <button className="btn primary" type="button" onClick={save} disabled={pending || !rule.name.trim() || rule.then.length === 0}>
            Save rule
          </button>
          <button className="btn" type="button" onClick={runPreview} disabled={pending}>
            Preview on recent mail
          </button>
          <span className="spacer" />
          {rule.id && (
            <form action={deleteRuleAction}>
              <input type="hidden" name="id" value={rule.id} />
              <button className="btn ghost danger" type="submit">
                Delete
              </button>
            </form>
          )}
        </div>
      </div>

      <section className="card" aria-live="polite">
        <header className="card-head">
          <h2>Dry run</h2>
        </header>
        <div className="card-body">
          {!preview ? (
            <p className="muted small">Shows which recent messages this rule would match and what it would do to them. Nothing is changed.</p>
          ) : preview.matches ? (
            <div className="stack-sm">
              <p className="small muted">
                {preview.matches.length} of {preview.scanned} recent messages match{preview.matches.length === 25 ? ' (first 25 shown)' : ''}.
              </p>
              {preview.matches.map((m) => (
                <div key={m.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  <div className="strong small ellipsis">{m.subject}</div>
                  <div className="tiny muted">
                    {m.from} · {m.account}
                  </div>
                  <div className="tiny">{m.actions.join(' · ')}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
