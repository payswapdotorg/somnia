// tests/db.test.ts — durable-storage migration guards (T10).
//
// The suite runs against real PostgreSQL (a dedicated throwaway Neon
// project): these specs pin that intent so a silent fall-back to SQLite
// can never ship again — the URL must be postgres, the wire must answer,
// and a full Prisma write/read roundtrip must work through the exact
// client the app uses.
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db'

describe('durable Postgres storage (Neon)', () => {
  it('the test database is a postgres URL, never a sqlite file', () => {
    expect(process.env.DATABASE_URL).toMatch(/^postgres(ql)?:\/\//)
    expect(process.env.DATABASE_URL).not.toMatch(/^file:/)
  })

  it('the wire answers: SELECT 1 against the live database', async () => {
    const rows = (await db.$queryRawUnsafe('SELECT 1 AS ok')) as Array<{ ok: number }>
    expect(rows[0].ok).toBe(1)
  })

  it('a Prisma write/read roundtrip lands and reads back intact', async () => {
    const email = `guard-${Date.now()}@somnia.test`
    const created = await db.user.create({
      data: { email, name: 'Guard', credits: 123 },
    })
    const read = await db.user.findUniqueOrThrow({ where: { id: created.id } })
    expect(read.email).toBe(email)
    expect(read.credits).toBe(123)
    expect(read.createdAt instanceof Date).toBe(true)
    await db.user.delete({ where: { id: created.id } })
    expect(await db.user.findUnique({ where: { id: created.id } })).toBeNull()
  })
})
