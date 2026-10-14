import { NextResponse, type NextRequest } from 'next/server'

/**
 * HTTP Basic in front of the console, when DASHBOARD_USER and
 * DASHBOARD_PASSWORD are set. A stop-gap that is honest about being one: the
 * production answer is Entra ID single sign-on restricted to an operators
 * group, which ADR 0003 describes.
 *
 * Excluded: Graph's webhooks (Graph cannot send credentials; they are
 * authenticated by clientState), the OAuth callback, the add-in pane and its
 * API (authenticated by Entra tokens), static assets and the health check.
 */
export function middleware(request: NextRequest): NextResponse {
  const user = process.env.DASHBOARD_USER
  const password = process.env.DASHBOARD_PASSWORD
  if (!user || !password) return NextResponse.next()

  const header = request.headers.get('authorization') ?? ''
  if (header.startsWith('Basic ')) {
    const [u, ...rest] = atob(header.slice(6)).split(':')
    if (constantTimeEqual(u ?? '', user) && constantTimeEqual(rest.join(':'), password)) return NextResponse.next()
  }
  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Sendero", charset="UTF-8"' },
  })
}

function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

export const config = {
  matcher: ['/((?!api/graph|api/auth/microsoft/callback|api/addin|api/health|addin/taskpane|addin/manifest.xml|addin/icon|_next|icon.svg).*)'],
}
