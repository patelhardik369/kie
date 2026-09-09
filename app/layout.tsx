import type { Metadata, Viewport } from 'next'
import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'

import { StudioBoot } from '@/components/setup/StudioBoot.tsx'
import { TopNav } from '@/components/shell/TopNav.tsx'
import { AccentScript } from '@/components/theme/AccentScript.tsx'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Kie Studio',
    template: '%s — Kie Studio',
  },
  description:
    'Self-hosted generation studio on the Kie AI API — Kling, ByteDance and Wan, every parameter exposed.',
}

/**
 * A fixed value on purpose: the browser chrome tint is read from the served
 * HTML, before the accent script has run, so it cannot follow the user's pick.
 * The canvas it matches is a fixed near-black under every accent.
 */
export const viewport: Viewport = {
  themeColor: '#09090b',
  colorScheme: 'dark',
}

/**
 * Geist, shipped as an npm package rather than fetched from Google Fonts: the
 * files sit in node_modules, so a build never needs the network and there is no
 * third-party request at runtime. Sans and Mono are one family — the slug in a
 * mono cell and the label beside it share a skeleton, which is why a table of
 * model ids reads as typeset rather than as two fonts colliding.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Paints the saved accent onto <html> before the body renders. */}
        <AccentScript />
      </head>
      <body className="min-h-screen">
        {/*
          Mints this browser's workspace id and attaches it, with the Kie key, to
          every /api request. Renders nothing. It sits above TopNav because the
          nav's pinned-models popover fetches, and that fetch must already carry
          the headers by the time it runs.
        */}
        <StudioBoot />
        <TopNav />
        {children}
      </body>
    </html>
  )
}
