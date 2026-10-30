// tests/providers.test.ts — hosted provider adapters (T6a).
//
// Self-hosted gateway and fal.ai-shaped queue adapters slot behind the
// render pipeline: with SELFHOSTED_URL / FAL_KEY configured, queued VIDEO
// jobs are submitted to the remote renderer, polled to completion and the
// finished MP4 is ingested into public/generated. IMAGE jobs always keep
// the local prism path. Failures surface through the engine's refund path.
//
// Hermetic: a local node:http server plays the remote gateway on an
// ephemeral port (no outbound network). SOMNIA_TEST shrinks poll timings.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { db } from '@/lib/db'
import { signup } from '@/lib/auth'
import { createJob } from '@/lib/engine'
import { processJob, type FrameSource } from '@/lib/pipeline'
import { balance, topup } from '@/lib/ledger'
import { resolveVideoProvider, selfHostedProvider, falProvider } from '@/lib/providers'
import { absoluteFromPublic } from '@/lib/frames'
import { promises as fs } from 'node:fs'
import sharp from 'sharp'

const CLIP = Buffer.from('SOMNIA-FAKE-MP4-BYTES-0123456789')
const FRAME = await sharp({
  create: { width: 16, height: 16, channels: 3, background: '#334455' },
})
  .png()
  .toBuffer()

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

let seq = 0
async function newUser() {
  const { user } = await signup({
    email: `providers${Date.now()}-${++seq}@somnia.test`,
    password: 'password123',
  })
  return user
}

// ---------------------------------------------------------------- fake gateway

interface SubmitCapture {
  url: string
  body: Record<string, unknown>
  authorization?: string
}

/**
 * A scripted remote gateway. Mode 'selfhosted' serves the two-endpoint
 * queue contract; mode 'fal' serves the fal queue shape. `pollScript` is
 * consumed one response per status poll.
 */
class FakeGateway {
  server: http.Server
  port = 0
  mode: 'selfhosted' | 'fal'
  submits: SubmitCapture[] = []
  polls: string[] = []
  observedProgress: number[] = []
  watchJobId: string | null = null
  pollScript: Array<Record<string, unknown>> = []
  submitStatus = 202
  /** Leading submits to reject with 503 before accepting (transient-hiccup sim). */
  submitFailures = 0
  /** Leading polls to answer with HTTP 500 before serving the script (transient-hiccup sim). */
  pollFailures = 0
  falResult: Record<string, unknown> = {}
  clip = CLIP
  frame = FRAME

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

    // ---- media endpoints ----
    if (url === '/clip.mp4') {
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(this.clip.length) })
      res.end(this.clip)
      return
    }
    if (url === '/f1.png' || url === '/f2.png') {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(this.frame.length) })
      res.end(this.frame)
      return
    }

    // ---- submit endpoints ----
    const isSelfSubmit = this.mode === 'selfhosted' && method === 'POST' && url === '/v1/video/jobs'
    const isFalSubmit = this.mode === 'fal' && method === 'POST' // POST {base}/{model} — model ids contain slashes
    if (isSelfSubmit || isFalSubmit) {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      this.submits.push({
        url,
        body,
        authorization: req.headers.authorization,
      })
      if (this.submitFailures > 0) {
        this.submitFailures -= 1
        res.writeHead(503, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'gateway restarting' }))
        return
      }
      if (this.submitStatus !== 202) {
        res.writeHead(this.submitStatus, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'gateway rejected' }))
        return
      }
      res.writeHead(202, { 'content-type': 'application/json' })
      res.end(JSON.stringify(this.mode === 'fal' ? { request_id: 'fal-req-1' } : { id: 'gw-1' }))
      return
    }

    // ---- status polls ----
    if (this.mode === 'selfhosted' && method === 'GET' && url === '/v1/video/jobs/gw-1') {
      this.polls.push(url)
      if (this.pollFailures > 0) {
        this.pollFailures -= 1
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'edge hiccup' }))
        return
      }
      const next = this.pollScript.shift() ?? { status: 'succeeded', video_url: `${this.url}/clip.mp4` }
      if (this.watchJobId) {
        const job = await db.job.findUnique({ where: { id: this.watchJobId } })
        this.observedProgress.push(job?.progress ?? -1)
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(next))
      return
    }
    if (this.mode === 'fal' && method === 'GET' && url.endsWith('/requests/fal-req-1/status')) {
      this.polls.push(url)
      const next = this.pollScript.shift() ?? { status: 'COMPLETED' }
      if (this.watchJobId) {
        const job = await db.job.findUnique({ where: { id: this.watchJobId } })
        this.observedProgress.push(job?.progress ?? -1)
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(next))
      return
    }

    // ---- fal result fetch ----
    if (this.mode === 'fal' && method === 'GET' && url.endsWith('/requests/fal-req-1')) {
      this.polls.push(url)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(this.falResult))
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

// ---------------------------------------------------------------- env plumbing

const ENV_KEYS = [
  'SELFHOSTED_URL',
  'SELFHOSTED_MODEL',
  'SELFHOSTED_API_KEY',
  'FAL_KEY',
  'FAL_MODEL',
  'FAL_QUEUE_BASE',
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

async function fileBytes(publicPath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(absoluteFromPublic(publicPath))
  } catch {
    return null
  }
}

/** FrameSource fake — counts calls (hosted video paths must never hit it). */
function fakeFrameSource() {
  const calls: string[] = []
  const source: FrameSource = {
    async generate(prompt: string, beat: string) {
      calls.push(`${prompt}|${beat}`)
      return FRAME
    },
  }
  return { source, calls }
}

// ---------------------------------------------------------------- resolution

describe('providers — resolution precedence', () => {
  it('resolves to the local demo pipeline without provider env', () => {
    expect(selfHostedProvider.configured).toBe(false)
    expect(falProvider.configured).toBe(false)
    expect(resolveVideoProvider()).toBeNull()
  })

  it('activates the fal adapter when FAL_KEY is set', () => {
    process.env.FAL_KEY = 'test-key'
    expect(falProvider.configured).toBe(true)
    expect(resolveVideoProvider()?.name).toBe('fal')
  })

  it('ranks the self-hosted tier above fal when both are configured', () => {
    process.env.FAL_KEY = 'test-key'
    process.env.SELFHOSTED_URL = 'http://gpu.example.com'
    expect(resolveVideoProvider()?.name).toBe('selfhosted')
  })
})

// ---------------------------------------------------------------- self-hosted

describe('providers — self-hosted gateway', () => {
  it('renders a queued video job to a completed MP4 through the gateway', async () => {
    const gw = await new FakeGateway('selfhosted').start()
    process.env.SELFHOSTED_URL = gw.url
    try {
      const user = await newUser()
      const job = await createJob({ userId: user.id, prompt: 'a paper lantern over black water' })
      gw.pollScript = [
        { status: 'queued' },
        { status: 'running', progress: 30 },
        { status: 'succeeded', video_url: `${gw.url}/clip.mp4`, frames: [`${gw.url}/f1.png`] },
      ]

      const result = await processJob(job.id)
      expect(result.status).toBe('completed')
      expect(result.progress).toBe(100)

      // submitted exactly once, polled through the script
      expect(gw.submits).toHaveLength(1)
      expect(gw.polls.length).toBeGreaterThanOrEqual(3)

      // the generation row records the hosted provider
      const generation = await db.generation.findFirst({ where: { jobId: job.id } })
      expect(generation?.provider).toBe('selfhosted')
      expect(generation?.status).toBe('succeeded')

      // the MP4 was ingested from the gateway, byte-identical
      const videoAsset = await db.asset.findFirst({
        where: { jobId: job.id, kind: 'video', variantKey: 'main' },
      })
      expect(videoAsset?.path).toMatch(/-provider\.mp4$/)
      expect((await fileBytes(videoAsset!.path))?.equals(CLIP)).toBe(true)
      expect(generation?.videoPath).toBe(videoAsset?.path)

      // the remote keyframe was ingested too and recorded on the timeline
      const frameAsset = await db.asset.findFirst({
        where: { jobId: job.id, kind: 'frame', path: { not: { startsWith: 'http' } } },
      })
      expect(frameAsset).toBeTruthy()
      expect(JSON.parse(generation!.framesJson)).toContain(frameAsset!.path)
      expect((await fileBytes(frameAsset!.path))?.equals(FRAME)).toBe(true)
    } finally {
      await gw.close()
    }
  })

  it('forwards the full Somnia job payload to the gateway', async () => {
    const gw = await new FakeGateway('selfhosted').start()
    process.env.SELFHOSTED_URL = gw.url
    try {
      const user = await newUser()
      // 1080p × 10s costs 2400 — top the trial balance up for the fidelity spec
      await topup({ userId: user.id, amount: 5_000, note: 'providers spec top-up' })
      const job = await createJob({
        userId: user.id,
        prompt: 'a fox crossing a rooftop at dusk',
        durationSec: 10,
        aspectRatio: '9:16',
        resolution: '1080p',
        hdr: true,
        loop: true,
        startFrame: PNG_1PX,
        endFrame: PNG_1PX,
      })
      const done = await processJob(job.id)
      expect(done.status).toBe('completed')

      const body = gw.submits[0]?.body
      expect(body).toBeTruthy()
      expect(body!.model).toBe('wan2.2-t2v-5b') // SELFHOSTED_MODEL default
      expect(body!.prompt).toBe('a fox crossing a rooftop at dusk')
      expect(body!.duration_sec).toBe(10)
      expect(body!.aspect_ratio).toBe('9:16')
      expect(body!.resolution).toBe('1080p')
      expect(body!.hdr).toBe(true)
      expect(body!.loop).toBe(true)
      expect(body!.start_frame).toBe(job.startFramePath)
      expect(body!.end_frame).toBe(job.endFramePath)
      expect(body!.keyframes).toEqual([]) // prompt-only job: the timeline is empty, not missing
    } finally {
      await gw.close()
    }
  })

  it('mirrors remote progress into the job row while polling', async () => {
    const gw = await new FakeGateway('selfhosted').start()
    process.env.SELFHOSTED_URL = gw.url
    gw.pollScript = [
      { status: 'queued' },
      { status: 'running', progress: 40 },
      { status: 'running', progress: 70 },
      { status: 'succeeded', video_url: `${gw.url}/clip.mp4`, frames: [] },
    ]
    try {
      const user = await newUser()
      const job = await createJob({ userId: user.id, prompt: 'slow render, watched closely' })
      gw.watchJobId = job.id

      const done = await processJob(job.id)
      expect(done.status).toBe('completed')

      // the gateway observed the mirrored progress before completion:
      // some poll saw the row at >= 40% and a later one at >= 70%
      expect(gw.observedProgress.some((p) => p >= 40)).toBe(true)
      expect(gw.observedProgress.some((p) => p >= 70)).toBe(true)
      expect(gw.observedProgress.every((p) => p <= 92)).toBe(true)
    } finally {
      await gw.close()
    }
  })

  it('marks the job failed and refunds when the gateway reports failure', async () => {
    const gw = await new FakeGateway('selfhosted').start()
    process.env.SELFHOSTED_URL = gw.url
    gw.pollScript = [
      { status: 'queued' },
      { status: 'failed', error: 'CUDA out of memory on worker 3' },
    ]
    try {
      const user = await newUser()
      const before = await balance(user.id)
      const job = await createJob({ userId: user.id, prompt: 'a doomed hosted render' })
      expect(await balance(user.id)).toBe(before - 100)

      const done = await processJob(job.id)
      expect(done.status).toBe('failed')
      expect(done.errorMessage).toContain('CUDA out of memory')
      expect(await balance(user.id)).toBe(before) // refunded in full

      const generation = await db.generation.findFirst({ where: { jobId: job.id } })
      expect(generation?.status).toBe('failed')
      expect(
        await db.asset.findFirst({ where: { jobId: job.id, kind: 'video' } })
      ).toBeNull()
    } finally {
      await gw.close()
    }
  })

  it('fails and refunds when the gateway never finishes (poll timeout)', async () => {
    const gw = await new FakeGateway('selfhosted').start()
    process.env.SELFHOSTED_URL = gw.url
    process.env.PROVIDER_POLL_TIMEOUT_MS = '250'
    gw.pollScript = Array.from({ length: 50 }, () => ({ status: 'queued' }))
    try {
      const user = await newUser()
      const before = await balance(user.id)
      const job = await createJob({ userId: user.id, prompt: 'a render that never lands' })

      const done = await processJob(job.id)
      expect(done.status).toBe('failed')
      expect(done.errorMessage).toMatch(/timed out/i)
      expect(await balance(user.id)).toBe(before)
    } finally {
      await gw.close()
    }
  })

  it('fails and refunds when the gateway rejects the submission', async () => {
    const gw = await new FakeGateway('selfhosted').start()
    process.env.SELFHOSTED_URL = gw.url
    gw.submitStatus = 500
    try {
      const user = await newUser()
      const before = await balance(user.id)
      const job = await createJob({ userId: user.id, prompt: 'a rejected submission' })

      const done = await processJob(job.id)
      expect(done.status).toBe('failed')
      expect(done.errorMessage).toContain('500')
      expect(await balance(user.id)).toBe(before)
    } finally {
      await gw.close()
    }
  })

  it('sends the bearer API key to a secured gateway', async () => {
    const gw = await new FakeGateway('selfhosted').start()
    process.env.SELFHOSTED_URL = gw.url
    process.env.SELFHOSTED_API_KEY = 'sekrit-gw-token'
    try {
      const user = await newUser()
      const job = await createJob({ userId: user.id, prompt: 'an authenticated render' })
      const done = await processJob(job.id)
      expect(done.status).toBe('completed')
      expect(gw.submits[0]?.authorization).toBe('Bearer sekrit-gw-token')
    } finally {
      await gw.close()
    }
  })

  // ------------------------------------------------ T15 transient-hiccup resilience
  // A real self-hosted gateway restarts (sandbox recycle, supervisor respawn):
  // the edge answers 401/502/503 for a moment, and single status polls can
  // fail transiently. The adapter rides those out instead of failing a paid,
  // charged render on a one-off blip.

  it('retries the submission once when the gateway hiccups transiently', async () => {
    const gw = await new FakeGateway('selfhosted').start()
    process.env.SELFHOSTED_URL = gw.url
    gw.submitFailures = 1 // first submit → 503, second → 202
    try {
      const user = await newUser()
      const job = await createJob({ userId: user.id, prompt: 'a render past a gateway restart blip' })

      const done = await processJob(job.id)
      expect(done.status).toBe('completed')
      expect(gw.submits).toHaveLength(2) // exactly one retry — never a blind hammer
      expect(gw.polls.length).toBeGreaterThanOrEqual(1)
    } finally {
      await gw.close()
    }
  })

  it('rides out transient status-poll failures while polling', async () => {
    const gw = await new FakeGateway('selfhosted').start()
    process.env.SELFHOSTED_URL = gw.url
    gw.pollFailures = 2 // two leading 500 polls, then the script
    gw.pollScript = [{ status: 'succeeded', video_url: `${gw.url}/clip.mp4`, frames: [] }]
    try {
      const user = await newUser()
      const job = await createJob({ userId: user.id, prompt: 'a render past edge blips' })

      const done = await processJob(job.id)
      expect(done.status).toBe('completed')
      expect(gw.polls.length).toBeGreaterThanOrEqual(3)
    } finally {
      await gw.close()
    }
  })

  it('fails and refunds when poll errors persist beyond the tolerance', async () => {
    const gw = await new FakeGateway('selfhosted').start()
    process.env.SELFHOSTED_URL = gw.url
    gw.pollFailures = 99 // every poll 500s forever
    try {
      const user = await newUser()
      const before = await balance(user.id)
      const job = await createJob({ userId: user.id, prompt: 'a gateway that stays down' })

      const done = await processJob(job.id)
      expect(done.status).toBe('failed')
      expect(done.errorMessage).toContain('500')
      expect(await balance(user.id)).toBe(before)
      expect(gw.polls.length).toBeLessThanOrEqual(5) // tolerance (2) + the failing throw, not a full timeout grind
    } finally {
      await gw.close()
    }
  })
})

// ---------------------------------------------------------------- fal queue

describe('providers — fal queue adapter', () => {
  it('renders through the fal queue with Key auth and polls to completion', async () => {
    const gw = await new FakeGateway('fal').start()
    process.env.FAL_KEY = 'test-fal-key'
    process.env.FAL_QUEUE_BASE = gw.url
    process.env.FAL_MODEL = 'fal-ai/wan-t2v'
    gw.pollScript = [
      { status: 'IN_QUEUE' },
      { status: 'IN_PROGRESS' },
      { status: 'COMPLETED' },
    ]
    gw.falResult = {
      video: { url: `${gw.url}/clip.mp4` },
      frames: [{ url: `${gw.url}/f1.png` }, { url: `${gw.url}/f2.png` }],
    }
    try {
      const user = await newUser()
      const job = await createJob({ userId: user.id, prompt: 'a comet over the salton sea' })
      const done = await processJob(job.id)

      expect(done.status).toBe('completed')
      expect(done.progress).toBe(100)

      // submit hit the model path with Key auth
      expect(gw.submits).toHaveLength(1)
      expect(gw.submits[0]!.url).toBe('/fal-ai/wan-t2v')
      expect(gw.submits[0]!.authorization).toBe('Key test-fal-key')

      // status polled at least once before the result fetch
      expect(gw.polls.length).toBeGreaterThanOrEqual(2)

      const generation = await db.generation.findFirst({ where: { jobId: job.id } })
      expect(generation?.provider).toBe('fal')
      expect(generation?.status).toBe('succeeded')

      const videoAsset = await db.asset.findFirst({
        where: { jobId: job.id, kind: 'video', variantKey: 'main' },
      })
      expect((await fileBytes(videoAsset!.path))?.equals(CLIP)).toBe(true)

      // both remote frames were ingested and recorded on the timeline
      const frames = JSON.parse(generation!.framesJson) as string[]
      expect(frames).toHaveLength(2)
      expect(frames.every((p) => p.startsWith('/generated/'))).toBe(true)
    } finally {
      await gw.close()
    }
  })

  it('fails and refunds when the fal status endpoint errors', async () => {
    const gw = await new FakeGateway('fal').start()
    process.env.FAL_KEY = 'test-fal-key'
    process.env.FAL_QUEUE_BASE = gw.url
    gw.submitStatus = 500
    try {
      const user = await newUser()
      const before = await balance(user.id)
      const job = await createJob({ userId: user.id, prompt: 'a fal submission that bounces' })

      const done = await processJob(job.id)
      expect(done.status).toBe('failed')
      expect(await balance(user.id)).toBe(before)
    } finally {
      await gw.close()
    }
  })
})

// ---------------------------------------------------------------- pipeline split

describe('providers — pipeline routing', () => {
  it('keeps image jobs on the local prism path even with a provider configured', async () => {
    const gw = await new FakeGateway('selfhosted').start()
    process.env.SELFHOSTED_URL = gw.url
    try {
      const user = await newUser()
      const job = await createJob({
        userId: user.id,
        kind: 'image',
        prompt: 'a still of ember orchids',
      })
      const { source, calls } = fakeFrameSource()

      const done = await processJob(job.id, { frameSource: source })
      expect(done.status).toBe('completed')
      expect(calls).toHaveLength(1) // prism stills stay local
      expect(gw.submits).toHaveLength(0) // never touched the gateway

      const generation = await db.generation.findFirst({ where: { jobId: job.id } })
      expect(generation?.provider).toBe('demo')
      const poster = await db.asset.findFirst({
        where: { jobId: job.id, kind: 'poster', variantKey: 'main' },
      })
      expect(poster).toBeTruthy()
    } finally {
      await gw.close()
    }
  })

  it('routes pinned-timeline video jobs through the provider with the full timeline', async () => {
    const gw = await new FakeGateway('selfhosted').start()
    process.env.SELFHOSTED_URL = gw.url
    try {
      const user = await newUser()
      const job = await createJob({
        userId: user.id,
        prompt: 'a journey pinned at both ends',
        keyframes: [
          { dataUrl: PNG_1PX, name: 'f1.png' },
          { dataUrl: PNG_1PX, name: 'f2.png' },
          { dataUrl: PNG_1PX, name: 'f3.png' },
        ],
      })
      const { source, calls } = fakeFrameSource()

      const done = await processJob(job.id, { frameSource: source })
      expect(done.status).toBe('completed')
      expect(calls).toHaveLength(0) // hosted model renders the clip, not the storyboard

      const body = gw.submits[0]?.body
      expect(body!.start_frame).toBe(job.startFramePath)
      expect(body!.end_frame).toBe(job.endFramePath)

      // T15 pinned-timeline fidelity: the gateway receives EVERY pinned frame in
      // timeline order, not just the mirrored first/last — a hosted render must
      // composite the user's own imagery, never silently regenerate it.
      const pinned = await db.keyframe.findMany({
        where: { jobId: job.id },
        orderBy: { order: 'asc' },
      })
      expect(pinned).toHaveLength(3)
      expect(body!.keyframes).toEqual(pinned.map((k) => k.path))
    } finally {
      await gw.close()
    }
  })
})
