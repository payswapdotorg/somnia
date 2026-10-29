import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'

/**
 * Phase 6: on serverless the repo bundle is read-only, so SQLite cannot live
 * beside the code. DATABASE_URL is pointed at the writable /tmp scratch area
 * by the platform's environment settings; on cold start the committed seed
 * schema (prisma/seed.db — schema only, no rows: the demo user and opening
 * grant are created lazily by the app on first API hit) is copied into place.
 * Demo-mode storage is per-instance and ephemeral by design; wire a durable
 * database (Turso/Neon/Postgres) through DATABASE_URL for production — no
 * code change needed, this bootstrap simply no-ops.
 */
if (process.env.VERCEL) {
  const match = /^file:(.+)$/.exec(process.env.DATABASE_URL ?? '')
  if (match) {
    const dbFile = match[1]
    try {
      fs.accessSync(dbFile)
    } catch {
      try {
        fs.mkdirSync(path.dirname(dbFile), { recursive: true })
        fs.copyFileSync(path.join(process.cwd(), 'prisma', 'seed.db'), dbFile)
        console.log('[db] bootstrapped', dbFile, 'from committed seed schema')
      } catch (seedError) {
        // Fail soft: never break module load (build-time page-data collection
        // imports this module). Queries will surface a precise error instead.
        console.warn(
          '[db] seed bootstrap failed (continuing):',
          (seedError as Error)?.message ?? seedError
        )
      }
    }
  }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error', 'warn'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
