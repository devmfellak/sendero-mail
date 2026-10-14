import { NextResponse } from 'next/server'
import { graphConfigured } from '@/lib/env'
import { pkcePair, randomToken } from '@/lib/graph/crypto'
import { authorizeUrl } from '@/lib/graph/oauth'
import { store } from '@/lib/runtime'

export const dynamic = 'force-dynamic'

/** Begin connecting a mailbox: authorization-code flow with PKCE and a one-time state. */
export async function GET(request: Request): Promise<Response> {
  if (!graphConfigured()) {
    return NextResponse.redirect(new URL('/accounts?error=Microsoft%20Graph%20is%20not%20configured%20on%20this%20deployment', request.url))
  }
  const state = randomToken()
  const { verifier, challenge } = pkcePair()
  await store().mutate((d) => {
    d.oauth[state] = { verifier, createdAt: new Date().toISOString() }
  })
  const hint = new URL(request.url).searchParams.get('login_hint') ?? undefined
  return NextResponse.redirect(authorizeUrl(state, challenge, hint))
}
