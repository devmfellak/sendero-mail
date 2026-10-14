import { NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { exchangeCode, readIdToken } from '@/lib/graph/oauth'
import { connectAccount } from '@/lib/graph/sync'
import { store } from '@/lib/runtime'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const back = (q: string) => NextResponse.redirect(new URL(`/accounts?${q}`, env().APP_ORIGIN))

  const error = url.searchParams.get('error_description') ?? url.searchParams.get('error')
  if (error) return back(`error=${encodeURIComponent(error.split('\n')[0]!.slice(0, 300))}`)

  const state = url.searchParams.get('state') ?? ''
  const code = url.searchParams.get('code') ?? ''
  const pending = store().read.oauth[state]
  // One use only, whatever happens next.
  await store().mutate((d) => {
    delete d.oauth[state]
  })
  if (!pending || !code) return back('error=The%20sign-in%20link%20expired%20or%20was%20already%20used.%20Please%20try%20again.')

  try {
    const tokens = await exchangeCode(code, pending.verifier)
    const identity = readIdToken(tokens.id_token)
    if (!identity?.email) return back('error=Microsoft%20did%20not%20return%20an%20email%20address%20for%20this%20account.')
    const account = await connectAccount(tokens, identity)
    return back(`connected=${encodeURIComponent(account.address)}`)
  } catch (err) {
    return back(`error=${encodeURIComponent(String(err instanceof Error ? err.message : err).slice(0, 300))}`)
  }
}
