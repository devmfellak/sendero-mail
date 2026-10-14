import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

// Self-hosted at build time: no request to Google from the browser, so the CSP stays 'self'.
const inter = Inter({ subsets: ['latin', 'latin-ext'], variable: '--font-inter', display: 'swap' })

export const metadata: Metadata = {
  title: { default: 'Sendero — AI email agent for Outlook', template: '%s · Sendero' },
  description:
    'Triage, file, draft and follow up across many Outlook mailboxes, in English and Spanish, with a person in the loop wherever it matters.',
  applicationName: 'Sendero',
  // A console over other people's mail has no business in a search index.
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f6' },
    { media: '(prefers-color-scheme: dark)', color: '#0d100e' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  )
}
