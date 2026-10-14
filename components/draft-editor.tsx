'use client'

import { useState, useTransition } from 'react'
import { approveDraftAction, discardDraftAction, requestDraftAction } from '@/app/actions'

/**
 * Review a draft: edit, approve and send, discard, or regenerate in the other
 * language. Approval is a single explicit action; there is no keyboard
 * shortcut that sends mail.
 */
export function DraftEditor({
  draftId,
  messageId,
  body,
  language,
  compact = false,
}: {
  draftId: string
  messageId: string
  body: string
  language: 'en' | 'es'
  compact?: boolean
}) {
  const [text, setText] = useState(body)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const dirty = text.trim() !== body.trim()

  const approve = () =>
    start(async () => {
      setError(null)
      const fd = new FormData()
      fd.set('draftId', draftId)
      fd.set('body', text)
      const res = await approveDraftAction(fd)
      if (res.error) setError(res.error)
    })

  const discard = () =>
    start(async () => {
      const fd = new FormData()
      fd.set('draftId', draftId)
      await discardDraftAction(fd)
    })

  const regenerate = (lang: 'en' | 'es') =>
    start(async () => {
      setError(null)
      const fd = new FormData()
      fd.set('messageId', messageId)
      fd.set('language', lang)
      const res = await requestDraftAction(fd)
      if (res.error) setError(res.error)
    })

  return (
    <div className="stack-sm">
      <label className="visually-hidden" htmlFor={`draft-${draftId}`}>
        Reply text
      </label>
      <textarea
        id={`draft-${draftId}`}
        className="textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={compact ? 9 : 12}
        disabled={pending}
      />
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <div className="row">
        <button className="btn primary" type="button" onClick={approve} disabled={pending || text.trim().length < 2}>
          {pending ? 'Working…' : dirty ? 'Send edited reply' : 'Approve & send'}
        </button>
        <button className="btn ghost" type="button" onClick={() => regenerate(language === 'es' ? 'en' : 'es')} disabled={pending} title="Write it again in the other language">
          Rewrite in {language === 'es' ? 'English' : 'Spanish'}
        </button>
        <span className="spacer" />
        <button className="btn ghost danger" type="button" onClick={discard} disabled={pending}>
          Discard
        </button>
      </div>
      {!compact && <p className="hint">The same draft is in the mailbox’s Outlook Drafts folder — it can also be finished and sent from Outlook desktop, web or mobile.</p>}
    </div>
  )
}

export function RequestDraft({ messageId, defaultLanguage }: { messageId: string; defaultLanguage: 'en' | 'es' }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  return (
    <form
      className="stack-sm"
      action={(fd) =>
        start(async () => {
          setError(null)
          const res = await requestDraftAction(fd)
          if (res.error) setError(res.error)
        })
      }
    >
      <input type="hidden" name="messageId" value={messageId} />
      <div className="row">
        <label className="field" style={{ flex: '0 0 140px' }}>
          <span>Language</span>
          <select className="select" name="language" defaultValue={defaultLanguage}>
            <option value="es">Spanish</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="field" style={{ flex: 1, minWidth: 180 }}>
          <span>Guidance (optional)</span>
          <input className="input" name="instructions" placeholder="e.g. decline politely, offer next week" />
        </label>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div>
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? 'Drafting…' : 'Draft a reply'}
        </button>
      </div>
    </form>
  )
}
