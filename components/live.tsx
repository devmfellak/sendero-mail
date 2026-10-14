'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/**
 * Live updates over server-sent events.
 *
 * Events are hints, not data: on each one the current page is re-rendered on
 * the server (`router.refresh`), so what the browser shows is always what the
 * store says, never a client-side patch that can drift from it. Refreshes are
 * coalesced — a burst of twenty pipeline events costs one re-render.
 *
 * Serverless hosts end long-lived responses and bill for every open one, so
 * there (`stream={false}`) the page refreshes on a timer instead. Elsewhere
 * the timer is the fallback while the stream reconnects, and a short gap is
 * not worth alarming anyone about.
 */
const POLL_MS = 30_000
const GRACE_MS = 20_000

export function LiveStatus({ mailboxes, stream = true }: { mailboxes: number; stream?: boolean }) {
  const router = useRouter()
  const [connected, setConnected] = useState(true)
  const [last, setLast] = useState<string>('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let source: EventSource | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let grace: ReturnType<typeof setTimeout> | null = null

    const refresh = () => {
      // Do not yank a form out from under someone mid-edit.
      const active = document.activeElement
      if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) return
      router.refresh()
    }

    const connect = () => {
      source = new EventSource('/api/events')
      source.onopen = () => {
        if (grace) clearTimeout(grace)
        grace = null
        setConnected(true)
      }
      source.onerror = () => {
        source?.close()
        grace ??= setTimeout(() => setConnected(false), GRACE_MS)
        retry = setTimeout(connect, 5_000)
      }
      source.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as { type: string; detail?: string }
          if (event.type === 'activity' && event.detail) setLast(event.detail)
        } catch {
          return
        }
        if (timer.current) return
        timer.current = setTimeout(() => {
          timer.current = null
          refresh()
        }, 700)
      }
    }

    if (stream) connect()
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, POLL_MS)
    return () => {
      source?.close()
      clearInterval(poll)
      if (retry) clearTimeout(retry)
      if (grace) clearTimeout(grace)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [router, stream])

  return (
    <span className={`live${connected ? '' : ' off'}`} role="status" aria-live="polite">
      <span className="beacon" aria-hidden />
      <span className="ellipsis" style={{ maxWidth: 520 }}>
        {connected ? last || `Live · watching ${mailboxes} mailboxes` : 'Syncing every 30 seconds'}
      </span>
    </span>
  )
}
