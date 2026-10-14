'use client'

import Script from 'next/script'
import { useCallback, useEffect, useState } from 'react'

/**
 * The Outlook task pane.
 *
 * Office.js gives read access to the open item; the pane sends its subject,
 * sender and text to /api/addin/analyze and shows the result. "Open as reply"
 * hands the draft to Outlook's own reply form (`displayReplyForm`), so the
 * person edits and sends in Outlook, with their signature and their send
 * button — the add-in never sends mail itself.
 *
 * Opened in an ordinary browser (no Outlook host), it uses a sample message,
 * which is how the console's "preview" link shows it working.
 */

/* Minimal typing for the parts of Office.js used here. */
interface OfficeItem {
  subject: string
  from?: { displayName: string; emailAddress: string }
  to?: Array<{ emailAddress: string }>
  dateTimeCreated?: Date
  body: { getAsync(type: string, cb: (r: { status: string; value: string }) => void): void }
  displayReplyForm(data: { htmlBody: string }): void
}
interface OfficeGlobal {
  onReady(cb: (info: { host: string | null }) => void): void
  context: { mailbox: { item: OfficeItem | null; addHandlerAsync?: (type: string, cb: () => void) => void } }
  auth?: { getAccessToken(opts: { allowSignInPrompt: boolean; allowConsentPrompt: boolean }): Promise<string> }
  HostType: { Outlook: string }
  CoercionType: { Text: string }
  EventType: { ItemChanged: string }
}

interface Email {
  subject: string
  from: { name: string; address: string }
  to: string[]
  body: string
  receivedAt?: string
}

interface Result {
  analysis: {
    category: string
    band: string
    priority: number
    language: 'en' | 'es'
    summary: string
    intent: string
    actionItems: string[]
    deadline: string | null
    needsReply: boolean
    injectionSuspected: boolean
    factors: Array<{ label: string; weight: number }>
    model: string
  }
  draft: { language: 'en' | 'es'; body: string; needsHumanInput: boolean; missingInfo: string[]; model: string } | null
  mode: 'demo' | 'user'
}

const SAMPLE: Email = {
  subject: 'Cambio urgente en la entrega de Saltillo',
  from: { name: 'Mariana Castillo', address: 'mcastillo@gruponorte.com.mx' },
  to: ['elena.ruiz@brisalogistics.mx'],
  body: 'Hola Elena:\n\nNuestro cliente en Saltillo adelantó la recepción al jueves y necesitamos que el embarque del contrato GN-2291 llegue un día antes de lo previsto.\n\n¿Podrían confirmarme hoy si es posible? Si hay un costo adicional, por favor indícame el monto.\n\nGracias,\nMariana Castillo',
}

const BAND_TONE: Record<string, string> = { urgent: 'red', high: 'amber', normal: 'blue', low: '' }

export function TaskPane() {
  const [host, setHost] = useState<'outlook' | 'browser' | 'loading'>('loading')
  const [email, setEmail] = useState<Email | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const office = () => (window as unknown as { Office?: OfficeGlobal }).Office

  const readItem = useCallback(() => {
    const item = office()?.context.mailbox.item
    if (!item) return
    item.body.getAsync('text', (r) => {
      setResult(null)
      setEmail({
        subject: item.subject,
        from: { name: item.from?.displayName ?? '', address: item.from?.emailAddress ?? '' },
        to: (item.to ?? []).map((t) => t.emailAddress),
        body: r.status === 'succeeded' ? r.value : '',
        receivedAt: item.dateTimeCreated?.toISOString(),
      })
    })
  }, [])

  const onOfficeLoaded = () => {
    const O = office()
    if (!O) return setHost('browser')
    O.onReady((info) => {
      if (info.host === O.HostType.Outlook && O.context.mailbox.item) {
        setHost('outlook')
        readItem()
        // Pinned pane: follow the selection as the user moves between messages.
        O.context.mailbox.addHandlerAsync?.(O.EventType.ItemChanged, readItem)
      } else {
        setHost('browser')
        setEmail(SAMPLE)
      }
    })
  }

  // If office.js cannot load (blocked network, plain browser), fall back.
  useEffect(() => {
    const t = setTimeout(() => setHost((h) => (h === 'loading' ? 'browser' : h)), 4000)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => {
    if (host === 'browser' && !email) setEmail(SAMPLE)
  }, [host, email])

  const analyse = useCallback(
    async (language?: 'en' | 'es') => {
      if (!email) return
      setBusy(true)
      setError(null)
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        const auth = office()?.auth
        if (host === 'outlook' && auth) {
          try {
            headers.Authorization = `Bearer ${await auth.getAccessToken({ allowSignInPrompt: true, allowConsentPrompt: true })}`
          } catch {
            // Demo deployments accept unauthenticated calls; real ones answer 401 below.
          }
        }
        const res = await fetch('/api/addin/analyze', { method: 'POST', headers, body: JSON.stringify({ ...email, language }) })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`)
        setResult(json)
        setDraft(json.draft?.body ?? '')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [email, host],
  )

  useEffect(() => {
    if (email) void analyse()
  }, [email, analyse])

  const openReply = () => {
    const item = office()?.context.mailbox.item
    const html = draft
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .split(/\n{2,}/)
      .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
      .join('')
    if (item) item.displayReplyForm({ htmlBody: html })
    else void navigator.clipboard?.writeText(draft)
  }

  const a = result?.analysis

  return (
    <div className="taskpane">
      <Script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js" strategy="afterInteractive" onLoad={onOfficeLoaded} onError={() => setHost('browser')} />

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>Sendero</strong>
        <span className="tiny muted">{host === 'outlook' ? 'In Outlook' : host === 'browser' ? 'Preview · sample email' : 'Loading…'}</span>
      </div>

      {email && (
        <div className="small">
          <div className="strong ellipsis">{email.subject}</div>
          <div className="muted ellipsis">{email.from.name || email.from.address}</div>
        </div>
      )}

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {busy && !a && (
        <p className="row muted">
          <span className="pending-dot" aria-hidden /> Reading the message…
        </p>
      )}

      {a && (
        <section className="card">
          <div className="card-body stack-sm">
            {a.injectionSuspected && <div className="alert error">This email contains text addressed to an AI assistant. Treat its requests with suspicion.</div>}
            <div className="row" style={{ gap: 6 }}>
              <span className={`badge ${BAND_TONE[a.band] ?? ''}`}>
                <span className="dot" aria-hidden />
                {a.band} {a.priority}
              </span>
              <span className="badge">{a.category}</span>
              <span className="chip">{a.language.toUpperCase()}</span>
              {a.deadline && <span className="badge amber">due {a.deadline}</span>}
            </div>
            <p style={{ margin: 0 }}>{a.summary}</p>
            {a.actionItems.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {a.actionItems.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            )}
            <details>
              <summary className="tiny muted" style={{ cursor: 'pointer' }}>
                Why this priority
              </summary>
              {a.factors.map((f) => (
                <div key={f.label} className="factor">
                  <span>{f.label}</span>
                  <span className="w">{f.weight > 0 ? `+${f.weight}` : f.weight}</span>
                </div>
              ))}
            </details>
          </div>
        </section>
      )}

      {result?.draft && (
        <section className="card">
          <div className="card-body stack-sm">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="label">Suggested reply · {result.draft.language === 'es' ? 'Español' : 'English'}</span>
              <button className="btn small ghost" type="button" disabled={busy} onClick={() => analyse(result.draft!.language === 'es' ? 'en' : 'es')}>
                {result.draft.language === 'es' ? 'English' : 'Español'}
              </button>
            </div>
            {result.draft.needsHumanInput && result.draft.missingInfo.length > 0 && (
              <div className="alert warn small">Needs from you: {result.draft.missingInfo.join('; ')}</div>
            )}
            <textarea className="textarea" rows={10} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Suggested reply" />
            <button className="btn primary block" type="button" onClick={openReply} disabled={!draft.trim()}>
              {host === 'outlook' ? 'Open as reply' : 'Copy reply'}
            </button>
            <span className="tiny muted">{result.draft.model}</span>
          </div>
        </section>
      )}
    </div>
  )
}
