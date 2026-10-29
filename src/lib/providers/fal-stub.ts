import { db } from '@/lib/db'
import type { ProviderRunInput, ProviderRunResult, VideoProvider } from '@/lib/providers/types'

/**
 * FalStubProvider — a complete fal.ai-style queue adapter kept for future
 * provider wiring. It follows the fal queue API shape:
 *
 *   POST   https://queue.fal.run/{model}                        → { request_id, status_url, response_url }
 *   GET    https://queue.fal.run/{model}/requests/{id}/status   → { status: IN_QUEUE | IN_PROGRESS | COMPLETED, queue_position }
 *   GET    https://queue.fal.run/{model}/requests/{id}          → { video: { url } }
 *   Webhook POST back to /api/providers/fal/webhook             → signed completion event
 *
 * The adapter is gated behind env vars and is NEVER active without
 * configuration:
 *   FAL_KEY               required to activate
 *   FAL_MODEL             model id (default: reelforge/storyboard-v1)
 *   FAL_WEBHOOK_SECRET    shared secret for webhook payloads (optional)
 */

const FAL_QUEUE_BASE = 'https://queue.fal.run'

export function falModel(): string {
  return process.env.FAL_MODEL || 'reelforge/storyboard-v1'
}

export function isFalConfigured(): boolean {
  return Boolean(process.env.FAL_KEY && process.env.FAL_KEY.trim().length > 0)
}

interface FalQueueSubmitResponse {
  request_id: string
  status_url?: string
  response_url?: string
  cancel_url?: string
}

interface FalQueueStatus {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED'
  queue_position?: number
}

interface FalQueueResult {
  video?: { url?: string }
  frames?: Array<{ url?: string }>
}

function falHeaders(): HeadersInit {
  return {
    Authorization: `Key ${process.env.FAL_KEY}`,
    'Content-Type': 'application/json',
  }
}

export async function submitToFalQueue(input: ProviderRunInput): Promise<FalQueueSubmitResponse> {
  const response = await fetch(`${FAL_QUEUE_BASE}/${falModel()}`, {
    method: 'POST',
    headers: falHeaders(),
    body: JSON.stringify({
      prompt: input.prompt,
      tier: input.tier,
      duration_sec: input.durationSec,
      aspect_ratio: input.aspectRatio,
      image_url: input.startFramePath,
      end_image_url: input.endFramePath,
    }),
  })
  if (!response.ok) {
    throw new Error(`fal queue submit failed: ${response.status}`)
  }
  return (await response.json()) as FalQueueSubmitResponse
}

export async function pollFalStatus(requestId: string): Promise<FalQueueStatus> {
  const response = await fetch(`${FAL_QUEUE_BASE}/${falModel()}/requests/${requestId}/status`, {
    headers: falHeaders(),
  })
  if (!response.ok) {
    throw new Error(`fal status poll failed: ${response.status}`)
  }
  return (await response.json()) as FalQueueStatus
}

export async function fetchFalResult(requestId: string): Promise<FalQueueResult> {
  const response = await fetch(`${FAL_QUEUE_BASE}/${falModel()}/requests/${requestId}`, {
    headers: falHeaders(),
  })
  if (!response.ok) {
    throw new Error(`fal result fetch failed: ${response.status}`)
  }
  return (await response.json()) as FalQueueResult
}

/** Webhook shape: { request_id, status, video_url? } signed with FAL_WEBHOOK_SECRET. */
export function verifyWebhookSignature(secret: string | null, provided: string | null): boolean {
  if (!secret) return true // no secret configured → accept (dev default)
  if (!provided) return false
  return secret === provided
}

export async function handleFalWebhook(payload: {
  request_id?: string
  jobId?: string
  status?: string
  video_url?: string
}): Promise<{ handled: boolean }> {
  const jobId = payload.jobId
  if (!jobId) return { handled: false }
  const job = await db.job.findUnique({ where: { id: jobId } })
  if (!job) return { handled: false }

  if (payload.status === 'COMPLETED' && payload.video_url) {
    await db.asset.create({
      data: { jobId, kind: 'video', path: payload.video_url },
    })
    await db.generation.updateMany({
      where: { jobId },
      data: { videoPath: payload.video_url },
    })
    await db.job.update({
      where: { id: jobId },
      data: { status: 'completed', progress: 100 },
    })
  } else if (payload.status === 'FAILED') {
    await db.job.update({
      where: { id: jobId },
      data: { status: 'failed', errorMessage: 'Provider reported failure' },
    })
  }
  return { handled: true }
}

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 10 * 60 * 1000

async function runFalJob(input: ProviderRunInput): Promise<ProviderRunResult | void> {
  const { jobId } = input
  const generation = await db.generation.findFirst({ where: { jobId }, orderBy: { createdAt: 'desc' } })

  const initial = await db.job.findUnique({ where: { id: jobId } })
  if (!initial || initial.status !== 'queued') return

  try {
    await db.job.update({ where: { id: jobId }, data: { status: 'dispatched', progress: 4 } })
    if (generation) {
      await db.generation.update({ where: { id: generation.id }, data: { status: 'dispatched' } })
    }

    const submission = await submitToFalQueue(input)
    await db.job.update({ where: { id: jobId }, data: { status: 'running', progress: 8 } })
    if (generation) {
      await db.generation.update({ where: { id: generation.id }, data: { status: 'running' } })
    }

    const deadline = Date.now() + POLL_TIMEOUT_MS
    let progress = 8
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      const status = await pollFalStatus(submission.request_id)
      if (status.status === 'IN_QUEUE') {
        continue
      }
      if (status.status === 'IN_PROGRESS') {
        progress = Math.min(86, progress + 6)
        await db.job.update({ where: { id: jobId }, data: { progress } })
        continue
      }
      // COMPLETED
      await db.job.update({ where: { id: jobId }, data: { status: 'moderated', progress: 92 } })
      const result = await fetchFalResult(submission.request_id)
      let videoPath: string | null = null
      if (result.video?.url) {
        videoPath = result.video.url
        await db.asset.create({ data: { jobId, kind: 'video', path: videoPath } })
        if (generation) {
          await db.generation.update({
            where: { id: generation.id },
            data: { videoPath },
          })
        }
      }
      for (const frame of result.frames ?? []) {
        if (frame.url) {
          await db.asset.create({ data: { jobId, kind: 'frame', path: frame.url } })
          if (generation) {
            const current = await db.generation.findUnique({ where: { id: generation.id } })
            const frames = current ? safeParse(current.framesJson) : []
            frames.push(frame.url)
            await db.generation.update({
              where: { id: generation.id },
              data: { framesJson: JSON.stringify(frames) },
            })
          }
        }
      }
      await db.job.update({ where: { id: jobId }, data: { status: 'completed', progress: 100 } })
      if (generation) {
        await db.generation.update({ where: { id: generation.id }, data: { status: 'succeeded' } })
      }
      return { videoPath }
    }
    throw new Error('fal queue polling timed out')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown fal provider error'
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

function safeParse(framesJson: string): string[] {
  try {
    const parsed = JSON.parse(framesJson)
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : []
  } catch {
    return []
  }
}

export const falStubProvider: VideoProvider = {
  name: 'fal',
  configured: isFalConfigured(),
  runJob: runFalJob,
}
