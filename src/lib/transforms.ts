import { db } from '@/lib/db'
import {
  InsufficientCreditsError,
  InvalidRequestError,
  latestGenerationFrames,
  toVariantDto,
} from '@/lib/jobs'
import { CAMERA_PRESET_IDS, cameraPresetLabel, type CameraPresetId } from '@/lib/presets'
import { CAMERA_CREDITS, REFRAME_CREDITS, RESTYLE_CREDITS, type AspectRatio, type Tier } from '@/lib/pricing'
import {
  RESTYLE_STYLES,
  restyleFrameCount,
  restyleFramePath,
  restyleStyle,
  restyleVariantKey,
  type RestyleStyleId,
} from '@/lib/styles'
import type { JobVariantDto } from '@/lib/types'
import { getOrCreateDemoUser } from '@/lib/user'
import { extractStyledFrames, reframeVideo, renderVideo } from '@/lib/video'
import { z } from 'zod'

/**
 * Reelforge Phase 3 transforms — clip-level edits that do NOT create a new
 * generation job:
 *
 *   reframe: re-crop an existing MP4 onto a different aspect canvas (flat 10 cr)
 *   camera:  re-shoot the job's ordered stills with a virtual camera move (flat 15 cr)
 *
 * Both charge through the same atomic $transaction pattern as createJob
 * (locked user read → balance check → debit + append-only 'transform' ledger
 * row + Asset row, all in one transaction). Neither takes new free-form user
 * text, so there is no moderation gate here — but rendering happens BEFORE the
 * charge, so a failed ffmpeg run never costs credits.
 */

export class TransformRenderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransformRenderError'
  }
}

export interface TransformResult {
  variant: JobVariantDto
  creditsCharged: number
  balanceAfter: number
  /** True when an identical variant already existed and NO new charge was made. */
  alreadyExisted: boolean
}

const AspectSchema = z.enum(['16:9', '9:16', '1:1'])
const CameraPresetSchema = z.enum(CAMERA_PRESET_IDS)

/** Look up an already-recorded variant (idempotency anchor per job+variant). */
async function findVariant(jobId: string, variantKey: string): Promise<JobVariantDto | null> {
  const asset = await db.asset.findFirst({ where: { jobId, variantKey } })
  return asset ? toVariantDto(asset) : null
}

/**
 * Atomic flat-credit charge + ledger entry + Asset row — the same shape as the
 * createJob transaction, with the Asset standing in for the new Job/Generation.
 */
async function chargeAndRecordTransform(input: {
  jobId: string
  credits: number
  kind: 'reframe' | 'camera' | 'restyle'
  label: string
  variantKey: string
  path: string
}): Promise<number> {
  const user = await getOrCreateDemoUser()
  const { balanceAfter } = await db.$transaction(async (tx) => {
    const lockedUser = await tx.user.findUnique({ where: { id: user.id } })
    if (!lockedUser || lockedUser.credits < input.credits) {
      throw new InsufficientCreditsError(input.credits, lockedUser?.credits ?? 0)
    }
    const updatedUser = await tx.user.update({
      where: { id: lockedUser.id },
      data: { credits: lockedUser.credits - input.credits },
    })
    await tx.asset.create({
      data: {
        jobId: input.jobId,
        kind: input.kind,
        path: input.path,
        label: input.label,
        variantKey: input.variantKey,
      },
    })
    await tx.creditTransaction.create({
      data: {
        userId: lockedUser.id,
        jobId: input.jobId,
        amount: -input.credits,
        kind: 'transform',
        balanceAfter: updatedUser.credits,
      },
    })
    return { balanceAfter: updatedUser.credits }
  })
  return balanceAfter
}

async function loadSourceJob(jobId: string) {
  const job = await db.job.findUnique({
    where: { id: jobId },
    include: { generations: { orderBy: { createdAt: 'desc' }, take: 1 } },
  })
  if (!job) {
    throw new InvalidRequestError('Job not found')
  }
  return job
}

/** Ordered stills of a job: pinned start → keyframes → pinned end. */
function orderedSegments(job: {
  startFramePath: string | null
  endFramePath: string | null
  generations: Array<{ framesJson: string }>
}): string[] {
  return [job.startFramePath, ...latestGenerationFrames(job.generations), job.endFramePath].filter(
    (p): p is string => typeof p === 'string' && p.length > 0
  )
}

/**
 * Phase 3 reframe: re-crop a completed clip's MP4 to a new aspect ratio.
 * Flat 10 credits, providerCostUsd 0 (local ffmpeg only), ledger kind
 * 'transform'. Idempotent per (job, aspect): an existing variant is returned
 * without a second charge.
 */
export async function reframeJob(jobId: string, aspect: unknown): Promise<TransformResult> {
  const parsed = AspectSchema.safeParse(aspect)
  if (!parsed.success) {
    throw new InvalidRequestError('Aspect must be one of 16:9, 9:16 or 1:1')
  }
  const targetAspect: AspectRatio = parsed.data

  const job = await loadSourceJob(jobId)
  if (job.status !== 'completed' || !job.generations[0]?.videoPath) {
    throw new InvalidRequestError('Only completed clips with a rendered video can be re-cropped')
  }

  const variantKey = `reframe-${targetAspect.replace(':', 'x')}`
  const existing = await findVariant(jobId, variantKey)
  if (existing) {
    return {
      variant: existing,
      creditsCharged: 0,
      balanceAfter: (await getOrCreateDemoUser()).credits,
      alreadyExisted: true,
    }
  }

  const path = await reframeVideo({
    jobId,
    tier: job.tier as Tier,
    targetAspectRatio: targetAspect,
    sourcePath: job.generations[0].videoPath,
  })
  if (!path) {
    throw new TransformRenderError('The re-crop could not be rendered — you have not been charged.')
  }

  const label = `${targetAspect} crop`
  const balanceAfter = await chargeAndRecordTransform({
    jobId,
    credits: REFRAME_CREDITS,
    kind: 'reframe',
    label,
    variantKey,
    path,
  })
  return {
    variant: { kind: 'reframe', label, path, aspectRatio: targetAspect },
    creditsCharged: REFRAME_CREDITS,
    balanceAfter,
    alreadyExisted: false,
  }
}

/** Ordered segment count required before a camera re-shoot is meaningful. */
const MIN_CAMERA_SEGMENTS = 3

/**
 * Phase 3 camera move: re-render the job's existing ordered stills
 * (start → keyframes → end) with a virtual camera preset. Flat 15 credits,
 * providerCostUsd 0, ledger kind 'transform'. Idempotent per (job, preset).
 */
export async function cameraJob(jobId: string, preset: unknown): Promise<TransformResult> {
  const parsed = CameraPresetSchema.safeParse(preset)
  if (!parsed.success) {
    throw new InvalidRequestError('Camera preset must be one of push-in, pull-back, drift-left or drift-right')
  }
  const motion: CameraPresetId = parsed.data

  const job = await loadSourceJob(jobId)
  if (job.status !== 'completed') {
    throw new InvalidRequestError('Only completed jobs can be re-shot with a camera move')
  }
  const segments = orderedSegments(job)
  if (segments.length < MIN_CAMERA_SEGMENTS) {
    throw new InvalidRequestError('This job needs at least three stills before a camera move can be added')
  }

  const variantKey = `camera-${motion}`
  const existing = await findVariant(jobId, variantKey)
  if (existing) {
    return {
      variant: existing,
      creditsCharged: 0,
      balanceAfter: (await getOrCreateDemoUser()).credits,
      alreadyExisted: true,
    }
  }

  const path = await renderVideo({
    jobId,
    tier: job.tier as Tier,
    aspectRatio: job.aspectRatio as AspectRatio,
    durationSec: job.durationSec,
    segments,
    motion,
    outputName: `${jobId}-camera-${motion}`,
  })
  if (!path) {
    throw new TransformRenderError('The camera move could not be rendered — you have not been charged.')
  }

  const label = cameraPresetLabel(motion)
  const balanceAfter = await chargeAndRecordTransform({
    jobId,
    credits: CAMERA_CREDITS,
    kind: 'camera',
    label,
    variantKey,
    path,
  })
  return {
    variant: { kind: 'camera', label, path, aspectRatio: null },
    creditsCharged: CAMERA_CREDITS,
    balanceAfter,
    alreadyExisted: false,
  }
}

const RestyleStyleSchema = z.enum(RESTYLE_STYLES.map((s) => s.id) as [RestyleStyleId, ...RestyleStyleId[]])

/**
 * Phase 11 (N5) restyle: video-to-video style grade. Samples evenly spaced
 * keyframes from the source clip (style filter applied during extraction),
 * then re-composites them with the standard Ken Burns recipe — the same
 * storyboard idiom every Reelforge render uses. Flat 12 credits, local ffmpeg
 * only (providerCostUsd 0), ledger kind 'transform'. Idempotent per
 * (job, style): an existing variant is returned without a second charge.
 * No free-form user text — the style id is from a fixed catalogue, so there is
 * no moderation gate. Rendering happens BEFORE the charge, so a failed
 * ffmpeg run never costs credits.
 */
export async function restyleJob(jobId: string, style: unknown): Promise<TransformResult> {
  const parsed = RestyleStyleSchema.safeParse(style)
  if (!parsed.success) {
    throw new InvalidRequestError(`Style must be one of ${RESTYLE_STYLES.map((s) => s.id).join(', ')}`)
  }
  const styleId = parsed.data
  const meta = restyleStyle(styleId)
  if (!meta) {
    // Unreachable (schema-validated), kept for type narrowing.
    throw new InvalidRequestError('Unknown style')
  }

  const job = await loadSourceJob(jobId)
  if (job.status !== 'completed' || !job.generations[0]?.videoPath) {
    throw new InvalidRequestError('Only completed clips with a rendered video can be restyled')
  }

  const variantKey = restyleVariantKey(styleId)
  const existing = await findVariant(jobId, variantKey)
  if (existing) {
    return {
      variant: existing,
      creditsCharged: 0,
      balanceAfter: (await getOrCreateDemoUser()).credits,
      alreadyExisted: true,
    }
  }

  const durationSec = job.durationSec
  const count = restyleFrameCount(durationSec)
  // Even spacing across the clip, sampling the interior (not t=0 exactly —
  // crossfade tails make the very first/last frames less representative).
  const timestamps = Array.from({ length: count }, (_, i) =>
    Math.max(0, ((i + 0.5) / count) * Math.max(1, durationSec))
  )
  const outputPaths = Array.from({ length: count }, (_, i) => restyleFramePath(jobId, styleId, i))

  const styledSegments = await extractStyledFrames({
    jobId,
    sourcePath: job.generations[0].videoPath,
    styleFilter: meta.filter,
    timestamps,
    outputPaths,
  })
  if (!styledSegments || styledSegments.length < 2) {
    throw new TransformRenderError(
      'The restyle could not be rendered — you have not been charged.'
    )
  }

  const path = await renderVideo({
    jobId,
    tier: job.tier as Tier,
    aspectRatio: job.aspectRatio as AspectRatio,
    durationSec,
    segments: styledSegments,
    motion: 'kenburns',
    outputName: `${jobId}-restyle-${styleId}`,
  })
  if (!path) {
    throw new TransformRenderError('The restyle could not be rendered — you have not been charged.')
  }

  const label = `${meta.label} grade`
  const balanceAfter = await chargeAndRecordTransform({
    jobId,
    credits: RESTYLE_CREDITS,
    kind: 'restyle',
    label,
    variantKey,
    path,
  })
  return {
    variant: { kind: 'restyle', label, path, aspectRatio: null },
    creditsCharged: RESTYLE_CREDITS,
    balanceAfter,
    alreadyExisted: false,
  }
}
