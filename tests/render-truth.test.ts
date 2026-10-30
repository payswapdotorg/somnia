// tests/render-truth.test.ts — T14: render truth.
//
// The demo tier's honest-placeholder contract, pinned end to end:
//
//   1. pipeline — when the frame source degrades to placeholder art the
//      completed job is FLAGGED (Job.placeholderRender) instead of quietly
//      posing as a real render; real imagery, pinned timelines and hosted
//      renders stay unflagged.
//   2. DTOs — the flag flows to the owner job detail, the public share
//      payload and the ideas feed, so every surface can tell the truth.
//   3. health — imageSdkAvailable reports whether the local image SDK can
//      initialize in this deployment (hermetic under SOMNIA_TEST; boolean
//      only, same rule as every other provider knob).
import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { db } from '@/lib/db'
import { signup } from '@/lib/auth'
import { createJob, getJob } from '@/lib/engine'
import { processJob, imageSdkProbe, __resetImageSdkProbe, type FrameSource } from '@/lib/pipeline'
import { shareJob, getSharedJob, listIdeas } from '@/lib/social'
import { dispatchSomnia } from '@/lib/somnia-api'
import type { HostedVideoProvider } from '@/lib/providers'

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function solidPng(color: string): Promise<Buffer> {
  return sharp({ create: { width: 128, height: 128, channels: 3, background: color } })
    .png()
    .toBuffer()
}

let seq = 0
async function newUser() {
  const { user } = await signup({
    email: `truth${Date.now()}-${++seq}@somnia.test`,
    password: 'password123',
  })
  return user
}

/** FrameSource fake — returns a real buffer for the first `real` calls, null after. */
function degradingSource(real: number) {
  let calls = 0
  const source: FrameSource = {
    async generate() {
      calls += 1
      return calls <= real ? solidPng('#1e3a5f') : null
    },
  }
  return source
}

/** Minimal hosted provider fake — a real remote MP4 by definition. */
const fakeHosted: HostedVideoProvider = {
  name: 'fal',
  get configured() {
    return true
  },
  async render() {
    return { videoPath: '/generated/hosted.mp4', frames: [] }
  },
}

// ------------------------------------------------- pipeline — the flag

describe('pipeline — placeholderRender flag', () => {
  it('flags a video job when every beat degrades to placeholder art', async () => {
    const user = await newUser()
    const job = await createJob({ userId: user.id, prompt: 'a lantern over black water' })
    const done = await processJob(job.id, { frameSource: degradingSource(0) })

    expect(done.status).toBe('completed')
    expect(done.placeholderRender).toBe(true)
    // the composite still rendered — a real, seekable MP4 of simulated art
    const videoAsset = await db.asset.findFirst({
      where: { jobId: job.id, kind: 'video', variantKey: 'main' },
    })
    expect(videoAsset).toBeTruthy()
  })

  it('keeps the flag false when every beat renders real imagery', async () => {
    const user = await newUser()
    const job = await createJob({ userId: user.id, prompt: 'neon rain on chrome' })
    const done = await processJob(job.id, { frameSource: degradingSource(10) })

    expect(done.status).toBe('completed')
    expect(done.placeholderRender).toBe(false)
  })

  it('flags mixed degradation — one placeholder beat flags the render', async () => {
    const user = await newUser()
    const job = await createJob({ userId: user.id, prompt: 'foggy polder at dawn' })
    // 5s → 3 beats; the first two render, the third degrades
    const done = await processJob(job.id, { frameSource: degradingSource(2) })

    expect(done.status).toBe('completed')
    expect(done.placeholderRender).toBe(true)
  })

  it('flags prism stills that degrade to the placeholder', async () => {
    const user = await newUser()
    const job = await createJob({ userId: user.id, prompt: 'chrome dunes at dusk', kind: 'image' })
    const done = await processJob(job.id, { frameSource: degradingSource(0) })

    expect(done.status).toBe('completed')
    expect(done.placeholderRender).toBe(true)
  })

  it('keeps pinned-timeline jobs unflagged — user imagery, nothing simulated', async () => {
    const user = await newUser()
    const job = await createJob({
      userId: user.id,
      prompt: 'paper boat journey',
      keyframes: [
        { dataUrl: PNG_1PX, name: 'f1.png' },
        { dataUrl: PNG_1PX, name: 'f2.png' },
      ],
    })
    const done = await processJob(job.id, { frameSource: degradingSource(0) })

    expect(done.status).toBe('completed')
    expect(done.placeholderRender).toBe(false)
  })

  it('leaves hosted-tier renders unflagged — a remote MP4 is real by definition', async () => {
    const user = await newUser()
    const job = await createJob({ userId: user.id, prompt: 'hosted render' })
    const done = await processJob(job.id, { provider: fakeHosted })

    expect(done.status).toBe('completed')
    expect(done.placeholderRender).toBe(false)
  })

  it('defaults to false at creation — nothing is claimed before rendering', async () => {
    const user = await newUser()
    const job = await createJob({ userId: user.id, prompt: 'queued dream' })
    expect(job.placeholderRender).toBe(false)
  })
})

// ------------------------------------------------- DTOs — the truth flows

describe('render truth — DTOs', () => {
  it('carries the flag on the owner job detail (getJob DTO)', async () => {
    const user = await newUser()
    const job = await createJob({ userId: user.id, prompt: 'a lantern over black water' })
    await processJob(job.id, { frameSource: degradingSource(0) })

    const detail = await getJob(user.id, job.id)
    expect(detail?.placeholderRender).toBe(true)
  })

  it('carries the flag on the public share payload', async () => {
    const user = await newUser()
    const job = await createJob({ userId: user.id, prompt: 'a lantern over black water' })
    await processJob(job.id, { frameSource: degradingSource(0) })
    const { token } = await shareJob(user.id, job.id)

    const payload = await getSharedJob(token!)
    expect(payload?.job.placeholderRender).toBe(true)
  })

  it('carries the flag on the ideas feed items', async () => {
    const user = await newUser()
    const real = await createJob({ userId: user.id, prompt: 'real dream' })
    const simulated = await createJob({ userId: user.id, prompt: 'simulated dream' })
    await processJob(real.id, { frameSource: degradingSource(10) })
    await processJob(simulated.id, { frameSource: degradingSource(0) })
    await shareJob(user.id, real.id)
    await shareJob(user.id, simulated.id)

    const { items } = await listIdeas({})
    const byPrompt = new Map(items.map((i) => [i.prompt, i.placeholderRender]))
    expect(byPrompt.get('real dream')).toBe(false)
    expect(byPrompt.get('simulated dream')).toBe(true)
  })
})

// ------------------------------------------------- health — SDK probe

describe('health — imageSdkAvailable', () => {
  it('reports false hermetically under SOMNIA_TEST (the suite never touches the SDK)', async () => {
    __resetImageSdkProbe()
    await expect(imageSdkProbe()).resolves.toBe(false)
  })

  it('drives the cached probe from an injected initializer', async () => {
    __resetImageSdkProbe()
    await expect(imageSdkProbe(async () => true)).resolves.toBe(true)
    // cached — the initializer is not re-run
    await expect(imageSdkProbe(async () => false)).resolves.toBe(true)
    __resetImageSdkProbe()
    await expect(imageSdkProbe(async () => false)).resolves.toBe(false)
  })

  it('exposes the boolean on GET /api/providers/health (never more than a boolean)', async () => {
    __resetImageSdkProbe()
    const res = await dispatchSomnia(
      new Request('http://localhost/api/providers/health', { method: 'GET' }),
      ['providers', 'health']
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(typeof body.imageSdkAvailable).toBe('boolean')
  })
})
