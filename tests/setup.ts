// tests/setup.ts — Vitest global setup (runs before every test file)
// Points Prisma at an isolated throwaway SQLite database per run so tests
// never touch the dev database, and seeds the schema via `prisma db push`.
import { execSync } from 'node:child_process'
import { rmSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
export const TEST_DB = path.join(ROOT, 'db', 'test.db')

rmSync(TEST_DB, { force: true })
rmSync(`${TEST_DB}-journal`, { force: true })
mkdirSync(path.dirname(TEST_DB), { recursive: true })
process.env.DATABASE_URL = `file:${TEST_DB}`
process.env.SOMNIA_TEST = '1'

execSync('bunx prisma db push --skip-generate --accept-data-loss', {
  cwd: ROOT,
  stdio: 'pipe',
})
