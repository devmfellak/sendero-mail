import { injectNext } from '@/lib/demo/simulator'
import { store } from '@/lib/runtime'

export const dynamic = 'force-dynamic'

/**
 * Deliver the next simulated email (demo mailboxes only). The console's
 * "Simulate new email" button does the same through a Server Action; this
 * exists for scripted demos and smoke tests: `curl -X POST …/api/simulate`.
 */
export async function POST(request: Request): Promise<Response> {
  if (!store().read.accounts.some((a) => a.provider === 'demo')) {
    return Response.json({ error: 'No demo mailboxes on this deployment' }, { status: 404 })
  }
  const account = new URL(request.url).searchParams.get('account')
  const key = account === 'elena' || account === 'support' || account === 'sales' ? account : undefined
  const messageId = await injectNext(key)
  return Response.json({ messageId }, { status: 202 })
}
