import type { ReactNode } from 'react'
import { CATEGORIES } from '@/lib/domain/categories'
import { env } from '@/lib/env'
import type { Account, AutomationMode, CategoryKey, DraftStatus, Language, PriorityBand } from '@/lib/types'

/**
 * Shared primitives. Server components, all of them: none hold state, so none
 * need to ship JavaScript.
 */

export type Tone = 'red' | 'amber' | 'green' | 'blue' | 'violet' | 'teal' | 'grey'

export function Badge({ tone = 'grey', children, dot = false, title }: { tone?: Tone; children: ReactNode; dot?: boolean; title?: string }) {
  return (
    <span className={`badge ${tone === 'grey' ? '' : tone}`} title={title}>
      {dot && <span className="dot" aria-hidden />}
      {children}
    </span>
  )
}

const BAND_TONE: Record<PriorityBand, Tone> = { urgent: 'red', high: 'amber', normal: 'blue', low: 'grey' }
const BAND_LABEL: Record<PriorityBand, string> = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' }

export function BandBadge({ band, score }: { band: PriorityBand; score?: number }) {
  return (
    <Badge tone={BAND_TONE[band]} dot title={score !== undefined ? `Priority ${score}/100` : undefined}>
      {BAND_LABEL[band]}
      {score !== undefined && <span className="tnum" style={{ opacity: 0.75 }}>{score}</span>}
    </Badge>
  )
}

export function CategoryBadge({ category, lang = 'en' }: { category: CategoryKey; lang?: Language }) {
  const tone: Tone = category === 'spam' ? 'red' : category === 'legal' || category === 'billing' ? 'violet' : category === 'sales-lead' ? 'teal' : 'grey'
  return <Badge tone={tone}>{CATEGORIES[category]?.label[lang] ?? category}</Badge>
}

export function LangChip({ lang }: { lang: Language }) {
  return (
    <span className="chip" title={lang === 'es' ? 'Spanish' : 'English'}>
      {lang.toUpperCase()}
    </span>
  )
}

const MODE: Record<AutomationMode, { tone: Tone; label: string }> = {
  observe: { tone: 'grey', label: 'Observe' },
  assist: { tone: 'blue', label: 'Assist' },
  auto: { tone: 'green', label: 'Autopilot' },
}

export function ModeBadge({ mode }: { mode: AutomationMode }) {
  return <Badge tone={MODE[mode].tone}>{MODE[mode].label}</Badge>
}

export function AccountStatus({ account }: { account: Account }) {
  const map: Record<Account['status'], { tone: Tone; label: string }> = {
    connected: { tone: 'green', label: 'Connected' },
    'needs-consent': { tone: 'amber', label: 'Reconnect needed' },
    error: { tone: 'red', label: 'Error' },
    paused: { tone: 'grey', label: 'Paused' },
  }
  const s = map[account.status]
  return (
    <Badge tone={s.tone} dot title={account.statusDetail}>
      {s.label}
    </Badge>
  )
}

export function DraftStatusBadge({ status }: { status: DraftStatus }) {
  const map: Record<DraftStatus, { tone: Tone; label: string }> = {
    pending: { tone: 'amber', label: 'Awaiting approval' },
    saved: { tone: 'blue', label: 'In Outlook Drafts' },
    sent: { tone: 'green', label: 'Sent' },
    discarded: { tone: 'grey', label: 'Discarded' },
    blocked: { tone: 'red', label: 'Blocked' },
  }
  return <Badge tone={map[status].tone}>{map[status].label}</Badge>
}

/** "anthropic/claude-opus-5-5" → "Claude · claude-opus-5-5". The built-in engine gets a plain name. */
export function modelLabel(model: string): string {
  const [provider, ...rest] = model.split('/')
  const name = rest.join('/')
  if (provider === 'offline') return 'Sendero built-in'
  const vendor: Record<string, string> = { anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini' }
  return name ? `${vendor[provider!] ?? provider} · ${name}` : model
}

/** Reasons worth showing a person. "Drafted for review" is what every assist-mode draft says. */
export function heldReason(reason: string | undefined): string | null {
  const parts = (reason ?? '').split('; ').filter((r) => r && r !== 'Drafted for review')
  return parts.length ? parts.join(' · ') : null
}

export function Swatch({ color, label }: { color: string; label?: string }) {
  return <span className="swatch" style={{ background: color }} aria-label={label} role={label ? 'img' : undefined} />
}

export function Card({ title, action, children, tight }: { title?: ReactNode; action?: ReactNode; children: ReactNode; tight?: boolean }) {
  return (
    <section className="card">
      {title && (
        <header className="card-head">
          <h2>{title}</h2>
          {action}
        </header>
      )}
      <div className={`card-body${tight ? ' tight' : ''}`}>{children}</div>
    </section>
  )
}

export function Stat({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: Tone }) {
  return (
    <div className="card stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={tone && tone !== 'grey' ? { color: `var(--${tone})` } : undefined}>
        {value}
      </div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  )
}

export function PageHead({ title, lede, action }: { title: string; lede?: ReactNode; action?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
      {action}
    </header>
  )
}

export function Alert({ kind = 'info', title, children }: { kind?: 'info' | 'warn' | 'error' | 'success'; title?: string; children?: ReactNode }) {
  return (
    <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : undefined}>
      {title && <strong>{title}</strong>}
      {title && children ? ' ' : null}
      {children}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}

/**
 * Times are formatted on the server, in one configured zone. Formatting in the
 * browser would mismatch on hydration and let two operators read two times.
 */
export function When({ value, mode = 'smart' }: { value: string | Date | null | undefined; mode?: 'smart' | 'full' | 'date' }) {
  if (!value) return <span className="muted">—</span>
  const date = value instanceof Date ? value : new Date(value)
  const timeZone = env().DISPLAY_TIME_ZONE
  const now = new Date()
  const sameDay = fmt(date, timeZone, { dateStyle: 'short' }) === fmt(now, timeZone, { dateStyle: 'short' })

  let text: string
  if (mode === 'date') text = fmt(date, timeZone, { day: 'numeric', month: 'short', year: 'numeric' })
  else if (mode === 'full') text = fmt(date, timeZone, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  else if (sameDay) text = fmt(date, timeZone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  else if (now.getTime() - date.getTime() < 6 * 86_400_000 && date < now) text = fmt(date, timeZone, { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  else text = fmt(date, timeZone, { day: 'numeric', month: 'short' })

  return (
    <time className="nowrap tnum" dateTime={date.toISOString()} title={fmt(date, timeZone, { dateStyle: 'full', timeStyle: 'short' })}>
      {text}
    </time>
  )
}

function fmt(date: Date, timeZone: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone }).format(date)
}

export function Mark({ size = 22 }: { size?: number }) {
  // A path that forks: one way to the folder, one to the reply.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <rect x="1" y="1" width="22" height="22" rx="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6 18c0-5 3-6.5 6-6.5S18 10 18 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 11.5V18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="18" cy="6" r="1.6" fill="currentColor" />
    </svg>
  )
}
