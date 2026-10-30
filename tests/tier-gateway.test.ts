// tests/tier-gateway.test.ts — T16 live-tier durability.
//
// The self-hosted gateway endpoint lives in the TierGateway DB row; the
// stable relay route (/api/tier/relay/*, auth: SELFHOSTED_API_KEY) forwards
// to it, and the ops route (/api/ops/gateway, auth: TIER_OPS_KEY) upserts
// it — a sandbox rotation is UPDATE one row, zero env rewrites, zero
// redeploys. Hermetic: a local node:http server plays the remote gateway.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

import { db } from '@/lib/db'
import { dispatchSomnia } from '@/lib/somnia-api'
import {
  getTierGateway,
  upsertTierGateway,
  clearTierGateway,
  relayGatewayRequest,
  getOpsGateway,
  postOpsGateway,
  deleteOpsGateway,
} from '@/lib/tier-gateway'
import { getProviderHealth } from '@/lib/health'

// ---------------------------------------------------------------- fake gateway

interface GatewayCapture {
  method: string
  url: string
  authorization?: string
  body: string
}

class FakeGateway {
  server: http.Server
  port = 0
  captures: GatewayCapture[] = []

  constructor() {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(chunk as Buffer))
      req.on('end', () => {
        const capture: GatewayCapture = {
          method: req.method ?? 'GET',
          url: req.url ?? '/',
          authorization: req.headers.authorization,
          body: Buffer.concat(chunks).toString('utf8'),
        }
        this.captures.push(capture)

        if (capture.url === '/healthz') {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true, imagery: 'test-source' }))
          return
        }
        if (capture.method === 'POST' && capture.url === '/v1/video/jobs') {
          res.writeHead(202, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ id: 'gw-1' }))
          return
        }
        if (capture.method === 'GET' && capture.url === '/v1/video/jobs/gw-1') {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(
            JSON.stringify({
              status: 'succeeded',
              progress: 100,
              video_url: `${this.url}/files/gw-1/out.mp4`,
              frames: [],
            })
          )
          return
        }
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'no such job' }))
      })
    })
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`
  }

  async start(): Promise<this> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve))
    this.port = (this.server.address() as AddressInfo).port
    return this
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }
}

// ---------------------------------------------------------------- env plumbing

const ENV_KEYS = ['SELFHOSTED_API_KEY', 'TIER_OPS_KEY'] as const
const savedEnv: Record<string, string | undefined> = {}

beforeEach(async () => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  process.env.SELFHOSTED_API_KEY = 'relay-secret'
  process.env.TIER_OPS_KEY = 'ops-secret'
  // every spec starts from NO registered gateway
  await db.tierGateway.deleteMany({})
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function relayRequest(path: string, init?: RequestInit): Request {
  return new Request(`http://somnia.test/api/tier/relay${path}`, init)
}

async function relayJson(path: string, init?: RequestInit) {
  const response = await relayGatewayRequest(
    relayRequest(path, init),
    path.slice(1).split('/').filter(Boolean)
  )
  return { response, body: (await response.json().catch(() => null)) as unknown }
}

// ---------------------------------------------------------------- row state

describe('TierGateway row state', () => {
  it('is unregistered by default (null)', async () => {
    expect(await getTierGateway()).toBeNull()
  })

  it('upserts the singleton — create then rotate in place', async () => {
    const first = await upsertTierGateway({ url: 'https://3000-one.e2b.app/' })
    expect(first.url).toBe('https://3000-one.e2b.app') // trailing slash stripped

    const second = await upsertTierGateway({
      url: 'https://3000-two.e2b.app',
      apiKey: 'smg_rotated',
      model: 'e2b-kenburns-cpu',
      sandboxId: 'sbx-two',
      notes: 'hourly rotation',
    })
    expect(second.url).toBe('https://3000-two.e2b.app')
    expect(second.apiKey).toBe('smg_rotated')
    expect(second.model).toBe('e2b-kenburns-cpu')
    expect(second.sandboxId).toBe('sbx-two')

    // ONE row, updated — never duplicated
    expect(await db.tierGateway.count()).toBe(1)
    expect((await getTierGateway())?.url).toBe('https://3000-two.e2b.app')
  })

  it('rejects a non-http(s) or malformed gateway url', async () => {
    await expect(upsertTierGateway({ url: 'ftp://gateway.example.com' })).rejects.toThrow(
      /http\(s\)/i
    )
    await expect(upsertTierGateway({ url: 'not a url' })).rejects.toThrow(/http\(s\)/i)
    await expect(upsertTierGateway({ url: '' })).rejects.toThrow(/http\(s\)/i)
    expect(await db.tierGateway.count()).toBe(0)
  })

  it('treats an empty apiKey as no gateway auth (null), and clears the row', async () => {
    const state = await upsertTierGateway({ url: 'https://gw.example.com', apiKey: '   ' })
    expect(state.apiKey).toBeNull()
    expect(await clearTierGateway()).toBe(true)
    expect(await getTierGateway()).toBeNull()
    expect(await clearTierGateway()).toBe(false) // nothing left to clear
  })
})

// ---------------------------------------------------------------- relay

describe('tier/relay forwarding', () => {
  it('answers 401 without or with a wrong relay bearer', async () => {
    await upsertTierGateway({ url: 'https://gw.example.com', apiKey: 'smg_x' })

    const noAuth = await relayJson('/v1/video/jobs', { method: 'POST' })
    expect(noAuth.response.status).toBe(401)

    const wrongAuth = await relayJson('/v1/video/jobs', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong-secret' },
    })
    expect(wrongAuth.response.status).toBe(401)
  })

  it('answers 503 honestly when no gateway is registered (tier DOWN)', async () => {
    const { response, body } = await relayJson('/v1/video/jobs', {
      method: 'POST',
      headers: { authorization: 'Bearer relay-secret' },
    })
    expect(response.status).toBe(503)
    expect((body as { error?: string }).error).toBe('tier_gateway_unconfigured')
  })

  it('forwards a POST submission verbatim and swaps in the row apiKey', async () => {
    const gw = await new FakeGateway().start()
    await upsertTierGateway({ url: gw.url, apiKey: 'smg_per_sandbox' })
    try {
      const payload = { model: 'e2b-kenburns-cpu', prompt: 'a relayed dream', keyframes: [] }
      const { response, body } = await relayJson('/v1/video/jobs', {
        method: 'POST',
        headers: {
          authorization: 'Bearer relay-secret',
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
      expect(response.status).toBe(202)
      expect(body).toEqual({ id: 'gw-1' })
      expect(response.headers.get('content-type')).toBe('application/json')

      // the gateway saw the contract request — authed with the ROW key
      expect(gw.captures).toHaveLength(1)
      expect(gw.captures[0]!.method).toBe('POST')
      expect(gw.captures[0]!.url).toBe('/v1/video/jobs')
      expect(gw.captures[0]!.authorization).toBe('Bearer smg_per_sandbox')
      expect(JSON.parse(gw.captures[0]!.body)).toEqual(payload)
    } finally {
      await gw.close()
    }
  })

  it('forwards a GET status poll and passes the gateway status through', async () => {
    const gw = await new FakeGateway().start()
    await upsertTierGateway({ url: gw.url, apiKey: 'smg_per_sandbox' })
    try {
      const { response, body } = await relayJson('/v1/video/jobs/gw-1', {
        headers: { authorization: 'Bearer relay-secret' },
      })
      expect(response.status).toBe(200)
      expect((body as { status?: string }).status).toBe('succeeded')

      // an unknown job id passes the gateway's own 404 through untouched
      const missing = await relayJson('/v1/video/jobs/gw-missing', {
        headers: { authorization: 'Bearer relay-secret' },
      })
      expect(missing.response.status).toBe(404)
    } finally {
      await gw.close()
    }
  })

  it('forwards /healthz (the ops liveness path) to the gateway', async () => {
    const gw = await new FakeGateway().start()
    await upsertTierGateway({ url: gw.url })
    try {
      const { response, body } = await relayJson('/healthz', {
        headers: { authorization: 'Bearer relay-secret' },
      })
      expect(response.status).toBe(200)
      expect((body as { ok?: boolean }).ok).toBe(true)
      // no row apiKey → forwarded without Authorization
      expect(gw.captures[0]!.authorization).toBeUndefined()
    } finally {
      await gw.close()
    }
  })

  it('answers 405 for verbs the queue contract never uses', async () => {
    await upsertTierGateway({ url: 'https://gw.example.com' })
    const { response } = await relayJson('/v1/video/jobs', {
      method: 'DELETE',
      headers: { authorization: 'Bearer relay-secret' },
    })
    expect(response.status).toBe(405)
  })

  it('answers 404 for paths outside the /v1 + /healthz allowlist', async () => {
    const gw = await new FakeGateway().start()
    await upsertTierGateway({ url: gw.url })
    try {
      const { response } = await relayJson('/files/gw-1/out.mp4', {
        headers: { authorization: 'Bearer relay-secret' },
      })
      expect(response.status).toBe(404)
      expect(gw.captures).toHaveLength(0) // never forwarded
    } finally {
      await gw.close()
    }
  })

  it('answers 502 when the registered gateway is unreachable', async () => {
    // a port that is definitely closed
    await upsertTierGateway({ url: 'http://127.0.0.1:9' })
    const { response, body } = await relayJson('/healthz', {
      headers: { authorization: 'Bearer relay-secret' },
    })
    expect(response.status).toBe(502)
    expect((body as { error?: string }).error).toBe('tier_gateway_unreachable')
  })

  it('serves through the dispatch route table end-to-end', async () => {
    const gw = await new FakeGateway().start()
    await upsertTierGateway({ url: gw.url, apiKey: 'smg_dispatch' })
    try {
      const request = new Request('http://somnia.test/api/tier/relay/v1/video/jobs', {
        method: 'POST',
        headers: {
          authorization: 'Bearer relay-secret',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model: 'e2b-kenburns-cpu', prompt: 'dispatched' }),
      })
      const response = await dispatchSomnia(request, ['tier', 'relay', 'v1', 'video', 'jobs'])
      expect(response.status).toBe(202)
      expect(await response.json()).toEqual({ id: 'gw-1' })
      expect(gw.captures[0]!.authorization).toBe('Bearer smg_dispatch')

      // and the bare relay root is a routing miss
      const miss = await dispatchSomnia(
        new Request('http://somnia.test/api/tier/relay', {
          headers: { authorization: 'Bearer relay-secret' },
        }),
        ['tier', 'relay']
      )
      expect(miss.status).toBe(404)
    } finally {
      await gw.close()
    }
  })
})

// ---------------------------------------------------------------- ops route

describe('ops/gateway (rotation surface)', () => {
  const opsHeaders = { authorization: 'Bearer ops-secret', 'content-type': 'application/json' }

  it('is closed (503) when TIER_OPS_KEY is not configured', async () => {
    delete process.env.TIER_OPS_KEY
    const response = await getOpsGateway(new Request('http://somnia.test/api/ops/gateway'))
    expect(response.status).toBe(503)
    const posted = await postOpsGateway(
      new Request('http://somnia.test/api/ops/gateway', { method: 'POST', headers: opsHeaders })
    )
    expect(posted.status).toBe(503)
  })

  it('rejects a wrong ops key with 401', async () => {
    const response = await getOpsGateway(
      new Request('http://somnia.test/api/ops/gateway', {
        headers: { authorization: 'Bearer not-the-ops-key' },
      })
    )
    expect(response.status).toBe(401)
  })

  it('GET returns the masked state — never the apiKey value', async () => {
    await upsertTierGateway({
      url: 'https://3000-abc.e2b.app',
      apiKey: 'smg_secret_value',
      model: 'e2b-kenburns-cpu',
      sandboxId: 'abc',
    })
    const response = await getOpsGateway(
      new Request('http://somnia.test/api/ops/gateway', { headers: opsHeaders })
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { gateway?: Record<string, unknown> }
    expect(body.gateway).toMatchObject({
      configured: true,
      url: 'https://3000-abc.e2b.app',
      hasApiKey: true,
      model: 'e2b-kenburns-cpu',
      sandboxId: 'abc',
    })
    expect(JSON.stringify(body)).not.toContain('smg_secret_value')

    const empty = await getOpsGateway(
      new Request('http://somnia.test/api/ops/gateway', { headers: opsHeaders })
    )
    // still configured — the row persists
    expect(((await empty.json()) as { gateway?: { configured?: boolean } }).gateway?.configured).toBe(true)
  })

  it('POST upserts the row (the rotation step) and DELETE clears it', async () => {
    const request = (method: string, body?: unknown) =>
      new Request('http://somnia.test/api/ops/gateway', {
        method,
        headers: opsHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
      })

    const upserted = await postOpsGateway(
      request('POST', { url: 'https://3000-fresh.e2b.app', apiKey: 'smg_fresh', model: 'e2b-kenburns-cpu' })
    )
    expect(upserted.status).toBe(201)
    const created = (await upserted.json()) as { gateway?: { url?: string; hasApiKey?: boolean } }
    expect(created.gateway).toMatchObject({ url: 'https://3000-fresh.e2b.app', hasApiKey: true })

    // a rotation is just another POST — the row updates in place
    await postOpsGateway(
      request('POST', { url: 'https://3000-newer.e2b.app', apiKey: 'smg_newer' })
    )
    expect((await getTierGateway())?.url).toBe('https://3000-newer.e2b.app')
    expect(await db.tierGateway.count()).toBe(1)

    const removed = await deleteOpsGateway(request('DELETE'))
    expect(removed.status).toBe(200)
    expect(((await removed.json()) as { removed?: boolean }).removed).toBe(true)
    expect(await getTierGateway()).toBeNull()
  })

  it('POST rejects an invalid body with 400 and changes nothing', async () => {
    const bad = await postOpsGateway(
      new Request('http://somnia.test/api/ops/gateway', {
        method: 'POST',
        headers: opsHeaders,
        body: JSON.stringify({ url: 'not-a-url' }),
      })
    )
    expect(bad.status).toBe(400)
    const nonJson = await postOpsGateway(
      new Request('http://somnia.test/api/ops/gateway', {
        method: 'POST',
        headers: opsHeaders,
        body: 'not json',
      })
    )
    expect(nonJson.status).toBe(400)
    expect(await db.tierGateway.count()).toBe(0)
  })

  it('serves GET/POST/DELETE through the dispatch route table', async () => {
    const request = (method: string, body?: unknown) =>
      new Request('http://somnia.test/api/ops/gateway', {
        method,
        headers: opsHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
      })

    const posted = await dispatchSomnia(request('POST', { url: 'https://3000-dispatch.e2b.app' }), [
      'ops',
      'gateway',
    ])
    expect(posted.status).toBe(201)

    const read = await dispatchSomnia(request('GET'), ['ops', 'gateway'])
    const readBody = (await read.json()) as { gateway?: { url?: string } }
    expect(readBody.gateway?.url).toBe('https://3000-dispatch.e2b.app')

    const cleared = await dispatchSomnia(request('DELETE'), ['ops', 'gateway'])
    expect(cleared.status).toBe(200)
  })
})

// ---------------------------------------------------------------- health truth

describe('provider health: the tier-gateway truth', () => {
  it('reports unconfigured + null liveness when no row exists', async () => {
    const health = await getProviderHealth()
    expect(health.tierGatewayConfigured).toBe(false)
    expect(health.tierGatewayAlive).toBeNull()
    expect(health.tierGatewayRotatedAt).toBeNull()
  })

  it('reports alive=true for a registered live gateway, alive=false for a dead one', async () => {
    const gw = await new FakeGateway().start()
    try {
      await upsertTierGateway({ url: gw.url, apiKey: 'smg_probe' })
      const live = await getProviderHealth()
      expect(live.tierGatewayConfigured).toBe(true)
      expect(live.tierGatewayAlive).toBe(true)
      expect(typeof live.tierGatewayRotatedAt).toBe('string')

      await gw.close()
      const dead = await getProviderHealth()
      expect(dead.tierGatewayConfigured).toBe(true) // the row exists…
      expect(dead.tierGatewayAlive).toBe(false) // …but the sandbox behind it does not
    } finally {
      await gw.close().catch(() => undefined)
    }
  })
})
