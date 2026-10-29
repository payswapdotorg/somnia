// tests/engine.test.ts — TDD RED first.
// The generation engine: job creation with full parameter validation and
// charging, 1..16 ordered keyframes, loop/HDR flags, image mode, extend /
// modify lineage, reframe + upscale transforms (idempotent), refund-on-failure,
// and the job DTO.
import { describe, expect, it, beforeEach } from 'vitest'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { db } from '@/lib/db'
import {
  createJob,
  extendJob,
  modifyJob,
  reframeJob,
  upscaleJob,
  markJobFailed,
  markJobCompleted,
  getJob,
} from '@/lib/engine'

const EMAIL = 'engine-test@somnia.test'
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function seedUser(credits = 1_000) {
  return db.user.create({
    data: { email: EMAIL, name: 'Engine Tester', credits },
  })
}

async function seedCompletedJob(userId: string, overrides: Record<string, unknown> = {}) {
  return db.job.create({
    data: {
      userId,
      prompt: 'a lantern drifting over still water',
      status: 'completed',
      progress: 100,
      idempotencyKey: `seed-${Math.random().toString(36).slice(2)}`,
      ...overrides,
    },
  })
}

beforeEach(async () => {
  await db.user.deleteMany({ where: { email: EMAIL } })
})

describe('engine — createJob (text-to-video)', () => {
  it('creates a charged queued job with sane defaults', async () => {
    const user = await seedUser()
    const job = await createJob({ userId: user.id, prompt: 'a lantern drifting over water' })
    expect(job.status).toBe('queued')
    expect(job.model).toBe('pulse-3')
    expect(job.resolution).toBe('720p')
    expect(job.aspectRatio).toBe('16:9')
    expect(job.durationSec).toBe(5)
    expect(job.hdr).toBe(false)
    expect(job.loop).toBe(false)
    expect(job.kind).toBe('video')
    expect(job.creditsCharged).toBe(100)
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      credits: 900,
    })
  })

  it('records exactly one spend ledger row', async () => {
    const user = await seedUser()
    await createJob({ userId: user.id, prompt: 'a lantern drifting over water' })
    const spends = await db.creditTransaction.findMany({
      where: { userId: user.id, kind: 'spend' },
    })
    expect(spends).toHaveLength(1)
    expect(spends[0].amount).toBe(-100)
  })

  it('rejects unknown model / resolution / duration / aspect and never charges', async () => {
    const user = await seedUser()
    const cases = [
      { model: 'pulse-99' },
      { resolution: '4k' },
      { durationSec: 7 },
      { aspectRatio: '4:5' },
    ] as Record<string, unknown>[]
    for (const extra of cases) {
      await expect(
        createJob({ userId: user.id, prompt: 'a lantern drifting over water', ...extra } as never)
      ).rejects.toThrow()
    }
    expect(await db.job.count({ where: { userId: user.id } })).toBe(0)
    expect(await db.creditTransaction.count({ where: { userId: user.id, kind: 'spend' } })).toBe(0)
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).credits
    ).toBe(1_000)
  })

  it('rejects empty prompts', async () => {
    const user = await seedUser()
    await expect(createJob({ userId: user.id, prompt: '  ' })).rejects.toThrow(/prompt/i)
  })

  it('refuses to create when credits are insufficient (no job, no ledger row)', async () => {
    const user = await seedUser(50)
    await expect(createJob({ userId: user.id, prompt: 'a lantern drifting over water' })).rejects.toThrow(/insufficient/i)
    expect(await db.job.count({ where: { userId: user.id } })).toBe(0)
  })

  it('is idempotent under a repeated idempotency key', async () => {
    const user = await seedUser()
    const one = await createJob({
      userId: user.id, prompt: 'a lantern drifting over water', idempotencyKey: 'dup-1',
    })
    const two = await createJob({
      userId: user.id, prompt: 'a lantern drifting over water', idempotencyKey: 'dup-1',
    })
    expect(two.id).toBe(one.id)
    expect(await db.job.count({ where: { userId: user.id } })).toBe(1)
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).credits
    ).toBe(900)
  })

  it('doubles the charge for HDR and stores both flags', async () => {
    const user = await seedUser()
    const job = await createJob({
      userId: user.id, prompt: 'a lantern drifting over water', hdr: true, loop: true,
    })
    expect(job.hdr).toBe(true)
    expect(job.loop).toBe(true)
    expect(job.creditsCharged).toBe(200)
  })

  it('flags banned prompts as moderated without charging', async () => {
    const user = await seedUser()
    const job = await createJob({ userId: user.id, prompt: 'extremely nsfw gorefest scene' })
    expect(job.status).toBe('moderated')
    expect(job.creditsCharged).toBe(0)
    expect(
      await db.creditTransaction.count({ where: { userId: user.id, kind: 'spend' } })
    ).toBe(0)
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).credits
    ).toBe(1_000)
  })
})

describe('engine — frames & keyframes', () => {
  it('stores an uploaded start frame on disk and links it', async () => {
    const user = await seedUser()
    const job = await createJob({
      userId: user.id, prompt: 'a lantern drifting over water', startFrame: PNG_1PX,
    })
    expect(job.startFramePath).toMatch(/^\/generated\/.+\.png$/)
    const file = path.join(process.cwd(), 'public', 'generated', path.basename(job.startFramePath!))
    expect(existsSync(file)).toBe(true)
  })

  it('accepts an ordered keyframe timeline of 3 and pins first/last', async () => {
    const user = await seedUser()
    const job = await createJob({
      userId: user.id,
      prompt: 'a lantern drifting over water',
      keyframes: [
        { dataUrl: PNG_1PX, name: 'a.png' },
        { dataUrl: PNG_1PX, name: 'b.png' },
        { dataUrl: PNG_1PX, name: 'c.png' },
      ],
      idempotencyKey: 'kf-1',
    })
    const kfs = await db.keyframe.findMany({ where: { jobId: job.id }, orderBy: { order: 'asc' } })
    expect(kfs.map((k) => k.order)).toEqual([1, 2, 3])
    expect(job.startFramePath).toBe(kfs[0].path)
    expect(job.endFramePath).toBe(kfs[2].path)
  })

  it('rejects a 17-frame timeline before charging', async () => {
    const user = await seedUser()
    const seventeen = Array.from({ length: 17 }, () => ({ dataUrl: PNG_1PX }))
    await expect(
      createJob({ userId: user.id, prompt: 'a lantern drifting over water', keyframes: seventeen } as never)
    ).rejects.toThrow(/16|keyframe/i)
    expect(await db.job.count({ where: { userId: user.id } })).toBe(0)
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).credits
    ).toBe(1_000)
  })
})

describe('engine — image mode (Prism)', () => {
  it('creates a still job charged 20 credits with no duration', async () => {
    const user = await seedUser()
    const job = await createJob({
      userId: user.id, prompt: 'a still orchid under moonlight', kind: 'image',
    })
    expect(job.kind).toBe('image')
    expect(job.model).toBe('prism')
    expect(job.durationSec).toBe(0)
    expect(job.creditsCharged).toBe(20)
  })
})

describe('engine — extend', () => {
  it('extends a completed job at the plain 5s base, seeded from its end frame', async () => {
    const user = await seedUser()
    const source = await seedCompletedJob(user.id, { endFramePath: '/generated/seed-end.png' })
    const ext = await extendJob(user.id, source.id)
    expect(ext.mode).toBe('extend')
    expect(ext.sourceJobId).toBe(source.id)
    expect(ext.startFramePath).toBe('/generated/seed-end.png')
    expect(ext.creditsCharged).toBe(100) // pulse-3 720p base
    expect(ext.prompt.toLowerCase()).toContain('continue')
  })

  it('refuses to extend non-completed jobs', async () => {
    const user = await seedUser()
    const live = await db.job.create({
      data: { userId: user.id, prompt: 'running job', status: 'running', idempotencyKey: 'ext-live' },
    })
    await expect(extendJob(user.id, live.id)).rejects.toThrow(/completed/i)
  })
})

describe('engine — modify (video-to-video)', () => {
  it('creates a modify job charged 5x base, linked to its source', async () => {
    const user = await seedUser()
    const source = await seedCompletedJob(user.id)
    const mod = await modifyJob(user.id, source.id, { instruction: 'restyle as 1970s film grain' })
    expect(mod.mode).toBe('modify')
    expect(mod.sourceJobId).toBe(source.id)
    expect(mod.prompt).toContain('1970s film grain')
    expect(mod.creditsCharged).toBe(500) // 5x pulse-3 720p base
  })
})

describe('engine — transforms', () => {
  it('reframes a completed job for a flat 10 credits, idempotently', async () => {
    const user = await seedUser()
    const job = await seedCompletedJob(user.id)
    const first = await reframeJob(user.id, job.id, '9:16')
    expect(first.kind).toBe('reframe')
    expect(first.variantKey).toBe('reframe-9:16')
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).credits
    ).toBe(990)
    const second = await reframeJob(user.id, job.id, '9:16')
    expect(second.id).toBe(first.id)
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).credits
    ).toBe(990) // no double charge
    expect(await db.asset.count({ where: { jobId: job.id, kind: 'reframe' } })).toBe(1)
  })

  it('upscales a completed job for a flat 200 credits, idempotently', async () => {
    const user = await seedUser()
    const job = await seedCompletedJob(user.id)
    const first = await upscaleJob(user.id, job.id)
    expect(first.kind).toBe('upscale')
    expect(first.variantKey).toBe('upscale-4k')
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).credits
    ).toBe(800)
    const second = await upscaleJob(user.id, job.id)
    expect(second.id).toBe(first.id)
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).credits
    ).toBe(800)
  })

  it('refuses transforms on non-completed jobs', async () => {
    const user = await seedUser()
    const live = await db.job.create({
      data: { userId: user.id, prompt: 'running job', status: 'running', idempotencyKey: 'tr-live' },
    })
    await expect(reframeJob(user.id, live.id, '1:1')).rejects.toThrow(/completed/i)
    await expect(upscaleJob(user.id, live.id)).rejects.toThrow(/completed/i)
  })
})

describe('engine — failure & completion', () => {
  it('refunds the full charge when a job fails, exactly once', async () => {
    const user = await seedUser()
    const job = await createJob({ userId: user.id, prompt: 'a lantern drifting over water' })
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).credits
    ).toBe(900)
    const failed = await markJobFailed(job.id, 'render crashed')
    expect(failed.status).toBe('failed')
    expect(failed.errorMessage).toContain('render crashed')
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).credits
    ).toBe(1_000)
    const refunds = await db.creditTransaction.findMany({
      where: { userId: user.id, kind: 'refund', jobId: job.id },
    })
    expect(refunds).toHaveLength(1)
    expect(refunds[0].amount).toBe(100)
    // second failure call is a no-op
    await markJobFailed(job.id, 'render crashed again')
    expect(
      await db.creditTransaction.count({ where: { userId: user.id, kind: 'refund' } })
    ).toBe(1)
  })

  it('markJobCompleted stores outputs and progress', async () => {
    const user = await seedUser()
    const job = await createJob({ userId: user.id, prompt: 'a lantern drifting over water' })
    const done = await markJobCompleted(job.id, { videoPath: '/generated/x.mp4' })
    expect(done.status).toBe('completed')
    expect(done.progress).toBe(100)
    expect(done.id).toBe(job.id)
  })
})

describe('engine — DTO', () => {
  it('returns the job with ordered keyframes and assets, scoped to the owner', async () => {
    const user = await seedUser()
    const job = await createJob({
      userId: user.id,
      prompt: 'a lantern drifting over water',
      keyframes: [
        { dataUrl: PNG_1PX },
        { dataUrl: PNG_1PX },
      ],
      idempotencyKey: 'dto-1',
    })
    await markJobCompleted(job.id, { videoPath: '/generated/dto.mp4' })
    const dto = await getJob(user.id, job.id)
    expect(dto).toBeTruthy()
    expect(dto!.keyframes).toHaveLength(2)
    expect(dto!.keyframes.map((k: { order: number }) => k.order)).toEqual([1, 2])
    const stranger = await db.user.create({
      data: { email: 'stranger@somnia.test', name: 'Stranger' },
    })
    expect(await getJob(stranger.id, job.id)).toBeNull()
  })
})
