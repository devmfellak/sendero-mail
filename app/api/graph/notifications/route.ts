import { parseNotifications } from '@/lib/graph/notifications'
import { handleNotification, subscriptionLookup } from '@/lib/graph/sync'
import { store } from '@/lib/runtime'

export const dynamic = 'force-dynamic'

/**
 * Microsoft Graph change notifications.
 *
 * Validation handshake: echo `validationToken` as text/plain, 200, within 10 s.
 * Notifications: verify each one's clientState, answer 202 immediately, and
 * process in the background — Graph penalises slow endpoints, and the queue
 * de-duplicates whatever it redelivers.
 */
export async function POST(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get('validationToken')
  if (token !== null) {
    return new Response(token, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }

  const body = await request.json().catch(() => null)
  const { accepted, rejected } = parseNotifications(body, subscriptionLookup)

  if (rejected > 0) {
    void store().log({ accountId: null, kind: 'error', actor: 'system', detail: `Rejected ${rejected} change notification(s) with an unknown subscription or wrong clientState` })
  }
  for (const n of accepted) {
    void handleNotification(n).catch((err) =>
      store().log({ accountId: n.accountId, kind: 'error', actor: 'system', detail: `Notification handling failed: ${String(err).slice(0, 200)}` }),
    )
  }

  return new Response(null, { status: 202 })
}
