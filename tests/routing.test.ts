// tests/routing.test.ts — multi-model routing across hosted + self-hosted
// tiers (T12).
//
// resolveVideoProvider() picked ONE tier for every job (selfhosted → fal →
// demo). Real deployments want per-model routing: the cost-control tier
// serves the models it can, the hosted API covers the rest, and a tier
// outage fails over to the other REAL tier before the job fails — never
// silently degrading a paid render to the local placeholder pipeline.
//
// The route table is env-overridable (SOMNIA_MODEL_ROUTES JSON,
// {"pulse-3":"selfhosted","pulse-flash":"fal"}) and everything re-reads the
// env lazily per call, matching resolveVideoProvider's contract.
//
// Hermetic: two local node:http gateways (selfhosted + fal shapes) run side
// by side — the headline spec routes two models to two different backends
// in one process.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { db } from '@/lib/db'
import { signup } from '@/lib/auth'
import { createJob } from '@/lib/engine'
import { processJob, type FrameSource } from '@/lib/pipeline'
import { balance } from '@/lib/ledger'
import { getProviderHealth } from '@/lib/health'
import { VIDEO_MODELS } from '@/lib/plans'
import {
  modelRoutes,
  configuredChain,
  configuredImageChain,
  failoverOrder,
  failoverImageOrder,
  effectiveRoutes,
  effectiveImageRoutes,
  resolveVideoProviderForJob,
} from '@/lib/routing'
import { selfHostedProvider, falProvider } from '@/lib/providers'
import sharp from 'sharp'

const CLIP = Buffer.from('SOMNIA-ROUTED-MP4-BYTES-0123456789')
const FRAME = await sharp({
  create: { width: 16, height: 16, channels: 3, background: '#334455' },
})
  .png()
  .toBuffer()

const ENV_KEYS = [
  'SELFHOSTED_URL',
  'SELFHOSTED_MODEL',
  'SELFHOSTED_API_KEY',
  'FAL_KEY',
  'FAL_MODEL',
  'FAL_QUEUE_BASE',
  'SOMNIA_MODEL_ROUTES',
  'PROVIDER_POLL_TIMEOUT_MS',
] as const

const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

let seq = 0
async function newUser() {
  const { user } = await signup({
    email: `routing${Date.now()}-${++seq}@somnia.test`,
    password: 'password123',
  })
  return user
}

const fakeFrameSource = (): { source: FrameSource; calls: string[] } => {
  const calls: string[] = []
  return {
    calls,
    source: {
      async generate(prompt: string, beat: string) {
        calls.push(`${prompt}|${beat}`)
        return FRAME
      },
    },
  }
}

// ---------------------------------------------------------------- fake gateways

/**
 * Minimal dual-shape queue gateway (the providers.test.ts contract, trimmed
 * to what routing needs): one submit endpoint, one status endpoint, media
 * serving, and a submitStatus knob for failure injection.
 */
class FakeGateway {
  server: http.Server
  port = 0
  mode: 'selfhosted' | 'fal'
  submits: string[] = []
  submitStatus = 202
  pollScript: Array<Record<string, unknown>> = []

  constructor(mode: 'selfhosted' | 'fal') {
    this.mode = mode
    this.server = http.createServer((req, res) => {
      void this.handle(req, res)
    })
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = req.url ?? '/'
    const method = req.method ?? 'GET'

    if (url === '/clip.mp4') {
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(CLIP.length) })
      res.end(CLIP)
      return
    }

    const isSubmit =
      (this.mode === 'selfhosted' && method === 'POST' && url === '/v1/video/jobs') ||
      (this.mode === 'fal' && method === 'POST')
    if (isSubmit) {
      for await (const _chunk of req) void _chunk // drain the body
      this.submits.push(url)
      if (this.submitStatus !== 202) {
        res.writeHead(this.submitStatus, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'gateway rejected' }))
        return
      }
      res.writeHead(202, { 'content-type': 'application/json' })
      res.end(JSON.stringify(this.mode === 'fal' ? { request_id: 'fal-req-1' } : { id: 'gw-1' }))
      return
    }

    if (this.mode === 'selfhosted' && method === 'GET' && url === '/v1/video/jobs/gw-1') {
      const next =
        this.pollScript.shift() ?? { status: 'succeeded', video_url: `${this.url}/clip.mp4` }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(next))
      return
    }
    if (this.mode === 'fal' && method === 'GET' && url.endsWith('/requests/fal-req-1/status')) {
      const next = this.pollScript.shift() ?? { status: 'COMPLETED' }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(next))
      return
    }
    if (this.mode === 'fal' && method === 'GET' && url.endsWith('/requests/fal-req-1')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ video: { url: `${this.url}/clip.mp4` } }))
      return
    }

    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
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

// ------------------------------------------------------------ routing table

describe('routing — modelRoutes', () => {
  it('is empty without SOMNIA_MODEL_ROUTES and parses valid JSON', () => {
    expect(modelRoutes()).toEqual({})
    process.env.SOMNIA_MODEL_ROUTES = '{"pulse-3":"selfhosted","pulse-flash":"fal"}'
    expect(modelRoutes()).toEqual({ 'pulse-3': 'selfhosted', 'pulse-flash': 'fal' })
  })

  it('ignores malformed JSON and unknown provider ids, never throwing', () => {
    process.env.SOMNIA_MODEL_ROUTES = '{"pulse-3":'
    expect(modelRoutes()).toEqual({})
    process.env.SOMNIA_MODEL_ROUTES = '{"pulse-3":"openai","pulse-flash":"fal"}'
    expect(modelRoutes()).toEqual({ 'pulse-flash': 'fal' })
    process.env.SOMNIA_MODEL_ROUTES = '["pulse-3"]'
    expect(modelRoutes()).toEqual({})
  })
})

describe('routing — failoverOrder', () => {
  it('lists configured tiers in cost-control order with no route table', () => {
    process.env.SELFHOSTED_URL = 'http://gpu.example'
    process.env.FAL_KEY = 'test-fal-key'
    expect(configuredChain().map((p) => p.name)).toEqual(['selfhosted', 'fal'])
    expect(failoverOrder('pulse-3').map((p) => p.name)).toEqual(['selfhosted', 'fal'])
  })

  it('puts a pinned route first, then the remaining configured tier', () => {
    process.env.SELFHOSTED_URL = 'http://gpu.example'
    process.env.FAL_KEY = 'test-fal-key'
    process.env.SOMNIA_MODEL_ROUTES = '{"pulse-flash":"fal"}'
    expect(failoverOrder('pulse-flash').map((p) => p.name)).toEqual(['fal', 'selfhosted'])
    expect(failoverOrder('pulse-3').map((p) => p.name)).toEqual(['selfhosted', 'fal'])
  })

  it('falls back to the configured chain when the pinned provider is unconfigured', () => {
    process.env.FAL_KEY = 'test-fal-key'
    process.env.SOMNIA_MODEL_ROUTES = '{"pulse-3":"selfhosted"}'
    expect(resolveVideoProviderForJob('pulse-3')?.name).toBe('fal')
    expect(failoverOrder('pulse-3').map((p) => p.name)).toEqual(['fal'])
  })

  it('resolves null when no tier is configured', () => {
    expect(resolveVideoProviderForJob('pulse-3')).toBeNull()
    expect(failoverOrder('pulse-3')).toEqual([])
  })
})

describe('routing — effectiveRoutes', () => {
  it('maps every video model to its effective provider id', () => {
    expect(effectiveRoutes()).toEqual({
      'pulse-3': 'demo',
      'pulse-flash': 'demo',
    })

    process.env.SELFHOSTED_URL = 'http://gpu.example'
    process.env.FAL_KEY = 'test-fal-key'
    process.env.SOMNIA_MODEL_ROUTES = '{"pulse-flash":"fal"}'
    expect(effectiveRoutes()).toEqual({
      'pulse-3': 'selfhosted',
      'pulse-flash': 'fal',
    })
  })

  it('surfaces the effective routes through the health DTO', async () => {
    process.env.SELFHOSTED_URL = 'http://gpu.example'
    process.env.SOMNIA_MODEL_ROUTES = '{"pulse-flash":"fal"}'
    const health = await getProviderHealth()
    expect(health.modelRoutes).toEqual({
      'pulse-3': 'selfhosted',
      'pulse-flash': 'selfhosted', // pinned to unconfigured fal → chain fallback
    })
  })
})

describe('routing — T16 image chain (prism stills)', () => {
  it('lists only image-capable tiers in cost-control order', () => {
    expect(failoverImageOrder()).toEqual([]) // nothing configured

    process.env.FAL_KEY = 'test-fal-key'
    expect(configuredChain()).toHaveLength(1) // fal IS configured…
    expect(configuredImageChain()).toEqual([]) // …but cannot render stills
    expect(failoverImageOrder()).toEqual([])

    process.env.SELFHOSTED_URL = 'http://gpu.example'
    expect(configuredImageChain()).toEqual([selfHostedProvider]) // selfhosted first
  })

  it('honors a prism route pin only when the tier is image-capable', () => {
    process.env.SELFHOSTED_URL = 'http://gpu.example'
    process.env.FAL_KEY = 'test-fal-key'
    process.env.SOMNIA_MODEL_ROUTES = '{"prism":"fal"}'
    // pinned to fal (not image-capable) → image chain fallback: selfhosted
    expect(failoverImageOrder()).toEqual([selfHostedProvider])

    delete process.env.SELFHOSTED_URL
    // only fal configured — the pin cannot serve stills, chain empty → local
    expect(failoverImageOrder()).toEqual([])
  })

  it('maps prism to its effective tier through effectiveImageRoutes', () => {
    expect(effectiveImageRoutes()).toEqual({ prism: 'demo' })

    process.env.SELFHOSTED_URL = 'http://gpu.example'
    expect(effectiveImageRoutes()).toEqual({ prism: 'selfhosted' })
  })

  it('surfaces the image routes through the health DTO', async () => {
    process.env.SELFHOSTED_URL = 'http://gpu.example'
    const health = await getProviderHealth()
    expect(health.imageModelRoutes).toEqual({ prism: 'selfhosted' })
  })
})

// --------------------------------------------------------------- pipeline

describe('routing — pipeline', () => {
  it('routes two models to two different backends in one process', async () => {
    const gwSelf = await new FakeGateway('selfhosted').start()
    const gwFal = await new FakeGateway('fal').start()
    process.env.SELFHOSTED_URL = gwSelf.url
    process.env.FAL_KEY = 'test-fal-key'
    process.env.FAL_QUEUE_BASE = gwFal.url
    process.env.SOMNIA_MODEL_ROUTES = JSON.stringify({
      'pulse-3': 'selfhosted',
      'pulse-flash': 'fal',
    })
    try {
      const user = await newUser()
      const first = await createJob({
        userId: user.id,
        model: 'pulse-3',
        prompt: 'a pulse-3 dream through neon canals',
      })
      const second = await createJob({
        userId: user.id,
        model: 'pulse-flash',
        prompt: 'a pulse-flash dream over salt flats',
      })

      const doneA = await processJob(first.id, { frameSource: fakeFrameSource().source })
      const doneB = await processJob(second.id, { frameSource: fakeFrameSource().source })
      expect(doneA.status).toBe('completed')
      expect(doneB.status).toBe('completed')

      expect(gwSelf.submits).toHaveLength(1) // pulse-3 → self-hosted gateway
      expect(gwFal.submits).toHaveLength(1) // pulse-flash → fal gateway
      const genA = await db.generation.findFirst({ where: { jobId: first.id } })
      const genB = await db.generation.findFirst({ where: { jobId: second.id } })
      expect(genA?.provider).toBe('selfhosted')
      expect(genB?.provider).toBe('fal')
    } finally {
      await gwSelf.close()
      await gwFal.close()
    }
  })

  it('fails over to the other real tier and re-stamps the actual provider cost', async () => {
    const gwSelf = await new FakeGateway('selfhosted').start()
    const gwFal = await new FakeGateway('fal').start()
    process.env.SELFHOSTED_URL = gwSelf.url
    process.env.FAL_KEY = 'test-fal-key'
    process.env.FAL_QUEUE_BASE = gwFal.url
    gwSelf.submitStatus = 500 // the routed tier rejects the submission
    try {
      const user = await newUser()
      const job = await createJob({
        userId: user.id,
        model: 'pulse-3', // routes to selfhosted (chain head)
        resolution: '720p',
        prompt: 'a dream that survives a gateway outage',
      })

      const done = await processJob(job.id, { frameSource: fakeFrameSource().source })
      expect(done.status).toBe('completed')
      // T15: the self-hosted adapter retries the submission ONCE before
      // giving the tier up (a restart blip must not fail a charged render),
      // so a persistently-rejecting gateway sees exactly two attempts…
      expect(gwSelf.submits).toHaveLength(2)
      expect(gwFal.submits).toHaveLength(1) // …and the fal tier finished it
      expect(done.providerCostUsd).toBe(0.12) // fal pulse-3 720p, not selfhosted's 0.09

      const generation = await db.generation.findFirst({ where: { jobId: job.id } })
      expect(generation?.provider).toBe('fal')
      const video = await db.asset.findFirst({
        where: { jobId: job.id, kind: 'video', variantKey: 'main' },
      })
      expect(video?.path).toBeTruthy()
    } finally {
      await gwSelf.close()
      await gwFal.close()
    }
  })

  it('fails and refunds when every configured tier fails — never silent demo degradation', async () => {
    const gwSelf = await new FakeGateway('selfhosted').start()
    process.env.SELFHOSTED_URL = gwSelf.url
    gwSelf.submitStatus = 500
    try {
      const user = await newUser()
      const before = await balance(user.id)
      const job = await createJob({ userId: user.id, prompt: 'an outage with no fallback' })
      const { source, calls } = fakeFrameSource()

      const done = await processJob(job.id, { frameSource: source })
      expect(done.status).toBe('failed')
      expect(done.errorMessage).toContain('500')
      expect(calls).toHaveLength(0) // never silently degraded to the local storyboard
      expect(await balance(user.id)).toBe(before) // refunded, not placeholder-delivered
    } finally {
      await gwSelf.close()
    }
  })

  it('still honors an explicitly injected provider (no failover, local when null)', async () => {
    const gw = await new FakeGateway('selfhosted').start()
    process.env.SELFHOSTED_URL = gw.url
    try {
      const user = await newUser()
      const job = await createJob({ userId: user.id, prompt: 'an explicitly local render' })
      const { source, calls } = fakeFrameSource()

      const done = await processJob(job.id, { frameSource: source, provider: null })
      expect(done.status).toBe('completed')
      expect(gw.submits).toHaveLength(0) // injection pins the tier
      expect(calls.length).toBeGreaterThan(0) // local storyboard ran
    } finally {
      await gw.close()
    }
  })
})
