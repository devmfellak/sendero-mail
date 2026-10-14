'use client'

import { useActionState } from 'react'
import { saveSettingsAction } from '@/app/actions'
import type { Account } from '@/lib/types'

export function SettingsForm({ account }: { account: Account }) {
  const [state, action, pending] = useActionState(saveSettingsAction, null)
  const s = account.settings

  return (
    <form action={action} className="stack">
      <input type="hidden" name="accountId" value={account.id} />

      <section className="card">
        <header className="card-head">
          <h2>Automation</h2>
        </header>
        <div className="card-body form-grid">
          <fieldset className="full" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label" style={{ marginBottom: 6 }}>
              Mode
            </legend>
            <div className="grid grid-3" style={{ gap: 8 }}>
              {(
                [
                  ['observe', 'Observe', 'Classify and log only. The mailbox is not touched.'],
                  ['assist', 'Assist', 'File, flag, categorise. Replies wait in Drafts for a person.'],
                  ['auto', 'Autopilot', 'As Assist, and rules may send replies that pass every guardrail.'],
                ] as const
              ).map(([value, label, help]) => (
                <label key={value} className="card" style={{ padding: 10, cursor: 'pointer', boxShadow: 'none' }}>
                  <span className="check">
                    <input type="radio" name="mode" value={value} defaultChecked={s.mode === value} />
                    <span className="strong">{label}</span>
                  </span>
                  <span className="hint" style={{ display: 'block', marginTop: 4 }}>
                    {help}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="field">
            <span>Minimum confidence to auto-send</span>
            <input className="input" name="autoReplyMinConfidence" type="number" step="0.01" min="0.5" max="1" defaultValue={s.autoReplyMinConfidence} />
          </label>
          <label className="field">
            <span>Automatic replies per hour, at most</span>
            <input className="input" name="maxAutoRepliesPerHour" type="number" min="0" max="500" defaultValue={s.maxAutoRepliesPerHour} />
          </label>
          <label className="field">
            <span>Quiet hours start (0–23, blank for none)</span>
            <input className="input" name="quietStart" type="number" min="0" max="23" defaultValue={s.quietHours?.start ?? ''} />
          </label>
          <label className="field">
            <span>Quiet hours end</span>
            <input className="input" name="quietEnd" type="number" min="0" max="23" defaultValue={s.quietHours?.end ?? ''} />
          </label>
          <label className="field">
            <span>Time zone (IANA)</span>
            <input className="input" name="timeZone" defaultValue={s.timeZone} />
          </label>
          <label className="field">
            <span>Follow up after (business days)</span>
            <input className="input" name="followUpDays" type="number" min="1" max="30" defaultValue={s.followUpDays} />
          </label>
          <label className="check full">
            <input type="checkbox" name="paused" defaultChecked={account.status === 'paused'} /> Pause this mailbox (mail is not processed until resumed)
          </label>
        </div>
      </section>

      <section className="card">
        <header className="card-head">
          <h2>Language and voice</h2>
        </header>
        <div className="card-body form-grid">
          <label className="field">
            <span>Default language</span>
            <select className="select" name="defaultLanguage" defaultValue={s.defaultLanguage}>
              <option value="es">Spanish</option>
              <option value="en">English</option>
            </select>
            <span className="hint">Used when a message is too short to tell. Otherwise replies follow the sender’s language.</span>
          </label>
          <label className="field">
            <span>Tone</span>
            <select className="select" name="tone" defaultValue={s.tone}>
              <option value="warm">Warm</option>
              <option value="neutral">Neutral</option>
              <option value="formal">Formal</option>
            </select>
          </label>
          <label className="field">
            <span>Signature — English</span>
            <textarea className="textarea" name="signatureEn" rows={3} style={{ minHeight: 80 }} defaultValue={s.signature.en} />
          </label>
          <label className="field">
            <span>Signature — Spanish</span>
            <textarea className="textarea" name="signatureEs" rows={3} style={{ minHeight: 80 }} defaultValue={s.signature.es} />
          </label>
          <label className="field full">
            <span>Knowledge the agent may use</span>
            <textarea className="textarea" name="knowledge" rows={7} defaultValue={s.knowledge} />
            <span className="hint">
              Facts, not instructions: hours, policies, links, phone numbers. A reply that mentions a link, number or amount found neither here nor in the thread is never sent automatically.
            </span>
          </label>
        </div>
      </section>

      <section className="card">
        <header className="card-head">
          <h2>People</h2>
        </header>
        <div className="card-body form-grid">
          <label className="field">
            <span>VIP senders</span>
            <textarea className="textarea mono" name="vipSenders" rows={4} style={{ minHeight: 90 }} defaultValue={s.vipSenders.join('\n')} />
            <span className="hint">One per line. An address, or @domain for a whole organisation.</span>
          </label>
          <label className="field">
            <span>Internal domains</span>
            <textarea className="textarea mono" name="internalDomains" rows={4} style={{ minHeight: 90 }} defaultValue={s.internalDomains.join('\n')} />
            <span className="hint">Mail from these is classified as internal.</span>
          </label>
        </div>
      </section>

      {state?.error && (
        <div className="alert error" role="alert">
          {state.error}
        </div>
      )}
      {state?.ok && <div className="alert success">Saved.</div>}
      <div>
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  )
}
