import fs from 'node:fs'

/**
 * Post-build assembly for the standalone output (self-hosting target).
 *
 * Local/sandbox: `output: 'standalone'` produces .next/standalone — copy the
 * static assets and public dir into it so `bun run start` serves everything.
 * Vercel: the platform builder skips standalone output entirely — detect and
 * no-op (the platform assembles its own deployment bundle). Exit 0 either
 * way so the build result reflects `next build` alone.
 */
if (fs.existsSync('.next/standalone')) {
  fs.cpSync('.next/static', '.next/standalone/.next/static', { recursive: true })
  fs.cpSync('public', '.next/standalone/public', { recursive: true })
  console.log('[post-build] standalone bundle assembled (.next/static + public)')
} else {
  console.log('[post-build] no standalone output — skipping assembly (platform build)')
}
