// rotate.mjs — Somnia T16 live-tier gateway rotation (zero downtime).
//
// 1. Boot a fresh E2B sandbox from the somnia gateway template
// 2. Push gateway.mjs + gateway.env (fresh smg_ key) + supervisor.sh, boot it
// 3. Self-test the FULL gateway contract directly against the sandbox:
//      prompt-only video · pinned-timeline video · prism still
// 4. Atomically upsert the TierGateway DB singleton row:
//      via POST /api/ops/gateway when TIER_OPS_KEY is set,
//      otherwise via the same upsert straight against Neon (identical
//      semantics — the row IS the source of truth; the ops route only guards it)
// 5. Kill the old sandbox, print 'rotation complete' + 'tier LIVE'
//
// Credentials come from rotate.env next to this file (chmod 600, never commit).

import { Sandbox } from 'e2b'
import { Client } from 'pg'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_ORIGIN = 'https://somnia-bay.vercel.app'

const env = Object.fromEntries(
  readFileSync(join(HERE, 'rotate.env'), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const { E2B_API_KEY, TEMPLATE_ID, GATEWAY_MODEL, RENDER_DEADLINE_MS, NEON_DATABASE_URL, TIER_OPS_KEY } = env
if (!E2B_API_KEY || !TEMPLATE_ID || !NEON_DATABASE_URL) {
  console.error('rotate.env missing E2B_API_KEY / TEMPLATE_ID / NEON_DATABASE_URL')
  process.exit(1)
}

const log = (m) => console.log(`[rotate ${new Date().toISOString()}] ${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function currentRow() {
  // Prefer the ops route; fall back to a direct read.
  try {
    if (TIER_OPS_KEY) {
      const r = await fetch(`${APP_ORIGIN}/api/ops/gateway`, {
        headers: { authorization: `Bearer ${TIER_OPS_KEY}` },
        signal: AbortSignal.timeout(15_000),
      })
      if (r.ok) {
        const { gateway } = await r.json()
        return gateway?.configured ? { sandboxId: gateway.sandboxId, url: gateway.url } : null
      }
      log(`ops GET ${r.status} — falling back to direct DB read`)
    }
  } catch (e) {
    log(`ops GET failed (${e.message}) — falling back to direct DB read`)
  }
  const c = new Client({ connectionString: NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const r = await c.query('SELECT url, "sandboxId" FROM "TierGateway" WHERE id = $1', ['singleton'])
    return r.rows[0] ?? null
  } finally {
    await c.end()
  }
}

async function upsertRow({ url, apiKey, model, sandboxId, notes }) {
  if (TIER_OPS_KEY) {
    try {
      const r = await fetch(`${APP_ORIGIN}/api/ops/gateway`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TIER_OPS_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ url, apiKey, model, sandboxId, notes }),
        signal: AbortSignal.timeout(15_000),
      })
      if (r.ok) {
        log('row upserted via /api/ops/gateway')
        return
      }
      log(`ops POST ${r.status} — falling back to direct DB upsert`)
    } catch (e) {
      log(`ops POST failed (${e.message}) — falling back to direct DB upsert`)
    }
  }
  const c = new Client({ connectionString: NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    await c.query(
      `INSERT INTO "TierGateway" (id, url, "apiKey", model, "sandboxId", notes, "updatedAt")
       VALUES ('singleton', $1, $2, $3, $4, $5, now())
       ON CONFLICT (id) DO UPDATE SET
         url = $1, "apiKey" = $2, model = $3, "sandboxId" = $4, notes = $5, "updatedAt" = now()`,
      [url, apiKey, model, sandboxId, notes]
    )
    log('row upserted via direct Neon upsert (same semantics as upsertTierGateway)')
  } finally {
    await c.end()
  }
}

async function killSandbox(id) {
  try {
    const sbx = await Sandbox.connect(id, { apiKey: E2B_API_KEY })
    await sbx.kill()
    log(`old sandbox ${id} killed`)
  } catch (e) {
    log(`old sandbox ${id} kill: ${e.message} (already gone is fine)`)
  }
}

async function waitForHealth(url, key, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last = 'no attempt'
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${url}/healthz`, {
        headers: key ? { authorization: `Bearer ${key}` } : {},
        signal: AbortSignal.timeout(5_000),
      })
      if (r.ok) {
        const body = await r.text()
        log(`/healthz 200 — ${body.slice(0, 140)}`)
        return true
      }
      last = `HTTP ${r.status}`
    } catch (e) {
      last = e.message
    }
    await sleep(2_000)
  }
  throw new Error(`gateway never went healthy (${last})`)
}

async function pollJob(url, key, path, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let fails = 0
  while (Date.now() < deadline) {
    await sleep(2_000)
    let body
    try {
      const r = await fetch(`${url}${path}`, {
        headers: key ? { authorization: `Bearer ${key}` } : {},
        signal: AbortSignal.timeout(10_000),
      })
      if (!r.ok) throw new Error(`poll HTTP ${r.status}`)
      body = await r.json()
      fails = 0
    } catch (e) {
      if (++fails > 2) throw e
      continue
    }
    if (body.status === 'succeeded') return body
    if (body.status === 'failed') throw new Error(body.error || 'job failed')
  }
  throw new Error('job poll timed out')
}

async function check200(url, key, label) {
  const r = await fetch(url, {
    headers: key ? { authorization: `Bearer ${key}` } : {},
    signal: AbortSignal.timeout(20_000),
  })
  const buf = Buffer.from(await r.arrayBuffer())
  if (!r.ok || buf.length < 1024) throw new Error(`${label}: HTTP ${r.status}, ${buf.length} bytes — too small`)
  log(`${label}: ${r.status}, ${(buf.length / 1024).toFixed(1)} KiB ✓`)
}

async function main() {
  const old = await currentRow()
  log(`current row: ${old ? `${old.sandboxId} (${old.url})` : 'none — tier down'}`)

  // 1. fresh sandbox from the same template as the live one
  const sbx = await Sandbox.create(TEMPLATE_ID, {
    apiKey: E2B_API_KEY,
    timeoutMs: 3_600_000,
  })
  const url = `https://${sbx.getHost(3000)}`
  log(`new sandbox ${sbx.sandboxId} at ${url}`)

  // 2. fresh gateway key each rotation
  const apiKey = `smg_${randomBytes(24).toString('hex')}`
  const gatewayEnv = [
    `GATEWAY_API_KEY=${apiKey}`,
    `PUBLIC_BASE=${url}`,
    `APP_ORIGIN=${APP_ORIGIN}`,
    `RENDER_DEADLINE_MS=${RENDER_DEADLINE_MS || '240000'}`,
    'PORT=3000',
    '',
  ].join('\n')

  const gatewayMjs = readFileSync(join(HERE, 'gateway.mjs'))
  const supervisorSh = `#!/bin/bash
while true; do
  set -a; source /home/user/gateway.env; set +a
  node /home/z/my-project/scripts/e2b/gateway.mjs >> /home/user/gateway.log 2>&1
  echo "[supervisor] gateway exited ($?) — restarting in 1s" >> /home/user/gateway.log
  sleep 1
done
`

  await sbx.files.makeDir('/home/z/my-project/scripts/e2b')
  await sbx.files.write('/home/z/my-project/scripts/e2b/gateway.mjs', gatewayMjs)
  await sbx.files.write('/home/user/gateway.env', gatewayEnv)
  await sbx.files.write('/home/user/supervisor.sh', supervisorSh)
  await sbx.commands.run('chmod +x /home/user/supervisor.sh && chmod 600 /home/user/gateway.env')
  // the gateway mkdirs /data at boot — provision it as root first (user cannot write /)
  await sbx.commands.run('sudo mkdir -p /data && sudo chown user:user /data && sudo chmod 777 /data')
  // current template build ships without ffmpeg — install it when missing
  const ff = await sbx.commands.run('which ffmpeg || true')
  if (!ff.stdout.trim()) {
    log('template lacks ffmpeg — apt-get installing (~1 min)')
    const inst = await sbx.commands.run(
      'sudo apt-get update -qq && sudo apt-get install -y -qq --no-install-recommends ffmpeg',
      { timeoutMs: 240_000 }
    )
    if (inst.exitCode !== 0) throw new Error(`ffmpeg install failed: ${(inst.stderr || '').slice(-300)}`)
    log(`ffmpeg installed: ${(await sbx.commands.run('ffmpeg -version | head -1')).stdout.trim()}`)
  }
  // background handle stays open for the sandbox lifetime (matches the live box's PID tree)
  await sbx.commands.run('bash /home/user/supervisor.sh >> /home/user/supervisor.log 2>&1', { background: true })
  log('gateway pushed, /data provisioned, supervisor started')

  // 3. full-contract self-test, directly against the new sandbox
  await waitForHealth(url, apiKey, 120_000)
  const auth = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }

  const submit = async (path, payload) => {
    const r = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    })
    if (r.status !== 202) throw new Error(`${path} submit: HTTP ${r.status} ${await r.text()}`)
    const { id } = await r.json()
    if (!id) throw new Error(`${path} submit returned no id`)
    return id
  }

  // verified-live image URLs: the app's own OG asset + two seeded beats
  const pinned = [
    `${APP_ORIGIN}/og.png`,
    'https://picsum.photos/seed/somnia1/640/360',
    'https://picsum.photos/seed/somnia2/640/360',
  ]

  log('self-test 1/5: prompt-only video (unknown model → default profile)')
  const vid1 = await submit('/v1/video/jobs', {
    model: GATEWAY_MODEL || 'e2b-kenburns-cpu',
    prompt: 'somnia rotation smoke — golden hour clouds drifting over a calm sea',
    resolution: '540p', duration_sec: 3, aspect_ratio: '16:9', hdr: false, loop: false, keyframes: [],
  })
  const r1 = await pollJob(url, apiKey, `/v1/video/jobs/${vid1}`, 150_000)
  await check200(r1.video_url, apiKey, 'video_url')

  log('self-test 2/5: pinned-timeline video')
  const vid2 = await submit('/v1/video/jobs', {
    model: GATEWAY_MODEL || 'e2b-kenburns-cpu',
    prompt: 'pinned timeline smoke',
    resolution: '540p', duration_sec: 3, aspect_ratio: '16:9', hdr: false, loop: false, keyframes: pinned,
  })
  const r2 = await pollJob(url, apiKey, `/v1/video/jobs/${vid2}`, 150_000)
  await check200(r2.video_url, apiKey, 'pinned video_url')
  if (!Array.isArray(r2.frames) || r2.frames.length === 0) throw new Error('pinned video returned no frames')

  log('self-test 3/5: prism still')
  const img1 = await submit('/v1/image/jobs', {
    model: GATEWAY_MODEL || 'e2b-kenburns-cpu',
    prompt: 'prism still smoke',
    resolution: '540p', aspect_ratio: '1:1', start_frame: null, keyframes: [pinned[0]],
  })
  const r3 = await pollJob(url, apiKey, `/v1/image/jobs/${img1}`, 120_000)
  await check200(r3.image_url, apiKey, 'image_url')

  // T19 — model-keyed rendering: the premium model gets a denser storyboard
  // than the flash model. 3s: pulse-3 → 4 beats, pulse-flash → 2 beats.
  log('self-test 4/5: pulse-3 premium storyboard')
  const vid3 = await submit('/v1/video/jobs', {
    model: 'pulse-3',
    prompt: 'somnia premium smoke — four beats of drifting cirrus over basalt',
    resolution: '540p', duration_sec: 3, aspect_ratio: '16:9', hdr: false, loop: false, keyframes: [],
  })
  const r4 = await pollJob(url, apiKey, `/v1/video/jobs/${vid3}`, 150_000)
  await check200(r4.video_url, apiKey, 'pulse-3 video_url')
  if (!Array.isArray(r4.frames) || r4.frames.length !== 4) {
    throw new Error(`pulse-3 3s should render 4 beats, got ${r4.frames?.length}`)
  }

  log('self-test 5/5: pulse-flash lean storyboard')
  const vid4 = await submit('/v1/video/jobs', {
    model: 'pulse-flash',
    prompt: 'somnia flash smoke — two quick beats',
    resolution: '540p', duration_sec: 3, aspect_ratio: '16:9', hdr: false, loop: false, keyframes: [],
  })
  const r5 = await pollJob(url, apiKey, `/v1/video/jobs/${vid4}`, 150_000)
  await check200(r5.video_url, apiKey, 'pulse-flash video_url')
  if (!Array.isArray(r5.frames) || r5.frames.length !== 2) {
    throw new Error(`pulse-flash 3s should render 2 beats, got ${r5.frames?.length}`)
  }

  log('full contract self-test PASSED')

  // 4. atomic row upsert (ops route, else direct Neon)
  await upsertRow({
    url,
    apiKey,
    model: GATEWAY_MODEL || 'e2b-kenburns-cpu',
    sandboxId: sbx.sandboxId,
    notes: `T16 rotation ${new Date().toISOString()}`,
  })

  // 5. kill the old sandbox
  if (old?.sandboxId && old.sandboxId !== sbx.sandboxId) await killSandbox(old.sandboxId)

  console.log('rotation complete')
  console.log('tier LIVE')
  console.log(`sandbox ${sbx.sandboxId}`)
}

main().catch(async (e) => {
  console.error(`[rotate] FAILED: ${e.message}`)
  process.exit(1)
})
