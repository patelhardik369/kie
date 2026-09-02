import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // libsql ships a native binary — it must stay external to the bundle.
  serverExternalPackages: ['@libsql/client', 'libsql'],

  // Next would otherwise generate a root CLAUDE.md/AGENTS.md describing Next
  // itself. This project's instructions live in .claude/CLAUDE.md; a competing
  // root file would dilute them.
  agentRules: false,
}

export default nextConfig
