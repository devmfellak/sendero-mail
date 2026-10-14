import { chainFor } from '@/lib/ai/router'
import { worker } from '@/lib/agent/worker'
import { graphConfigured } from '@/lib/env'
import { store } from '@/lib/runtime'

export const dynamic = 'force-dynamic'

/** For uptime checks and load balancers. No mail content, no addresses. */
export function GET(): Response {
  const d = store().read
  return Response.json({
    ok: true,
    accounts: d.accounts.length,
    accountsNeedingAttention: d.accounts.filter((a) => a.status === 'needs-consent' || a.status === 'error').length,
    queue: worker().queue.size,
    unprocessed: d.messages.filter((m) => m.direction === 'inbound' && !d.analyses[m.id]).length,
    graph: graphConfigured(),
    triage: chainFor('triage').map((p) => p.id),
  })
}
