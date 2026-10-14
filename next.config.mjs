/** @type {import('next').NextConfig} */

// The console must never be framed. The add-in task pane must be — by Outlook
// on the web — so it gets its own frame-ancestors and may load office.js from
// Microsoft's CDN. Everything else is same-origin.
const OUTLOOK_FRAMES = [
  'https://outlook.office.com',
  'https://outlook.office365.com',
  'https://outlook.cloud.microsoft',
  'https://outlook.live.com',
  'https://*.officeapps.live.com',
  'https://*.office.com',
].join(' ')

const base = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
]

const consoleCsp = [...base, "script-src 'self' 'unsafe-inline'", "frame-ancestors 'none'"].join('; ')
const addinCsp = [
  ...base,
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://appsforoffice.microsoft.com",
  `frame-ancestors 'self' ${OUTLOOK_FRAMES}`,
  'frame-src https://appsforoffice.microsoft.com https://*.officeapps.live.com https://login.microsoftonline.com',
].join('; ')

const common = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
]

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        source: '/((?!addin/taskpane).*)',
        headers: [...common, { key: 'Content-Security-Policy', value: consoleCsp }, { key: 'X-Frame-Options', value: 'DENY' }],
      },
      { source: '/addin/taskpane', headers: [...common, { key: 'Content-Security-Policy', value: addinCsp }] },
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ]
  },
}

export default nextConfig
