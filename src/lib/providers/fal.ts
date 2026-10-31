// src/lib/providers/fal.ts — fal.ai-style queue adapter (T6a).
//
// A complete hosted-API adapter following the fal queue shape:
//
//   POST   {FAL_QUEUE_BASE}/{FAL_MODEL}                        → { request_id }
//   GET    {FAL_QUEUE_BASE}/{FAL_MODEL}/requests/{id}/status   → { status: IN_QUEUE | IN_PROGRESS | COMPLETED }
//   GET    {FAL_QUEUE_BASE}/{FAL_MODEL}/requests/{id}          → { video: { url }, frames?: [{ url }] }
//
// Pure HTTP — the render pipeline owns every database write (same as the
// self-hosted tier), so charges, refunds and asset rows behave identically.
//
// Env gating (NEVER active without configuration):
//   FAL_KEY            required to activate
//   FAL_MODEL          fallback queue model id (default: fal-ai/wan-t2v)
//   FAL_MODELS         T19 per-Somnia-model queue ids, JSON
//                      ({"pulse-3":"fal-ai/wan-t2v","pulse-flash":"fal-ai/ltx-video"})
//   FAL_QUEUE_BASE     override the queue origin (tests point it at a local
//                      gateway; production default https://queue.fal.run)
//
// T19 model resolution: the FAL_MODELS mapping first; an unmapped model
// falls back to the static FAL_MODEL — never the raw Somnia id, which would
// 404 the queue path.

import { ingestAsset, sleep, timings } from '@/lib/providers/ingest'
import type {
  HostedRenderInput,
  HostedRenderOptions,
  HostedRenderResult,
  HostedVideoProvider,
} from '@/lib/providers/types'

const DEFAULT_QUEUE_BASE = 'https://queue.fal.run'
const POLL_TIMEOUT_MS = 10 * 60 * 1000
const POLL_INTERVAL_MS = 2_000

const PROGRESS_FLOOR = 8
const PROGRESS_CEILING = 86

const MODELS_ENV = 'FAL_MODELS'

export function falModel(): string {
  return process.env.FAL_MODEL || 'fal-ai/wan-t2v'
}

/**
 * T19 — per-Somnia-model queue ids from FAL_MODELS. Malformed JSON,
 * non-object shapes and non-string values are skipped — same policy-knob
 * contract as SELFHOSTED_MODELS / SOMNIA_MODEL_ROUTES.
 */
export function falModelMap(): Record<string, string> {
  const raw = process.env[MODELS_ENV]
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const out: Record<string, string> = {}
  for (const [model, name] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof name === 'string' && name.trim().length > 0) out[model] = name.trim()
  }
  return out
}

/**
 * T19 — the queue model id for this job: the FAL_MODELS mapping when set,
 * else the static FAL_MODEL. A raw Somnia id never reaches the queue path.
 */
export function falModelFor(model: string | null | undefined): string {
  const mapped = model ? falModelMap()[model] : undefined
  if (mapped) return mapped
  return falModel()
}

export function isFalConfigured(): boolean {
  return Boolean(process.env.FAL_KEY && process.env.FAL_KEY.trim().length > 0)
}

function queueBase(): string {
  return (process.env.FAL_QUEUE_BASE || DEFAULT_QUEUE_BASE).trim().replace(/\/+$/, '')
}

function falHeaders(): Record<string, string> {
  return {
    Authorization: `Key ${process.env.FAL_KEY}`,
    'Content-Type': 'application/json',
  }
}

interface FalSubmitResponse {
  request_id: string
  status_url?: string
  response_url?: string
}

interface FalQueueStatus {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED'
  queue_position?: number
}

interface FalQueueResult {
  video?: { url?: string }
  frames?: Array<{ url?: string }>
}

async function submitToFalQueue(input: HostedRenderInput): Promise<FalSubmitResponse> {
  const response = await fetch(`${queueBase()}/${falModelFor(input.model)}`, {
    method: 'POST',
    headers: falHeaders(),
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      prompt: input.prompt,
      resolution: input.resolution,
      duration_sec: input.durationSec,
      aspect_ratio: input.aspectRatio,
      image_url: input.startFramePath,
      end_image_url: input.endFramePath,
    }),
  })
  if (!response.ok) {
    throw new Error(`fal queue submit failed: ${response.status}`)
  }
  const data = (await response.json()) as FalSubmitResponse
  if (!data.request_id) {
    throw new Error('fal queue submit returned no request_id')
  }
  return data
}

async function pollFalStatus(requestId: string): Promise<FalQueueStatus> {
  const response = await fetch(
    `${queueBase()}/${falModel()}/requests/${encodeURIComponent(requestId)}/status`,
    { headers: falHeaders(), signal: AbortSignal.timeout(10_000) }
  )
  if (!response.ok) {
    throw new Error(`fal status poll failed: ${response.status}`)
  }
  return (await response.json()) as FalQueueStatus
}

async function fetchFalResult(requestId: string): Promise<FalQueueResult> {
  const response = await fetch(
    `${queueBase()}/${falModel()}/requests/${encodeURIComponent(requestId)}`,
    { headers: falHeaders(), signal: AbortSignal.timeout(20_000) }
  )
  if (!response.ok) {
    throw new Error(`fal result fetch failed: ${response.status}`)
  }
  return (await response.json()) as FalQueueResult
}

async function renderFal(
  input: HostedRenderInput,
  opts?: HostedRenderOptions
): Promise<HostedRenderResult> {
  const { intervalMs, timeoutMs } = timings(POLL_INTERVAL_MS, POLL_TIMEOUT_MS)

  await opts?.onProgress?.(6)
  const submission = await submitToFalQueue(input)
  await opts?.onProgress?.(PROGRESS_FLOOR)

  const deadline = Date.now() + timeoutMs
  let progress = PROGRESS_FLOOR
  while (Date.now() < deadline) {
    await sleep(intervalMs)
    const status = await pollFalStatus(submission.request_id)

    if (status.status === 'IN_QUEUE') continue

    if (status.status === 'IN_PROGRESS') {
      progress = Math.min(PROGRESS_CEILING, progress + 6)
      await opts?.onProgress?.(progress)
      continue
    }

    // COMPLETED — fetch the payload, ingest the clip and any frames.
    const result = await fetchFalResult(submission.request_id)

    const frames: string[] = []
    for (const [index, frame] of (result.frames ?? []).entries()) {
      if (!frame.url) continue
      frames.push(
        await ingestAsset(
          frame.url,
          `/generated/${input.jobId}-provider-frame${index + 1}.png`,
          'frame'
        )
      )
    }

    const videoUrl = result.video?.url
    if (!videoUrl) {
      throw new Error('fal result carried no video url')
    }
    const videoPath = await ingestAsset(
      videoUrl,
      `/generated/${input.jobId}-provider.mp4`,
      'video'
    )
    await opts?.onProgress?.(92)
    return { videoPath, frames }
  }
  throw new Error('fal queue polling timed out')
}

export const falProvider: HostedVideoProvider = {
  name: 'fal',
  get configured() {
    return isFalConfigured()
  },
  render: renderFal,
}
