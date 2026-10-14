import { safeEqual } from './crypto'

/**
 * Graph change notifications, the pure part.
 *
 * Three rules from the Graph contract, each of which fails silently if missed:
 *
 * 1. Subscription creation is confirmed by echoing `validationToken` as
 *    text/plain within 10 seconds. Anything else and the subscription is never
 *    created.
 * 2. Every notification carries the `clientState` secret we chose when
 *    subscribing. It is the only proof the POST came from Graph and is about
 *    our subscription, so a mismatch is dropped — compared in constant time.
 * 3. The endpoint must answer 202 quickly (Graph retries, then throttles and
 *    eventually drops slow endpoints). So notifications are acknowledged
 *    first and processed from a queue.
 */

export interface GraphNotification {
  subscriptionId: string
  clientState?: string
  changeType: string
  resource: string
  resourceData?: { id?: string; '@odata.type'?: string }
  lifecycleEvent?: 'reauthorizationRequired' | 'subscriptionRemoved' | 'missed'
  tenantId?: string
}

export interface AcceptedNotification {
  subscriptionId: string
  accountId: string
  messageId: string | null
  changeType: string
  lifecycleEvent?: GraphNotification['lifecycleEvent']
}

export function parseNotifications(
  body: unknown,
  lookup: (subscriptionId: string) => { accountId: string; clientState: string } | undefined,
): { accepted: AcceptedNotification[]; rejected: number } {
  const value = (body as { value?: unknown })?.value
  if (!Array.isArray(value)) return { accepted: [], rejected: 0 }

  const accepted: AcceptedNotification[] = []
  let rejected = 0

  for (const raw of value as GraphNotification[]) {
    const sub = raw && typeof raw.subscriptionId === 'string' ? lookup(raw.subscriptionId) : undefined
    if (!sub || typeof raw.clientState !== 'string' || !safeEqual(raw.clientState, sub.clientState)) {
      rejected++
      continue
    }
    accepted.push({
      subscriptionId: raw.subscriptionId,
      accountId: sub.accountId,
      messageId: raw.resourceData?.id ?? messageIdFromResource(raw.resource),
      changeType: raw.changeType,
      lifecycleEvent: raw.lifecycleEvent,
    })
  }

  return { accepted, rejected }
}

/** `Users/{id}/Messages/{messageId}` → messageId. */
export function messageIdFromResource(resource: string | undefined): string | null {
  if (!resource) return null
  const match = /messages\/([^/?]+)/i.exec(resource)
  return match ? decodeURIComponent(match[1]!.replace(/^'|'$/g, '')) : null
}
