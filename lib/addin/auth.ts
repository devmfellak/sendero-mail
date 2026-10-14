import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import { env, graphConfigured } from '../env'

/**
 * Authenticating the Outlook add-in.
 *
 * The task pane obtains an Entra ID access token for this app through nested
 * app authentication (MSAL in the pane, brokered by Outlook) and sends it as a
 * bearer token. Here it is verified properly: signature against Microsoft's
 * published keys, expiry, audience = this app, and — when the deployment is
 * pinned to one tenant — the tenant. A token for some other app, or from some
 * other organisation, is refused.
 *
 * Without a tenant configured the deployment is a demo and the pane runs
 * unauthenticated against the offline engine and sample data only.
 */

const JWKS = createRemoteJWKSet(new URL('https://login.microsoftonline.com/common/discovery/v2.0/keys'))
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type AddinCaller = { mode: 'demo' } | { mode: 'user'; name: string; email: string; tenantId: string }

export class AddinAuthError extends Error {}

export async function authenticateAddin(request: Request): Promise<AddinCaller> {
  if (!graphConfigured()) return { mode: 'demo' }

  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) throw new AddinAuthError('Sign-in required')

  const e = env()
  const clientId = e.MS_CLIENT_ID!
  const audiences = [clientId, `api://${new URL(e.APP_ORIGIN).host}/${clientId}`]

  let payload: JWTPayload
  try {
    ;({ payload } = await jwtVerify(token, JWKS, { audience: audiences, clockTolerance: 60 }))
  } catch {
    throw new AddinAuthError('Invalid or expired token')
  }

  const tid = String(payload.tid ?? '')
  const iss = String(payload.iss ?? '')
  if (!tid || !(iss === `https://login.microsoftonline.com/${tid}/v2.0` || iss === `https://sts.windows.net/${tid}/`)) {
    throw new AddinAuthError('Unexpected token issuer')
  }
  if (GUID.test(e.MS_TENANT_ID) && tid.toLowerCase() !== e.MS_TENANT_ID.toLowerCase()) {
    throw new AddinAuthError('This add-in is not available to your organisation')
  }

  return {
    mode: 'user',
    tenantId: tid,
    name: String(payload.name ?? ''),
    email: String(payload.preferred_username ?? payload.upn ?? ''),
  }
}
