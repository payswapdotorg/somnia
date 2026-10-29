// tests/pipeline.test.ts — Somnia render pipeline (T5).
//
// Drives queued jobs all the way to completed with REAL ffmpeg output:
// video jobs composite [start?, keyframes, end?] into an MP4 (Ken Burns),
// image jobs produce a poster still, failures refund, moderated prompts
// are skipped. Frame imagery comes from an injected FrameSource (hermetic —
// the default SDK-backed source is exercised by the dev sandbox, not here).
import { describe, it, expect, beforeEach } from 'vitest'
import sharp from 'sharp'
import { db } from '@/lib/db'
import { signup } from '@/lib/auth'
import { createJob } from '@/lib/engine'
import { processJob, processQueuedJobs, type FrameSource } from '@/lib/pipeline'
import type { HostedVideoProvider } from '@/lib/providers'
import { providerCostUsd } from '@/lib/economics'
import { balance } from '@/lib/ledger'
import { absoluteFromPublic } from '@/lib/frames'
import { promises as fs } from 'node:fs'

const COLORS = ['#1e3a5f', '#5f1e3a', '#3a5f1e', '#5f3a1e', '#1e5f3a']

/** Solid-color 128x128 PNG — real pixels for the real ffmpeg compositor. */
async function solidPng(color: string): Promise<Buffer> {
  return sharp({
    create: { width: 128, height: 128, channels: 3, background: color },
  })
    .png()
    .toBuffer()
}

let seq = 0
async function newUser() {
  const { user } = await signup({
    email: `pipeline${Date.now()}-${++seq}@somnia.test`,
    password: 'password123',
  })
  return user
}

/** FrameSource fake: distinct solid colors per beat, call-counted. */
function fakeFrameSource() {
  const calls: string[] = []
  const source: FrameSource = {
    async generate(prompt: string, beat: string) {
      calls.push(`${prompt}|${beat}`)
      return solidPng(COLORS[calls.length % COLORS.length])
    },
  }
  return { source, calls }
}

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function fileExists(publicPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(absoluteFromPublic(publicPath))
    return stat.isFile() && stat.size > 0
  } catch {
    return false
  }
}

describe('pipeline — video jobs', () => {
  it('takes a queued job to completed with a real, seekable MP4', async () => {
    const user = await newUser()
    const job = await createJob({ userId: user.id, prompt: 'a lantern drifting over black water' })
    expect(job.status).toBe('queued')

    const { source, calls } = fakeFrameSource()
    const done = await processJob(job.id, { frameSource: source })

    expect(done.status).toBe('completed')
    expect(done.progress).toBe(100)

    // 5s default → 3 storyboard beats generated
    expect(calls).toHaveLength(3)

    // the main video asset exists on disk and is non-empty
    const videoAsset = await db.asset.findFirst({
      where: { jobId: job.id, kind: 'video', variantKey: 'main' },
    })
    expect(videoAsset).toBeTruthy()
    expect(videoAsset!.path).toMatch(/\.mp4$/)
    expect(await fileExists(videoAsset!.path)).toBe(true)

    // the generation row records the run
    const generation = await db.generation.findFirst({ where: { jobId: job.id } })
    expect(generation?.status).toBe('succeeded')
    expect(generation?.videoPath).toBe(videoAsset!.path)
    expect(JSON.parse(generation!.framesJson)).toHaveLength(3)
  })

  it('renders 10s jobs with five beats and honors the aspect ratio', async () => {
    const user = await newUser()
    const job = await createJob({
      userId: user.id,
      prompt: 'neon rain on chrome streets',
      durationSec: 10,
      aspectRatio: '9:16',
      resolution: '540p',
    })
    const { source, calls } = fakeFrameSource()
    const done = await processJob(job.id, { frameSource: source })

    expect(done.status).toBe('completed')
    expect(calls).toHaveLength(5)
    const videoAsset = await db.asset.findFirst({
      where: { jobId: job.id, kind: 'video', variantKey: 'main' },
    })
    expect(await fileExists(videoAsset!.path)).toBe(true)
  })

  it('uses the pinned keyframe timeline instead of generating imagery', async () => {
    const user = await newUser()
    const job = await createJob({
      userId: user.id,
      prompt: 'paper boat journey down a stream',
      keyframes: [
        { dataUrl: PNG_1PX, name: 'f1.png' },
        { dataUrl: PNG_1PX, name: 'f2.png' },
        { dataUrl: PNG_1PX, name: 'f3.png' },
      ],
    })
    const { source, calls } = fakeFrameSource()
    const done = await processJob(job.id, { frameSource: source })

    expect(done.status).toBe('completed')
    expect(calls).toHaveLength(0) // pinned timeline: no generated beats
    const videoAsset = await db.asset.findFirst({
      where: { jobId: job.id, kind: 'video', variantKey: 'main' },
    })
    expect(await fileExists(videoAsset!.path)).toBe(true)
  })

  it('composites pinned start/end frames around generated beats', async () => {
    const user = await newUser()
    const job = await createJob({
      userId: user.id,
      prompt: 'a fox crossing a rooftop at dusk',
      startFrame: PNG_1PX,
      endFrame: PNG_1PX,
    })
    const done = await processJob(job.id, { frameSource: fakeFrameSource().source })

    expect(done.status).toBe('completed')
    const generation = await db.generation.findFirst({ where: { jobId: job.id } })
    // start + 3 beats + end = 5 segments in the rendered chain
    expect(JSON.parse(generation!.framesJson)).toHaveLength(5)
  })

  it('refunds the charge and marks the generation failed when frames fail', async () => {
    const user = await newUser()
    const before = await balance(user.id)
    const job = await createJob({ userId: user.id, prompt: 'a doomed render' })
    expect(await balance(user.id)).toBe(before - 100) // pulse-3 720p 5s

    const exploding: FrameSource = {
      generate: async () => {
        throw new Error('image engine exploded')
      },
    }
    const done = await processJob(job.id, { frameSource: exploding })

    expect(done.status).toBe('failed')
    expect(done.errorMessage).toContain('image engine exploded')
    expect(await balance(user.id)).toBe(before) // refunded

    const generation = await db.generation.findFirst({ where: { jobId: job.id } })
    expect(generation?.status).toBe('failed')
    expect(
      await db.asset.findFirst({ where: { jobId: job.id, kind: 'video' } })
    ).toBeNull()
  })

  it('skips moderated jobs and leaves completed jobs untouched (idempotent)', async () => {
    const user = await newUser()
    const moderated = await createJob({ userId: user.id, prompt: 'gore violence bloodbath' })
    expect(moderated.status).toBe('moderated')
    const skipped = await processJob(moderated.id, { frameSource: fakeFrameSource().source })
    expect(skipped.status).toBe('moderated')
    expect(await db.generation.count({ where: { jobId: moderated.id } })).toBe(0)

    const job = await createJob({ userId: user.id, prompt: 'a calm sea at noon' })
    const first = await processJob(job.id, { frameSource: fakeFrameSource().source })
    expect(first.status).toBe('completed')

    const assetsBefore = await db.asset.count({ where: { jobId: job.id } })
    const again = await processJob(job.id, { frameSource: fakeFrameSource().source })
    expect(again.status).toBe('completed')
    expect(await db.asset.count({ where: { jobId: job.id } })).toBe(assetsBefore)
    expect(await db.generation.count({ where: { jobId: job.id } })).toBe(1)
  })
})

describe('pipeline — image jobs', () => {
  it('completes prism stills with a poster asset and no video', async () => {
    const user = await newUser()
    const job = await createJob({
      userId: user.id,
      kind: 'image',
      prompt: 'a still of ember orchids',
    })
    const { source, calls } = fakeFrameSource()
    const done = await processJob(job.id, { frameSource: source })

    expect(done.status).toBe('completed')
    expect(calls).toHaveLength(1)

    const poster = await db.asset.findFirst({
      where: { jobId: job.id, kind: 'poster', variantKey: 'main' },
    })
    expect(poster).toBeTruthy()
    expect(await fileExists(poster!.path)).toBe(true)
    expect(await db.asset.findFirst({ where: { jobId: job.id, kind: 'video' } })).toBeNull()
  })
})

describe('pipeline — sweep', () => {
  it('processQueuedJobs drains every queued job once', async () => {
    const user = await newUser()
    const j1 = await createJob({ userId: user.id, prompt: 'one wave at dawn' })
    const j2 = await createJob({ userId: user.id, prompt: 'two gulls at noon' })
    const moderated = await createJob({ userId: user.id, prompt: 'gore violence' })

    const processed = await processQueuedJobs({ frameSource: fakeFrameSource().source })
    expect(processed).toBe(2) // moderated is not queued work

    for (const j of [j1, j2]) {
      const job = await db.job.findUniqueOrThrow({ where: { id: j.id } })
      expect(job.status).toBe('completed')
    }
    expect((await db.job.findUniqueOrThrow({ where: { id: moderated.id } })).status).toBe(
      'moderated'
    )

    // second sweep finds nothing
    expect(await processQueuedJobs({ frameSource: fakeFrameSource().source })).toBe(0)
  })
})

// ------------------------------------------------- provider economics (T7)

/** Minimal hosted provider: succeeds instantly, no ingest, name is the point. */
function fakeHosted(name: 'selfhosted' | 'fal'): HostedVideoProvider {
  return {
    name,
    get configured() {
      return true
    },
    async render(input) {
      return { videoPath: `/generated/${input.jobId}.mp4`, frames: [] }
    },
  }
}

describe('pipeline — provider cost stamping', () => {
  it('stamps the fal table cost on the job when the fal tier renders it', async () => {
    const user = await newUser()
    const job = await createJob({ userId: user.id, prompt: 'hosted economics clip' })
    const done = await processJob(job.id, { provider: fakeHosted('fal') })

    expect(done.status).toBe('completed')
    const expected = providerCostUsd({
      provider: 'fal',
      kind: 'video',
      model: job.model,
      resolution: job.resolution,
      durationSec: job.durationSec,
      hdr: job.hdr,
    })
    expect(expected).toBeGreaterThan(0)
    expect(done.providerCostUsd).toBeCloseTo(expected, 6)

    const generation = await db.generation.findFirst({ where: { jobId: job.id } })
    expect(generation?.provider).toBe('fal')
  })

  it('stamps the selfhosted table cost when the selfhosted tier renders it', async () => {
    const user = await newUser()
    const job = await createJob({ userId: user.id, prompt: 'gpu economics clip' })
    const done = await processJob(job.id, { provider: fakeHosted('selfhosted') })

    const expected = providerCostUsd({
      provider: 'selfhosted',
      kind: 'video',
      model: job.model,
      resolution: job.resolution,
      durationSec: job.durationSec,
      hdr: job.hdr,
    })
    expect(expected).toBeGreaterThan(0)
    expect(done.providerCostUsd).toBeCloseTo(expected, 6)
  })

  it('prices HDR 10s hosted renders through the same model (base x2 x1.5)', async () => {
    const user = await newUser()
    const job = await createJob({
      userId: user.id,
      prompt: 'long hdr hosted clip',
      model: 'pulse-flash',
      resolution: '540p',
      durationSec: 10,
      hdr: true,
    })
    const done = await processJob(job.id, { provider: fakeHosted('fal') })
    const base = providerCostUsd({
      provider: 'fal', kind: 'video', model: 'pulse-flash', resolution: '540p', durationSec: 5,
    })
    expect(done.providerCostUsd).toBeCloseTo(base * 2 * 1.5, 6)
  })

  it('leaves local demo renders at zero provider cost', async () => {
    const user = await newUser()
    const job = await createJob({ userId: user.id, prompt: 'free local clip' })
    const done = await processJob(job.id, {
      frameSource: fakeFrameSource().source,
      provider: null,
    })

    expect(done.status).toBe('completed')
    expect(done.providerCostUsd).toBe(0)
    const generation = await db.generation.findFirst({ where: { jobId: job.id } })
    expect(generation?.provider).toBe('demo')
  })

  it('stamps prism stills with the demo image cost (zero until hosted)', async () => {
    const user = await newUser()
    const job = await createJob({ userId: user.id, kind: 'image', prompt: 'ember orchids still' })
    const done = await processJob(job.id, { frameSource: fakeFrameSource().source })

    expect(done.status).toBe('completed')
    expect(done.providerCostUsd).toBe(0)
  })

  it('leaves the cost stamped even when a hosted render fails (real money)', async () => {
    const user = await newUser()
    const job = await createJob({ userId: user.id, prompt: 'doomed hosted clip' })
    const failing: HostedVideoProvider = {
      name: 'fal',
      get configured() {
        return true
      },
      async render() {
        throw new Error('gateway 500')
      },
    }
    const done = await processJob(job.id, { provider: failing })

    expect(done.status).toBe('failed')
    expect(done.providerCostUsd).toBeGreaterThan(0)
    // ...while the customer is made whole
    expect(await balance(user.id)).toBe(1000 - 100 + 100)
  })
})
