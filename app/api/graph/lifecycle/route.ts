export const dynamic = 'force-dynamic'

/**
 * Lifecycle notifications (reauthorizationRequired, subscriptionRemoved,
 * missed) arrive in the same shape and with the same clientState as change
 * notifications, so they share one handler. A separate URL keeps them
 * distinguishable in access logs.
 */
export { POST } from '../notifications/route'
