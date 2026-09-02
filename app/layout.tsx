import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Kie Studio',
  description:
    'Self-hosted generation studio on the Kie AI API — Kling, ByteDance and Wan, every parameter exposed.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}
