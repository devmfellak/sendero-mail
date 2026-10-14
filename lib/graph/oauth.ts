import { env } from '../env'

/**
 * Microsoft identity platform, authorization-code flow with PKCE.
 *
 * Delegated permissions, one consent per mailbox owner: the agent can do in a
 * mailbox exactly what its owner agreed to, and an administrator can revoke it
 * per user in Entra without touching the rest. For an organisation that wants
 * to enrol many mailboxes centrally, ADR 0003 describes the application
 * permission alternative scoped with Exchange RBAC for Applications.
 *
 * Plain HTTPS rather than MSAL: two endpoints, both stable for years, and the
 * one thing MSAL would add — its token cache — is replaced by the encrypted
 * refresh token in the store and the in-memory access-token cache below.
 */

export const SCOPES = ['offline_access', 'openid', 'profile', 'User.Read', 'Mail.ReadWrite', 'Mail.Send', 'MailboxSettings.Read']

export interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  id_token?: string
  scope: string
}

function authority(): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(env().MS_TENANT_ID)}/oauth2/v2.0`
}

export function redirectUri(): string {
  return `${env().APP_ORIGIN}/api/auth/microsoft/callback`
}

export function authorizeUrl(state: string, challenge: string, loginHint?: string): string {
  const params = new URLSearchParams({
    client_id: env().MS_CLIENT_ID ?? '',
    response_type: 'code',
    redirect_uri: redirectUri(),
    response_mode: 'query',
    scope: SCOPES.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  })
  if (loginHint) params.set('login_hint', loginHint)
  return `${authority()}/authorize?${params}`
}

export async function exchangeCode(code: string, verifier: string): Promise<TokenResponse> {
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  })
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken, scope: SCOPES.join(' ') })
}

export class ConsentRequiredError extends Error {}

async function tokenRequest(fields: Record<string, string>): Promise<TokenResponse> {
  const e = env()
  const response = await fetch(`${authority()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: e.MS_CLIENT_ID ?? '', client_secret: e.MS_CLIENT_SECRET ?? '', ...fields }),
    signal: AbortSignal.timeout(20_000),
  })
  const json = (await response.json().catch(() => ({}))) as Partial<TokenResponse> & {
    error?: string
    error_description?: string
  }
  if (!response.ok || !json.access_token) {
    // invalid_grant: the refresh token was revoked, expired, or the user's
    // password / MFA changed. Only the user can fix that, by consenting again.
    if (json.error === 'invalid_grant' || json.error === 'interaction_required') {
      throw new ConsentRequiredError(json.error_description?.split('\r\n')[0] ?? json.error)
    }
    throw new Error(`Token endpoint: ${json.error ?? response.status} ${json.error_description?.split('\r\n')[0] ?? ''}`.trim())
  }
  return json as TokenResponse
}

/** The claims we need from the id_token. Signature is not checked: it came straight from the token endpoint over TLS. */
export function readIdToken(idToken: string | undefined): { name: string; email: string; oid: string } | null {
  if (!idToken) return null
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, string>
    return {
      name: payload.name ?? '',
      email: payload.preferred_username ?? payload.email ?? '',
      oid: payload.oid ?? '',
    }
  } catch {
    return null
  }
}
