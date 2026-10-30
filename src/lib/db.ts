import { PrismaClient } from '@prisma/client'

/**
 * Somnia database client — durable PostgreSQL on Neon (T10).
 *
 * DATABASE_URL must be a postgresql:// connection string: .env carries it
 * locally, the platform env carries it in production (pooled endpoint —
 * pgbouncer-friendly for serverless). The old Phase 6 SQLite seed bootstrap
 * is gone with the provider switch; a missing DATABASE_URL now surfaces as
 * a Prisma construction error with a precise message instead of silently
 * spawning an ephemeral scratch database.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error', 'warn'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
