// src/lib/engine.ts — Somnia generation engine.
//
// Domain core for every creation surface: job creation with parameter
// validation, moderation, idempotent charging and the ordered keyframe
// timeline (1..16); extend / modify lineage on completed jobs; reframe and
// upscale transforms (idempotent per variant); refund-on-failure; and the
// owner-scoped job DTO. Rendering happens in the pipeline layer, which the
// API routes invoke after job creation (platform afterResponse pattern).

import { randomUUID } from 'node:crypto'
import type { Asset, Job, Keyframe } from '@prisma/client'
import { db } from '@/lib/db'
import { spend, refund } from '@/lib/ledger'
import { validateKeyframeList } from '@/lib/inputs'
import { storeFrameDataUrl } from '@/lib/storage'
import {
  ASPECT_RATIOS,
  DURATIONS,
  RESOLUTIONS,
  VIDEO_MODELS,
  clipCost,
  extendCost,
  imageCost,
  modifyCost,
  reframeCost,
  upscaleCost,
} from '@/lib/plans'

const BANNED_TERMS = [
  'nsfw',
  'gore',
  'dismemberment',
  'sexual content involving minors',
  'deepfake of a real person',
]

export interface KeyframeInput {
  dataUrl: string
  name?: string
}

export interface CreateJobInput {
  userId: string
  prompt: string
  enhancedPrompt?: string
  kind?: 'video' | 'image'
  mode?: 'create' | 'modify' | 'extend' | 'agent' | 'remix'
  model?: string
  resolution?: string
  aspectRatio?: string
  durationSec?: number
  hdr?: boolean
  loop?: boolean
  /** Ordered pinned timeline (1..16). First/last become start/end frames. */
  keyframes?: KeyframeInput[]
  /** Simple start/end frame chips (data URLs). */
  startFrame?: string
  endFrame?: string
  /** Pre-stored frame paths (internal: extend seeds, remix prefills). */
  startFramePath?: string
  endFramePath?: string
  parentJobId?: string
  sourceJobId?: string
  agentRunId?: string
  boardId?: string
  idempotencyKey?: string
}

function isModerated(text: string): boolean {
  const lowered = text.toLowerCase()
  return BANNED_TERMS.some((term) => lowered.includes(term))
}

export async function createJob(input: CreateJobInput): Promise<Job> {
  const key = input.idempotencyKey ?? randomUUID()

  const existing = await db.job.findUnique({ where: { idempotencyKey: key } })
  if (existing) return existing

  // ---------------------------------------------------------- normalize
  const kind = input.kind ?? 'video'
  if (kind !== 'video' && kind !== 'image') {
    throw new Error(`unsupported job kind: ${kind}`)
  }
  const model = input.model ?? (kind === 'image' ? 'prism' : 'pulse-3')
  const resolution = input.resolution ?? '720p'
  const aspectRatio = input.aspectRatio ?? '16:9'
  const durationSec = kind === 'image' ? 0 : (input.durationSec ?? 5)
  const hdr = kind === 'video' ? !!input.hdr : false
  const loop = kind === 'video' ? !!input.loop : false
  const prompt = (input.prompt ?? '').trim()

  // ------------------------------------------------------------ validate
  if (prompt.length < 3) throw new Error('prompt must be at least 3 characters')
  if (!RESOLUTIONS.includes(resolution as never)) {
    throw new Error(`unknown resolution: ${resolution}`)
  }
  if (!ASPECT_RATIOS.includes(aspectRatio as never)) {
    throw new Error(`unknown aspect ratio: ${aspectRatio}`)
  }
  if (kind === 'video') {
    if (!VIDEO_MODELS.includes(model as never)) {
      throw new Error(`unknown model: ${model}`)
    }
    if (!DURATIONS.includes(durationSec as never)) {
      throw new Error(`unsupported duration: ${durationSec}s`)
    }
  } else if (model !== 'prism') {
    throw new Error(`unknown model: ${model}`)
  }

  const keyframeList = input.keyframes ?? []
  if (keyframeList.length > 0) {
    const orders = keyframeList.map((_, i) => i + 1)
    const valid = validateKeyframeList(orders)
    if (!valid.ok) throw new Error(valid.reason)
  }

  // ------------------------------------------------------- persist frames
  let startFramePath = input.startFramePath ?? null
  let endFramePath = input.endFramePath ?? null
  const explicitStart = input.startFrame ? await storeFrameDataUrl(input.startFrame) : null
  const explicitEnd = input.endFrame ? await storeFrameDataUrl(input.endFrame) : null
  if (explicitStart) startFramePath = explicitStart
  if (explicitEnd) endFramePath = explicitEnd

  const keyframePaths: string[] = []
  for (const kf of keyframeList) keyframePaths.push(await storeFrameDataUrl(kf.dataUrl))
  if (keyframePaths.length > 0) {
    startFramePath = keyframePaths[0]
    endFramePath = keyframePaths[keyframePaths.length - 1]
  }

  // ---------------------------------------------------------- moderation
  const moderated = isModerated(`${prompt} ${input.enhancedPrompt ?? ''}`)
  if (moderated) {
    return db.job.create({
      data: {
        userId: input.userId,
        kind,
        mode: input.mode ?? 'create',
        prompt,
        enhancedPrompt: input.enhancedPrompt ?? null,
        model,
        resolution,
        aspectRatio,
        durationSec,
        hdr,
        loop,
        startFramePath,
        endFramePath,
        parentJobId: input.parentJobId ?? null,
        sourceJobId: input.sourceJobId ?? null,
        agentRunId: input.agentRunId ?? null,
        boardId: input.boardId ?? null,
        status: 'moderated',
        creditsCharged: 0,
        idempotencyKey: key,
      },
    })
  }

  // --------------------------------------------------------------- charge
  const cost =
    kind === 'image'
      ? imageCost()
      : input.mode === 'modify'
        ? modifyCost(model, resolution)
        : input.mode === 'extend'
          ? extendCost(model, resolution)
          : clipCost({ model, resolution, durationSec, hdr, loop })

  await spend({
    userId: input.userId,
    amount: cost,
    kind: 'spend',
    note: `${model} ${resolution}${kind === 'video' ? ` ${durationSec}s` : ''}`,
    idempotencyKey: `spend-${key}`,
  })

  // ----------------------------------------------------------- create job
  let job: Job
  try {
    job = await db.job.create({
      data: {
        userId: input.userId,
        kind,
        mode: input.mode ?? 'create',
        prompt,
        enhancedPrompt: input.enhancedPrompt ?? null,
        model,
        resolution,
        aspectRatio,
        durationSec,
        hdr,
        loop,
        startFramePath,
        endFramePath,
        parentJobId: input.parentJobId ?? null,
        sourceJobId: input.sourceJobId ?? null,
        agentRunId: input.agentRunId ?? null,
        boardId: input.boardId ?? null,
        status: 'queued',
        creditsCharged: cost,
        idempotencyKey: key,
      },
    })
  } catch (err) {
    // Unique-key race under a repeated idempotency key: return the winner.
    const winner = await db.job.findUnique({ where: { idempotencyKey: key } })
    if (winner) return winner
    throw err
  }

  // -------------------------------------------------- keyframes & assets
  if (keyframePaths.length > 0) {
    await db.keyframe.createMany({
      data: keyframePaths.map((p, i) => ({ jobId: job.id, order: i + 1, path: p })),
    })
  }
  if (explicitStart) {
    await db.asset.create({
      data: { jobId: job.id, kind: 'startFrame', path: explicitStart },
    })
  }
  if (explicitEnd) {
    await db.asset.create({ data: { jobId: job.id, kind: 'endFrame', path: explicitEnd } })
  }

  return job
}

// ------------------------------------------------------------------ extend

/** Extend a completed clip by a fresh 5s continuation seeded from its end. */
export async function extendJob(
  userId: string,
  jobId: string
): Promise<Job> {
  const source = await db.job.findFirst({ where: { id: jobId, userId } })
  if (!source) throw new Error('job not found')
  if (source.status !== 'completed') {
    throw new Error('only completed jobs can be extended')
  }
  let seedFrame = source.endFramePath
  if (!seedFrame) {
    const last = await db.keyframe.findFirst({
      where: { jobId: source.id },
      orderBy: { order: 'desc' },
    })
    seedFrame = last?.path ?? null
  }
  return createJob({
    userId,
    prompt: `${source.prompt} — continue the shot, same style and motion`,
    mode: 'extend',
    model: source.model,
    resolution: source.resolution,
    aspectRatio: source.aspectRatio,
    durationSec: 5,
    startFramePath: seedFrame ?? undefined,
    sourceJobId: source.id,
  })
}

// ------------------------------------------------------------------ modify

/** Modify (video-to-video): restyle / retexture a completed clip. */
export async function modifyJob(
  userId: string,
  jobId: string,
  opts: { instruction: string; model?: string; resolution?: string }
): Promise<Job> {
  const source = await db.job.findFirst({ where: { id: jobId, userId } })
  if (!source) throw new Error('job not found')
  if (source.status !== 'completed') {
    throw new Error('only completed jobs can be modified')
  }
  const instruction = (opts.instruction ?? '').trim()
  if (instruction.length < 3) {
    throw new Error('instruction must be at least 3 characters')
  }
  return createJob({
    userId,
    prompt: instruction,
    mode: 'modify',
    model: opts.model ?? source.model,
    resolution: opts.resolution ?? source.resolution,
    aspectRatio: source.aspectRatio,
    durationSec: source.durationSec || 5,
    sourceJobId: source.id,
  })
}

// -------------------------------------------------------------- transforms

async function completedVideoJob(userId: string, jobId: string): Promise<Job> {
  const job = await db.job.findFirst({ where: { id: jobId, userId } })
  if (!job) throw new Error('job not found')
  if (job.status !== 'completed') {
    throw new Error('only completed jobs can be transformed')
  }
  if (job.kind !== 'video') {
    throw new Error('transforms apply to video jobs only')
  }
  return job
}

/** Re-crop a completed clip to a new aspect ratio (flat fee, idempotent). */
export async function reframeJob(
  userId: string,
  jobId: string,
  aspect: string
): Promise<Asset> {
  if (!ASPECT_RATIOS.includes(aspect as never)) {
    throw new Error(`unknown aspect ratio: ${aspect}`)
  }
  const job = await completedVideoJob(userId, jobId)
  const variantKey = `reframe-${aspect}`
  const existing = await db.asset.findFirst({ where: { jobId: job.id, variantKey } })
  if (existing) return existing

  await spend({
    userId,
    amount: reframeCost(),
    kind: 'spend',
    note: `reframe ${aspect}`,
    idempotencyKey: `${job.id}:${variantKey}`,
  })

  const safeAspect = aspect.replace(':', 'x')
  return db.asset.create({
    data: {
      jobId: job.id,
      kind: 'reframe',
      variantKey,
      label: `${aspect} crop`,
      path: `/generated/${job.id}-reframe-${safeAspect}.mp4`,
    },
  })
}

/** 4K upscale of a completed clip (flat fee, idempotent). */
export async function upscaleJob(userId: string, jobId: string): Promise<Asset> {
  const job = await completedVideoJob(userId, jobId)
  const variantKey = 'upscale-4k'
  const existing = await db.asset.findFirst({ where: { jobId: job.id, variantKey } })
  if (existing) return existing

  await spend({
    userId,
    amount: upscaleCost(),
    kind: 'spend',
    note: '4K upscale',
    idempotencyKey: `${job.id}:${variantKey}`,
  })

  return db.asset.create({
    data: {
      jobId: job.id,
      kind: 'upscale',
      variantKey,
      label: '4K upscale',
      path: `/generated/${job.id}-upscale-4k.mp4`,
    },
  })
}

// ------------------------------------------------------------ status flow

/** Mark a job failed and refund the full charge (idempotent). */
export async function markJobFailed(jobId: string, reason: string): Promise<Job> {
  const job = await db.job.findUnique({ where: { id: jobId } })
  if (!job) throw new Error('job not found')
  if (job.status === 'failed') return job

  const updated = await db.job.update({
    where: { id: jobId },
    data: { status: 'failed', errorMessage: reason.slice(0, 500) },
  })
  if (job.creditsCharged > 0) {
    await refund({
      userId: job.userId,
      jobId: job.id,
      amount: job.creditsCharged,
      note: `failed: ${reason}`.slice(0, 200),
      idempotencyKey: `refund-${job.id}`,
    })
  }
  return updated
}

/** Mark a job completed and record its primary output (idempotent). */
export async function markJobCompleted(
  jobId: string,
  out?: { videoPath?: string; imagePath?: string }
): Promise<Job> {
  const job = await db.job.findUnique({ where: { id: jobId } })
  if (!job) throw new Error('job not found')

  if (out?.videoPath) {
    const exists = await db.asset.findFirst({
      where: { jobId, kind: 'video', variantKey: 'main' },
    })
    if (!exists) {
      await db.asset.create({
        data: { jobId, kind: 'video', path: out.videoPath, variantKey: 'main' },
      })
    }
  }
  if (out?.imagePath) {
    const exists = await db.asset.findFirst({
      where: { jobId, kind: 'poster', variantKey: 'main' },
    })
    if (!exists) {
      await db.asset.create({
        data: { jobId, kind: 'poster', path: out.imagePath, variantKey: 'main' },
      })
    }
  }
  return db.job.update({
    where: { id: jobId },
    data: { status: 'completed', progress: 100 },
  })
}

// -------------------------------------------------------------------- DTO

export interface JobDTO extends Job {
  keyframes: Keyframe[]
  assets: Asset[]
}

/** Owner-scoped job detail with the ordered timeline and assets. */
export async function getJob(userId: string, jobId: string): Promise<JobDTO | null> {
  return db.job.findFirst({
    where: { id: jobId, userId },
    include: {
      keyframes: { orderBy: { order: 'asc' } },
      assets: true,
    },
  })
}
