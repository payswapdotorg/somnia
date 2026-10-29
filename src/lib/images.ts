import { db } from '@/lib/db'
import {
  InsufficientCreditsError,
  InvalidRequestError,
  ModerationRefusalError,
} from '@/lib/errors'
import { framePath, writeBase64Png, writePlaceholderFrame } from '@/lib/frames'
import { moderatePrompt } from '@/lib/moderation'
import {
  imageCreditCost,
  imageProviderCostUsd,
  type AspectRatio,
  type Tier,
} from '@/lib/pricing'
import { afterResponse } from '@/lib/runtime'
import { getOrCreateDemoUser } from '@/lib/user'
import { z } from 'zod'

/**
 * Phase 8: image mode — single-still generation jobs.
 *
 * Mirrors the video job contract (moderation BEFORE validation and debit,
 * idempotency key replay, atomic charge + ledger + Job + Generation) but
 * produces one image at /generated/<id>-frame1.png and never renders an MP4.
 * The still is attempted with the server-side z-ai image SDK; on failure or
 * timeout an original branded placeholder lands at the same path, so every
 * image job still completes.
 */

const SIZE_BY_ASPECT: Record<AspectRatio, '1024x1024' | '768x1344' | '1344x768'> = {
  '16:9': '1344x768',
  '9:16': '768x1344',
  '1:1': '1024x1024',
}

const ImageInputSchema = z.object({
  prompt: z.string().trim().min(3, 'Prompt must be at least 3 characters').max(800, 'Prompt must be at most 800 characters'),
  tier: z.enum(['draft', 'quality']),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']),
  board: z.string().trim().max(48, 'Board name must be at most 48 characters').nullable().optional(),
  idempotencyKey: z.string().min(8).max(128),
})

export interface CreateImageJobInput {
  prompt: unknown
  tier: unknown
  aspectRatio: unknown
  board?: unknown
  idempotencyKey: unknown
}

export interface CreateImageJobResult {
  jobId: string
  creditsCharged: number
  balanceAfter: number
  idempotentReplay: boolean
}

/** Try the real image SDK; resolve base64 PNG data or null on any failure. */
async function generateStillBase64(prompt: string, aspectRatio: AspectRatio): Promise<string | null> {
  try {
    const { default: ZAI } = await import('z-ai-web-dev-sdk')
    const zai = await ZAI.create()
    const response = await zai.images.generations.create({
      prompt: `${prompt}. Striking composition, cinematic lighting, rich color, high detail.`,
      size: SIZE_BY_ASPECT[aspectRatio],
    })
    const base64 = response?.data?.[0]?.base64
    return typeof base64 === 'string' && base64.length > 32 ? base64 : null
  } catch (error) {
    console.warn('[ImageProvider] still SDK call failed, using placeholder:', (error as Error)?.message)
    return null
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise, sleep(ms).then(() => null)])
}

// A dedicated still is worth waiting for (observed SDK latency 26-60s), so the
// image budget is longer than the per-keyframe budget in the video pipeline.
const STILL_TIMEOUT_MS = Number(process.env.REELFORGE_IMAGE_TIMEOUT_MS ?? 90000)

async function runImageJob(jobId: string, prompt: string, tier: Tier, aspectRatio: AspectRatio): Promise<void> {
  const generation = await db.generation.findFirst({ where: { jobId }, orderBy: { createdAt: 'desc' } })

  const initial = await db.job.findUnique({ where: { id: jobId } })
  if (!initial || initial.status !== 'queued') return

  const bump = async (status: string, progress: number) => {
    await db.job.update({ where: { id: jobId }, data: { status, progress } }).catch(() => undefined)
    if (generation) {
      await db.generation.update({ where: { id: generation.id }, data: { status } }).catch(() => undefined)
    }
  }

  try {
    await sleep(900)
    await bump('dispatched', 6)
    await sleep(500)
    await bump('running', 14)

    // Creep progress while the still renders (can take ~a minute on the SDK).
    const ticker = setInterval(() => {
      void (async () => {
        try {
          const job = await db.job.findUnique({ where: { id: jobId } })
          if (!job || job.status !== 'running') {
            clearInterval(ticker)
            return
          }
          const next = Math.min(88, job.progress + 4)
          if (next !== job.progress) {
            await db.job.update({ where: { id: jobId }, data: { progress: next } })
          }
        } catch {
          /* transient tick failure is fine */
        }
      })()
    }, 1500)

    const publicPath = framePath(jobId, 1)
    const base64 = await withTimeout(generateStillBase64(prompt, aspectRatio), STILL_TIMEOUT_MS)
    clearInterval(ticker)

    let landedPath: string
    if (base64) {
      try {
        await writeBase64Png(publicPath, base64)
        landedPath = publicPath
      } catch {
        landedPath = await writePlaceholderFrame({ jobId, frameNumber: 1, prompt, aspectRatio })
      }
    } else {
      landedPath = await writePlaceholderFrame({ jobId, frameNumber: 1, prompt, aspectRatio })
    }

    await bump('moderated', 92)
    await sleep(400)

    if (generation) {
      await db.generation.update({
        where: { id: generation.id },
        data: { framesJson: JSON.stringify([landedPath]) },
      })
    }
    await db.asset.create({ data: { jobId, kind: 'frame', path: landedPath } }).catch(() => undefined)

    await db.job.update({ where: { id: jobId }, data: { status: 'completed', progress: 100 } })
    if (generation) {
      await db.generation.update({ where: { id: generation.id }, data: { status: 'succeeded' } })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown image provider error'
    await db.job
      .update({ where: { id: jobId }, data: { status: 'failed', errorMessage: message } })
      .catch(() => undefined)
    if (generation) {
      await db.generation
        .update({ where: { id: generation.id }, data: { status: 'failed' } })
        .catch(() => undefined)
    }
  }
}

export async function createImageJob(input: CreateImageJobInput): Promise<CreateImageJobResult> {
  // 1) Moderation gate — BEFORE validation and BEFORE any debit. Fail closed.
  const moderation = moderatePrompt(input.prompt)
  if (!moderation.allowed) {
    throw new ModerationRefusalError()
  }

  // 2) Validation.
  const parsed = ImageInputSchema.safeParse({
    prompt: input.prompt,
    tier: input.tier,
    aspectRatio: input.aspectRatio,
    board: input.board,
    idempotencyKey: input.idempotencyKey,
  })
  if (!parsed.success) {
    throw new InvalidRequestError(parsed.error.issues[0]?.message ?? 'Invalid request')
  }
  const { prompt, tier, aspectRatio, idempotencyKey } = parsed.data
  const board =
    typeof parsed.data.board === 'string' && parsed.data.board.length > 0 ? parsed.data.board : null

  // 3) Idempotency replay — same key returns the original job, no charge.
  const existing = await db.job.findUnique({ where: { idempotencyKey } })
  if (existing) {
    return {
      jobId: existing.id,
      creditsCharged: existing.creditsCharged,
      balanceAfter: (await getOrCreateDemoUser()).credits,
      idempotentReplay: true,
    }
  }

  // 4) Cost + balance check (flat rate per tier — no duration math).
  const credits = imageCreditCost(tier)
  const user = await getOrCreateDemoUser()
  if (user.credits < credits) {
    throw new InsufficientCreditsError(credits, user.credits)
  }

  const jobId = crypto.randomUUID()

  // 5) Atomic debit + ledger + job + generation record.
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
        kind: 'image',
        tier,
        durationSec: 0,
        aspectRatio,
        board,
        status: 'queued',
        progress: 0,
        creditsCharged: credits,
        providerCostUsd: imageProviderCostUsd(tier),
        idempotencyKey,
      },
    })
    await tx.generation.create({
      data: {
        jobId,
        provider: 'image',
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

  // 6) Kick off the still render asynchronously (never blocks the response).
  afterResponse(
    runImageJob(jobId, prompt, tier, aspectRatio).catch((error) =>
      console.error('[images] still render failed:', error)
    )
  )

  return { jobId, creditsCharged: credits, balanceAfter, idempotentReplay: false }
}
