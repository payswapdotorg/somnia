// One-off: verify the TierGateway singleton row matches the live sandbox.
import { Client } from 'pg'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('/home/z/my-project/scripts/e2b/rotate.env', 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const c = new Client({ connectionString: env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const r = await c.query('SELECT id, url, model, "sandboxId", notes, "updatedAt" FROM "TierGateway"')
for (const row of r.rows) {
  console.log(JSON.stringify({ ...row, apiKey: row.apiKey ? '<present>' : null }))
}
await c.end()
