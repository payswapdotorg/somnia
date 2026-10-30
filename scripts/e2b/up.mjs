// up.mjs — Somnia T16 tier control.
//   node up.mjs          boot a fresh gateway sandbox, self-test, register it
//   node up.mjs --kill   pause the tier: kill the registered sandbox + clear the row
// Credentials: rotate.env next to this file (chmod 600, never commit).
import { Sandbox } from 'e2b'
import { Client } from 'pg'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_ORIGIN = 'https://somnia-bay.vercel.app'
const env = Object.fromEntries(
  readFileSync(join(HERE, 'rotate.env'), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const { E2B_API_KEY, NEON_DATABASE_URL, TIER_OPS_KEY } = env

async function withDb(fn) {
  const c = new Client({ connectionString: NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try { return await fn(c) } finally { await c.end() }
}

if (process.argv[2] === '--kill') {
  const row = await withDb((c) =>
    c.query('SELECT "sandboxId" FROM "TierGateway" WHERE id = $1', ['singleton']).then((r) => r.rows[0])
  )
  if (row?.sandboxId) {
    try {
      const sbx = await Sandbox.connect(row.sandboxId, { apiKey: E2B_API_KEY })
      await sbx.kill()
      console.log(`sandbox ${row.sandboxId} killed`)
    } catch (e) {
      console.log(`sandbox kill: ${e.message} (already gone is fine)`)
    }
  } else {
    console.log('no registered sandbox')
  }
  if (TIER_OPS_KEY) {
    try {
      const r = await fetch(`${APP_ORIGIN}/api/ops/gateway`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${TIER_OPS_KEY}` },
      })
      console.log(`row cleared via ops route: HTTP ${r.status}`)
      process.exit(0)
    } catch { /* fall through */ }
  }
  await withDb((c) => c.query('DELETE FROM "TierGateway" WHERE id = $1', ['singleton']))
  console.log('row cleared — tier down (renders fail and refund honestly)')
  process.exit(0)
}

console.log('usage: node up.mjs --kill   (to bring the tier up, run rotate.mjs)')
