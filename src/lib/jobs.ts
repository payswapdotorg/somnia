import { randomUUID } from 'node:crypto'

import { db } from '@/lib/db'
import { createImageJob } from '@/lib/images'
import {
  InsufficientCreditsError,
  InvalidRequestError,
  ModerationRefusalError,
} from '@/lib/errors'
import { endFramePath as endFramePublicPath, startFramePath as startFramePublicPath, writeBuffer } from '@/lib/frames'
import { moderatePrompt } from '@/lib/moderation'
import { creditCost, providerCostUsd, ASPECT_RATIOS, type AspectRatio, type Tier } from '@/lib/pricing'
import { resolveProvider } from '@/lib/providers'
import { afterResponse } from '@/lib/runtime'
import type { JobDto, JobStatus, JobVariantDto } from '@/lib/types'
import { getOrCreateDemoUser } from '@/lib/user'
import { z } from 'zod'

// Domain errors live in @/lib/errors (shared with the image + agent services);
// re-exported here so existing imports keep working.
export {
  InsufficientCreditsError,
  InvalidRequestError,
  ModerationRefusalError,
} from '@/lib/errors'

const GenerateInputSchema = z.object({
  prompt: z.string().trim().min(3, 'Prompt must be at least 3 characters').max(800, 'Prompt must be at most 800 characters'),
  tier: z.enum(['draft', 'quality']),
  durationSec: z.number().int().min(5).max(15),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']),
  board: z.string().trim().max(48, 'Board name must be at most 48 characters').nullable().optional(),
  idempotencyKey: z.string().min(8).max(128),
})

const START_FRAME_DATA_URL = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/
const MAX_IMAGE_BYTES = 6 * 1024 * 1024
/** Phase 3: edit instructions are short by design (they become a prompt cue). */
const MAX_EDIT_INSTRUCTION = 240
/** Phase 3: safety bound when walking edit-thread lineage. */
const MAX_THREAD_DEPTH = 20

/** Decode a base64 image data URL, or null when the value is absent. */
function decodeImageDataUrl(value: unknown, label: string): Buffer | null {
  if (typeof value !== 'string' || value.length === 0) return null
  const match = START_FRAME_DATA_URL.exec(value)
  if (!match) {
    throw new InvalidRequestError(`${label} must be a base64 image data URL (png, jpg or webp)`)
  }
  const buffer = Buffer.from(match[2], 'base64')
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new InvalidRequestError(`${label} image exceeds the 6MB limit`)
  }
  return buffer
}

export interface CreateJobInput {
  prompt: unknown
  tier: unknown
  durationSec: unknown
  aspectRatio: unknown
  startFrame?: unknown
  endFrame?: unknown
  board?: unknown
  idempotencyKey: unknown
  /** For re-runs/extends: reuse already-stored frames instead of new data. */
  existingStartFramePath?: string | null
  existingEndFramePath?: string | null
  /** Phase 3 edit threads: lineage + raw instruction persisted on the child job. */
  parentJobId?: string | null
  editInstruction?: string | null
}

export interface CreateJobResult {
  jobId: string
  creditsCharged: number
  balanceAfter: number
  idempotentReplay: boolean
}

export async function createJob(input: CreateJobInput): Promise<CreateJobResult> {
  // 1) Moderation gate — BEFORE validation and BEFORE any debit. Fail closed.
  const moderation = moderatePrompt(input.prompt)
  if (!moderation.allowed) {
    throw new ModerationRefusalError()
  }

  // 2) Validation.
  const parsed = GenerateInputSchema.safeParse({
    prompt: input.prompt,
    tier: input.tier,
    durationSec: input.durationSec,
    aspectRatio: input.aspectRatio,
    board: input.board,
    idempotencyKey: input.idempotencyKey,
  })
  if (!parsed.success) {
    throw new InvalidRequestError(parsed.error.issues[0]?.message ?? 'Invalid request')
  }
  const { prompt, tier, durationSec, aspectRatio, idempotencyKey } = parsed.data
  const board = typeof parsed.data.board === 'string' && parsed.data.board.length > 0 ? parsed.data.board : null

  const startFrameBuffer = decodeImageDataUrl(input.startFrame, 'startFrame')
  const endFrameBuffer = decodeImageDataUrl(input.endFrame, 'endFrame')

  // Phase 3 edit-thread metadata (optional; validated shape, persisted as-is).
  const parentJobId =
    typeof input.parentJobId === 'string' && input.parentJobId.length > 0 ? input.parentJobId : null
  const editInstruction =
    typeof input.editInstruction === 'string' && input.editInstruction.length > 0
      ? input.editInstruction.slice(0, MAX_EDIT_INSTRUCTION)
      : null

  // 3) Idempotency: replaying the same key returns the original job, no charge.
  const existing = await db.job.findUnique({ where: { idempotencyKey } })
  if (existing) {
    return {
      jobId: existing.id,
      creditsCharged: existing.creditsCharged,
      balanceAfter: (await getOrCreateDemoUser()).credits,
      idempotentReplay: true,
    }
  }

  // 4) Cost + balance check.
  const credits = creditCost(tier, durationSec)
  const user = await getOrCreateDemoUser()
  if (user.credits < credits) {
    throw new InsufficientCreditsError(credits, user.credits)
  }

  const provider = resolveProvider()
  const jobId = crypto.randomUUID()
  const plannedStartFramePath =
    input.existingStartFramePath ?? (startFrameBuffer ? startFramePublicPath(jobId) : null)
  const plannedEndFramePath =
    input.existingEndFramePath ?? (endFrameBuffer ? endFramePublicPath(jobId) : null)

  // 5) Atomic debit + ledger entry + job + generation record.
  const { balanceAfter } = await db.$transaction(async (tx) => {
    const lockedUser = await tx.user.findUnique({ where: { id: user.id } })
    if (!lockedUser || lockedUser.credits < credits) {
      throw new InsufficientCreditsError(credits, lockedUser?.credits ?? 0)
    }
    const updatedUser = await tx.user.update({
      where: { id: lockedUser.id },
      data: { credits: lockedUser.credits - credits },
    })
    await tx.job.create({
      data: {
        id: jobId,
        userId: lockedUser.id,
        prompt,
        kind: 'video',
        tier,
        durationSec,
        aspectRatio,
        startFramePath: plannedStartFramePath,
        endFramePath: plannedEndFramePath,
        board,
        parentJobId,
        editInstruction,
        status: 'queued',
        progress: 0,
        creditsCharged: credits,
        providerCostUsd: providerCostUsd(tier, durationSec),
        idempotencyKey,
      },
    })
    await tx.generation.create({
      data: {
        jobId,
        provider: provider.name,
        status: 'queued',
        framesJson: '[]',
      },
    })
    await tx.creditTransaction.create({
      data: {
        userId: lockedUser.id,
        jobId,
        amount: -credits,
        kind: 'generation',
        balanceAfter: updatedUser.credits,
      },
    })
    return { balanceAfter: updatedUser.credits }
  })

  // 6) Persist the optional pinned frames + asset rows.
  if (startFrameBuffer && plannedStartFramePath) {
    try {
      await writeBuffer(plannedStartFramePath, startFrameBuffer)
      await db.asset.create({ data: { jobId, kind: 'startFrame', path: plannedStartFramePath } })
    } catch (error) {
      console.warn('[jobs] failed to persist start frame:', (error as Error)?.message)
    }
  }
  if (endFrameBuffer && plannedEndFramePath) {
    try {
      await writeBuffer(plannedEndFramePath, endFrameBuffer)
      await db.asset.create({ data: { jobId, kind: 'endFrame', path: plannedEndFramePath } })
    } catch (error) {
      console.warn('[jobs] failed to persist end frame:', (error as Error)?.message)
    }
  }

  // 7) Kick off the provider asynchronously (never blocks the HTTP response).
  // Phase 6: afterResponse routes the promise through the platform's
  // waitUntil hook on serverless so the pipeline survives the response;
  // locally it degrades to the original fire-and-forget semantics.
  afterResponse(
    provider
      .runJob({
        jobId,
        prompt,
        tier,
        durationSec,
        aspectRatio,
        startFramePath: plannedStartFramePath,
        endFramePath: plannedEndFramePath,
      })
      .catch((error) => console.error('[jobs] provider run failed:', error))
  )

  return { jobId, creditsCharged: credits, balanceAfter, idempotentReplay: false }
}

export async function rerunJob(jobId: string): Promise<CreateJobResult> {
  const source = await db.job.findUnique({ where: { id: jobId } })
  if (!source) {
    throw new InvalidRequestError('Job not found')
  }
  // Phase 8: image jobs re-run through the image pipeline (flat credit rate,
  // no duration); video jobs keep the standard tier-rate x duration path.
  if (source.kind === 'image') {
    return createImageJob({
      prompt: source.prompt,
      tier: source.tier,
      aspectRatio: source.aspectRatio,
      board: source.board,
      idempotencyKey: `rerun-${source.id}-${Date.now()}-${crypto.randomUUID()}`,
    })
  }
  return createJob({
    prompt: source.prompt,
    tier: source.tier,
    durationSec: source.durationSec,
    aspectRatio: source.aspectRatio,
    board: source.board,
    idempotencyKey: `rerun-${source.id}-${Date.now()}-${crypto.randomUUID()}`,
    existingStartFramePath: source.startFramePath,
    existingEndFramePath: source.endFramePath,
  })
}

const EXTEND_DURATION_SEC = 5
const EXTEND_CUE = ', continuing the same scene and style'

/**
 * Compose an edit-child prompt: parent prompt + ", " + instruction-derived cue,
 * kept within the existing 800-character prompt limit. Truncation prefers
 * keeping the (new) instruction signal and trimming the older parent text.
 */
function composeEditPrompt(parent: string, instruction: string, max = 800): string {
  const separator = ', '
  if (parent.length + separator.length + instruction.length <= max) {
    return parent + separator + instruction
  }
  const instructionRoom = Math.min(instruction.length, MAX_EDIT_INSTRUCTION)
  const parentRoom = max - separator.length - instructionRoom
  if (parentRoom >= 8) {
    return parent.slice(0, parentRoom) + separator + instruction.slice(0, instructionRoom)
  }
  // Degenerate: the instruction alone nearly fills the budget.
  return instruction.slice(0, max)
}

/**
 * Phase 3 edit: cut a new version of a completed clip from a text instruction.
 * Creates a CHILD job through the standard createJob charge path (tier rate ×
 * duration), with fresh keyframes (no pinned frames inherited), same
 * tier/aspect/duration/board as the source. Moderation runs on the raw
 * instruction AND (inside createJob) on the composed child prompt — both
 * fail-closed BEFORE any charge.
 */
export async function editJob(jobId: string, instruction: unknown): Promise<CreateJobResult> {
  const source = await db.job.findUnique({ where: { id: jobId } })
  if (!source) {
    throw new InvalidRequestError('Job not found')
  }
  if (source.status !== 'completed') {
    throw new InvalidRequestError('Only completed jobs can be edited')
  }
  if (source.kind === 'image') {
    throw new InvalidRequestError('Image jobs cannot be edited — remix the prompt instead')
  }
  if (typeof instruction !== 'string' || instruction.trim().length < 3) {
    throw new InvalidRequestError('Edit instruction must be at least 3 characters')
  }
  if (instruction.trim().length > MAX_EDIT_INSTRUCTION) {
    throw new InvalidRequestError(`Edit instruction must be at most ${MAX_EDIT_INSTRUCTION} characters`)
  }

  const trimmedInstruction = instruction.trim().replace(/\s+/g, ' ')

  // Moderation gate on the raw instruction — BEFORE validation/charge (fail closed).
  const moderation = moderatePrompt(trimmedInstruction)
  if (!moderation.allowed) {
    throw new ModerationRefusalError()
  }

  const prompt = composeEditPrompt(source.prompt.trim(), trimmedInstruction)

  return createJob({
    prompt,
    tier: source.tier,
    durationSec: source.durationSec,
    aspectRatio: source.aspectRatio,
    board: source.board,
    idempotencyKey: `edit-${source.id}-${Date.now()}-${crypto.randomUUID()}`,
    existingStartFramePath: null,
    existingEndFramePath: null,
    parentJobId: source.id,
    editInstruction: trimmedInstruction,
  })
}

/** The last visual of a job: its pinned end frame, else its final keyframe. */
function lastVisualOf(job: {
  endFramePath: string | null
  generations?: Array<{ framesJson: string }>
}): string | null {
  if (job.endFramePath) return job.endFramePath
  const frames = latestGenerationFrames(job.generations ?? [])
  return frames.length > 0 ? frames[frames.length - 1] : null
}

/**
 * Phase 2 extend: push a completed clip forward. Creates a NEW standard job
 * (charged at tier rate × 5s) that starts from the source job's last frame.
 */
export async function extendJob(jobId: string): Promise<CreateJobResult> {
  const source = await db.job.findUnique({
    where: { id: jobId },
    include: { generations: { orderBy: { createdAt: 'desc' }, take: 1 } },
  })
  if (!source) {
    throw new InvalidRequestError('Job not found')
  }
  if (source.status !== 'completed') {
    throw new InvalidRequestError('Only completed jobs can be extended')
  }
  if (source.kind === 'image') {
    throw new InvalidRequestError('Image jobs cannot be extended — forge a video instead')
  }

  const basePrompt = source.prompt.trim()
  const cue = EXTEND_CUE
  const prompt =
    basePrompt.length + cue.length > 800
      ? basePrompt.slice(0, 800 - cue.length) + cue
      : basePrompt + cue

  const startFrame = lastVisualOf(source)

  return createJob({
    prompt,
    tier: source.tier,
    durationSec: EXTEND_DURATION_SEC,
    aspectRatio: source.aspectRatio,
    board: source.board,
    idempotencyKey: `extend-${source.id}-${Date.now()}-${crypto.randomUUID()}`,
    existingStartFramePath: startFrame,
    existingEndFramePath: null,
  })
}

/** Frames of the latest generation, in storyboard order (frame1..N). */
export function latestGenerationFrames(generations: Array<{ framesJson: string }>): string[] {
  const latest = generations[0]
  if (!latest) return []
  let frames: string[] = []
  try {
    const parsed = JSON.parse(latest.framesJson)
    if (Array.isArray(parsed)) frames = parsed.filter((p) => typeof p === 'string')
  } catch {
    frames = []
  }
  // Frames land in completion order; display them in storyboard order (frame1..3).
  return frames.sort((a, b) => frameOrdinal(a) - frameOrdinal(b))
}

/** Phase 3: map an Asset row into the variant DTO shape (or null when not one). */
export function toVariantDto(asset: {
  kind: string
  label: string | null
  variantKey: string | null
  path: string
}): JobVariantDto | null {
  if (asset.kind !== 'reframe' && asset.kind !== 'camera' && asset.kind !== 'restyle') return null
  // Reframe variant keys encode the target aspect ("reframe-9x16") so the DTO
  // can size the player correctly even though the job's own aspect differs.
  let aspectRatio: AspectRatio | null = null
  if (asset.kind === 'reframe' && asset.variantKey) {
    const match = /^reframe-(\d+)x(\d+)$/.exec(asset.variantKey)
    if (match) {
      const ratio = `${match[1]}:${match[2]}` as AspectRatio
      if (ASPECT_RATIOS.includes(ratio)) aspectRatio = ratio
    }
  }
  return { kind: asset.kind as JobVariantDto['kind'], label: asset.label, path: asset.path, aspectRatio }
}

function variantsOf(
  assets: Array<{ kind: string; label: string | null; variantKey: string | null; path: string }>
): JobVariantDto[] {
  return assets
    .map(toVariantDto)
    .filter((v): v is JobVariantDto => v !== null)
}

function frameOrdinal(path: string): number {
  const match = /-frame(\d+)\.png$/.exec(path)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

export function toJobDto(
  job: {
    id: string
    prompt: string
    kind: string
    tier: string
    durationSec: number
    aspectRatio: string
    startFramePath: string | null
    endFramePath: string | null
    board: string | null
    parentJobId: string | null
    editInstruction: string | null
    shareToken: string | null
    sharedAt: Date | null
    status: string
    progress: number
    errorMessage: string | null
    creditsCharged: number
    providerCostUsd: number
    createdAt: Date
    updatedAt: Date
    generations?: Array<{ framesJson: string; provider: string; videoPath: string | null }>
    assets?: Array<{ kind: string; label: string | null; variantKey: string | null; path: string }>
  },
  editVersion = 1
): JobDto {
  const generations = job.generations ?? []
  return {
    id: job.id,
    prompt: job.prompt,
    kind: job.kind === 'image' ? 'image' : 'video',
    tier: job.tier as Tier,
    durationSec: job.durationSec,
    aspectRatio: job.aspectRatio as AspectRatio,
    startFramePath: job.startFramePath,
    endFramePath: job.endFramePath,
    board: job.board,
    status: job.status as JobStatus,
    progress: job.progress,
    errorMessage: job.errorMessage,
    creditsCharged: job.creditsCharged,
    providerCostUsd: job.providerCostUsd,
    provider: generations[0]?.provider ?? 'demo',
    frames: latestGenerationFrames(generations),
    videoPath: generations[0]?.videoPath ?? null,
    parentJobId: job.parentJobId,
    editInstruction: job.editInstruction,
    editVersion,
    variants: variantsOf(job.assets ?? []),
    shareToken: job.shareToken,
    sharedAt: job.sharedAt ? job.sharedAt.toISOString() : null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  }
}

export async function listJobs(limit = 50): Promise<JobDto[]> {
  const jobs = await db.job.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      generations: { orderBy: { createdAt: 'desc' }, take: 1 },
      assets: { orderBy: { createdAt: 'asc' }, select: { kind: true, label: true, variantKey: true, path: true } },
    },
  })
  // Edit-thread depth per job, computed in memory from the loaded window.
  // Jobs whose ancestors fall outside the window resolve to the visible depth.
  const parentOf = new Map(jobs.map((job) => [job.id, job.parentJobId]))
  const depthOf = (id: string): number => {
    let depth = 0
    let cursor: string | null = id
    while (cursor && depth < MAX_THREAD_DEPTH) {
      const parent = parentOf.get(cursor) ?? null
      if (!parent) break
      depth += 1
      cursor = parent
    }
    return depth
  }
  return jobs.map((job) => toJobDto(job, depthOf(job.id) + 1))
}

export async function getJobDetail(jobId: string): Promise<JobDto | null> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    include: {
      generations: { orderBy: { createdAt: 'desc' }, take: 1 },
      assets: { orderBy: { createdAt: 'asc' }, select: { kind: true, label: true, variantKey: true, path: true } },
    },
  })
  if (!job) return null
  // Walk the ancestor chain to compute this job's thread position.
  let depth = 0
  let cursor: string | null = job.parentJobId
  while (cursor && depth < MAX_THREAD_DEPTH) {
    const parent = await db.job.findUnique({
      where: { id: cursor },
      select: { parentJobId: true },
    })
    if (!parent) break
    depth += 1
    cursor = parent.parentJobId
  }
  return toJobDto(job, depth + 1)
}

// ── Phase 5: public unlisted share links ─────────────────────────────────
//
// Sharing a completed render mints a single opaque token (32 hex chars) stored
// on the Job row. `/share/<token>` renders a public, no-auth page; revoking a
// share nulls the token so old links stop resolving immediately. Tokens are
// unguessable capability URLs — the page itself is noindex + robots-excluded.

const SHAREABLE_STATUSES = ['completed']

/** Mint (or return the existing) share token for a completed job. Idempotent. */
export async function enableJobShare(jobId: string): Promise<{
  shareToken: string
  sharedAt: Date
}> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { id: true, status: true, shareToken: true },
  })
  if (!job) {
    throw new InvalidRequestError('Job not found')
  }
  if (!SHAREABLE_STATUSES.includes(job.status)) {
    throw new InvalidRequestError('Only completed renders can be shared')
  }
  if (job.shareToken) {
    const existing = await db.job.findUnique({ where: { id: jobId }, select: { sharedAt: true } })
    return { shareToken: job.shareToken, sharedAt: existing?.sharedAt ?? new Date() }
  }
  const shareToken = randomUUID().replace(/-/g, '')
  const sharedAt = new Date()
  // Unique-token collision is a 2^-128 event; retry once on the (practically
  // impossible) constraint violation rather than surfacing a 500 to the user.
  const saved = await db.job
    .update({ where: { id: jobId }, data: { shareToken, sharedAt } })
    .catch(async () => {
      const retryToken = randomUUID().replace(/-/g, '')
      return db.job.update({ where: { id: jobId }, data: { shareToken: retryToken, sharedAt } })
    })
  return { shareToken: saved.shareToken ?? shareToken, sharedAt }
}

/** Revoke a share link. Idempotent — revoking an unshared job is a no-op. */
export async function disableJobShare(jobId: string): Promise<void> {
  const job = await db.job.findUnique({ where: { id: jobId }, select: { id: true } })
  if (!job) {
    throw new InvalidRequestError('Job not found')
  }
  await db.job.update({ where: { id: jobId }, data: { shareToken: null, sharedAt: null } })
}

/** Resolve a share token into a COMPLETED job for the public page (or null). */
export async function getSharedJob(token: string): Promise<JobDto | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) return null
  const job = await db.job.findUnique({
    where: { shareToken: token },
    include: {
      generations: { orderBy: { createdAt: 'desc' }, take: 1 },
      assets: { orderBy: { createdAt: 'asc' }, select: { kind: true, label: true, variantKey: true, path: true } },
    },
  })
  if (!job || !SHAREABLE_STATUSES.includes(job.status)) return null
  return toJobDto(job, 1)
}
