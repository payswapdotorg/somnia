/**
 * Regenerates prisma/seed.db — the committed, schema-only SQLite database
 * that serverless cold starts copy into the writable scratch dir (see
 * src/lib/db.ts). Contains tables and zero rows: the demo user + opening
 * credit grant are created lazily by the app on the first API hit, exactly
 * like a fresh local install.
 *
 * Run after any prisma/schema.prisma change:
 *   bun run scripts/make-seed-db.ts
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const seedPath = path.join(process.cwd(), 'prisma', 'seed.db')

if (fs.existsSync(seedPath)) fs.rmSync(seedPath)

execSync(`DATABASE_URL="file:${seedPath}" bunx prisma db push --skip-generate --accept-data-loss`, {
  stdio: 'inherit',
})

// Sanity: file exists, is a valid SQLite db, and has no rows in the User table.
const size = fs.statSync(seedPath).size
const header = fs.readFileSync(seedPath).subarray(0, 16).toString('utf8')
if (header !== 'SQLite format 3\u0000') {
  throw new Error('seed.db is not a valid SQLite database')
}
console.log(`[seed] wrote prisma/seed.db (${(size / 1024).toFixed(1)} KiB, schema only)`)
