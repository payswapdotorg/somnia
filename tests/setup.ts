// tests/setup.ts — Vitest global setup (runs before every test file).
//
// T10: the suite runs against durable PostgreSQL (a dedicated throwaway
// Neon project — DATABASE_URL_TEST in .env, never the production URL).
// Per test file: point DATABASE_URL at the test database, push the schema
// (fast no-op when in sync), then TRUNCATE every table — the Postgres
// equivalent of the old "delete the throwaway SQLite file" reset.
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')

/** Minimal .env loader (vitest does not load it): real env always wins. */
function loadDotEnv(): void {
  try {
    const raw = readFileSync(path.join(ROOT, '.env'), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      let value = m[2]
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (!(m[1] in process.env)) process.env[m[1]] = value
    }
  } catch {
    // no .env — rely on the real environment
  }
}

loadDotEnv()

const TEST_URL = process.env.DATABASE_URL_TEST
if (!TEST_URL || !/^postgres(ql)?:\/\//.test(TEST_URL)) {
  throw new Error(
    'tests need DATABASE_URL_TEST (postgresql://…) — set it in .env, pointing at the throwaway somnia-test project'
  )
}
// every module imported by the test files (src/lib/db.ts included) must see
// the TEST url, and so must the prisma CLI spawned below (env is inherited;
// an inherited var also beats the .env file the CLI auto-loads)
process.env.DATABASE_URL = TEST_URL
process.env.SOMNIA_TEST = '1'

execSync('bunx prisma db push --skip-generate --accept-data-loss', {
  cwd: ROOT,
  stdio: 'pipe',
})

// reset every table between files (order-free with CASCADE)
const TABLES = [
  'User',
  'Session',
  'Job',
  'Keyframe',
  'Generation',
  'Asset',
  'CreditTransaction',
  'Board',
  'Like',
  'ApiKey',
  'AgentRun',
  'TierGateway',
]
const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient({ log: ['error'] })
try {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`
  )
} finally {
  await prisma.$disconnect()
}
