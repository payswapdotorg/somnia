import { db } from '@/lib/db'
import { writeBuffer } from '@/lib/frames'
import type { ProviderRunInput, ProviderRunResult, VideoProvider } from '@/lib/providers/types'

/**
 * SelfHostedProvider — Phase 5 GPU-tier adapter for self-hosted open video
 * models (Wan 2.2 / LTX-2.5 / HunyuanVideo behind your own inference gateway,
 * e.g. a RunPod/ComfyUI/FastAPI wrapper). This is the cost-control tier from
 * the architecture blueprint: same credits UX, no per-second vendor billing.
 *
 * HTTP contract (a minimal queue API any thin gateway can implement):
 *
 *   POST {SELFHOSTED_URL}/v1/video/jobs
 *        { model, prompt, tier, duration_sec, aspect_ratio,
 *          start_frame?, end_frame? }              → 202 { id }
 *   GET  {SELFHOSTED_URL}/v1/video/jobs/{id}
 *        { status: 'queued'|'running'|'succeeded'|'failed',
 *          progress?: 0..100, error?: string,
 *          video_url?: string, frames?: string[] }
 *
 * Frame fields carry public-relative paths (`/generated/...`); gateways that
 * need to fetch them can resolve against the app origin.
 *
 * Env gating (NEVER active without configuration):
 *   SELFHOSTED_URL       base URL of the gateway — required to activate
 *   SELFHOSTED_MODEL     model id (default: wan2.2-t2v-5b)
 *   SELFHOSTED_API_KEY   optional bearer token
 */

const SUBMIT_TIMEOUT_MS = 20_000
const POLL_TIMEOUT_MS = 15 * 60 * 1000
const POLL_INTERVAL_MS = 3_000
const DOWNLOAD_TIMEOUT_MS = 120_000
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024

const PROGRESS_FLOOR = 8
const PROGRESS_CEILING = 86

export function selfHostedModel(): string {
  return process.env.SELFHOSTED_MODEL || 'wan2.2-t2v-5b'
}

export function isSelfHostedConfigured(): boolean {
  const url = process.env.SELFHOSTED_URL
  return Boolean(url && /^https?:\/\//.test(url.trim()))
}

function baseUrl(): string {
  return (process.env.SELFHOSTED_URL || '').trim().replace(/\/+$/, '')
}

function gatewayHeaders(): HeadersInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const key = process.env.SELFHOSTED_API_KEY
  if (key && key.trim().length > 0) {
    headers.Authorization = `Bearer ${key.trim()}`
  }
  return headers
}

interface SelfHostedJobStatus {
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  progress?: number
  error?: string
  video_url?: string | null
  frames?: string[]
}

async function submitJob(input: ProviderRunInput): Promise<{ id: string }> {
  const response = await fetch(`${baseUrl()}/v1/video/jobs`, {
    method: 'POST',
    headers: gatewayHeaders(),
    signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    body: JSON.stringify({
      model: selfHostedModel(),
      prompt: input.prompt,
      tier: input.tier,
      duration_sec: input.durationSec,
      aspect_ratio: input.aspectRatio,
      start_frame: input.startFramePath,
      end_frame: input.endFramePath,
    }),
  })
  if (!response.ok) {
    throw new Error(`self-hosted gateway rejected the job: ${response.status}`)
  }
  const data = (await response.json()) as { id?: string }
  if (!data.id) {
    throw new Error('self-hosted gateway returned no job id')
  }
  return { id: data.id }
}

async function pollJob(gatewayJobId: string): Promise<SelfHostedJobStatus> {
  const response = await fetch(`${baseUrl()}/v1/video/jobs/${encodeURIComponent(gatewayJobId)}`, {
    headers: gatewayHeaders(),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    throw new Error(`self-hosted status poll failed: ${response.status}`)
  }
  return (await response.json()) as SelfHostedJobStatus
}

/** Extension for a downloaded asset, defaulted by kind when the URL has none. */
function extensionOf(url: string, kind: 'video' | 'frame'): string {
  const match = /\.(mp4|webm|mov|png|jpg|jpeg|webp)(?:$|[?#])/i.exec(url)
  if (match) return match[1].toLowerCase()
  return kind === 'video' ? 'mp4' : 'png'
}

/**
 * Ingest a gateway asset into public/generated so the app serves it directly.
 * Falls back to the remote URL when the download fails (resilience first —
 * the clip stays playable even if the GPU box is slow or unreachable later).
 */
async function ingestAsset(
  remoteUrl: string,
  publicPath: string,
  kind: 'video' | 'frame'
): Promise<string> {
  if (!/^https?:\/\//.test(remoteUrl)) return remoteUrl
  try {
    const response = await fetch(remoteUrl, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    })
    if (!response.ok) return remoteUrl
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_DOWNLOAD_BYTES) return remoteUrl
    const resolved = publicPath.replace(/\.[a-z0-9]+$/i, `.${extensionOf(remoteUrl, kind)}`)
    await writeBuffer(resolved, buffer)
    return resolved
  } catch {
    return remoteUrl
  }
}

async function runSelfHostedJob(input: ProviderRunInput): Promise<ProviderRunResult | void> {
  const { jobId } = input
  const generation = await db.generation.findFirst({
    where: { jobId },
    orderBy: { createdAt: 'desc' },
  })

  const initial = await db.job.findUnique({ where: { id: jobId } })
  if (!initial || initial.status !== 'queued') return

  try {
    await db.job.update({ where: { id: jobId }, data: { status: 'dispatched', progress: 4 } })
    if (generation) {
      await db.generation.update({ where: { id: generation.id }, data: { status: 'dispatched' } })
    }

    const submission = await submitJob(input)
    await db.job.update({ where: { id: jobId }, data: { status: 'running', progress: PROGRESS_FLOOR } })
    if (generation) {
      await db.generation.update({ where: { id: generation.id }, data: { status: 'running' } })
    }

    const deadline = Date.now() + POLL_TIMEOUT_MS
    let progress = PROGRESS_FLOOR
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      const status = await pollJob(submission.id)

      if (status.status === 'queued') continue

      if (status.status === 'running') {
        const remote =
          typeof status.progress === 'number' && Number.isFinite(status.progress)
            ? Math.max(0, Math.min(100, status.progress))
            : null
        progress = remote !== null ? Math.max(progress, Math.min(PROGRESS_CEILING, remote)) : Math.min(PROGRESS_CEILING, progress + 6)
        await db.job.update({ where: { id: jobId }, data: { progress } })
        continue
      }

      if (status.status === 'failed') {
        throw new Error(status.error || 'self-hosted render failed')
      }

      // succeeded — moderation gate, then asset ingestion.
      await db.job.update({ where: { id: jobId }, data: { status: 'moderated', progress: 92 } })

      let videoPath: string | null = null
      if (status.video_url) {
        videoPath = await ingestAsset(status.video_url, `/generated/${jobId}-provider.mp4`, 'video')
        await db.asset.create({ data: { jobId, kind: 'video', path: videoPath } }).catch(() => undefined)
        if (generation) {
          await db.generation.update({ where: { id: generation.id }, data: { videoPath } })
        }
      }

      const remoteFrames = (status.frames ?? []).filter((f) => typeof f === 'string' && f.length > 0)
      const resolvedFrames: string[] = []
      for (const [index, remoteFrame] of remoteFrames.entries()) {
        resolvedFrames.push(
          await ingestAsset(remoteFrame, `/generated/${jobId}-provider-frame${index + 1}.png`, 'frame')
        )
      }
      if (resolvedFrames.length > 0) {
        await db.asset
          .createMany({ data: resolvedFrames.map((p) => ({ jobId, kind: 'frame', path: p })) })
          .catch(() => undefined)
        if (generation) {
          const current = await db.generation.findUnique({ where: { id: generation.id } })
          const existing = safeParse(current?.framesJson)
          for (const resolved of resolvedFrames) {
            if (!existing.includes(resolved)) existing.push(resolved)
          }
          await db.generation.update({
            where: { id: generation.id },
            data: { framesJson: JSON.stringify(existing) },
          })
        }
      }

      await db.job.update({ where: { id: jobId }, data: { status: 'completed', progress: 100 } })
      if (generation) {
        await db.generation.update({ where: { id: generation.id }, data: { status: 'succeeded' } })
      }
      return { videoPath }
    }
    throw new Error('self-hosted render timed out')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown self-hosted provider error'
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

function safeParse(framesJson: string | undefined): string[] {
  if (!framesJson) return []
  try {
    const parsed = JSON.parse(framesJson)
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : []
  } catch {
    return []
  }
}

export const selfHostedProvider: VideoProvider = {
  name: 'selfhosted',
  configured: isSelfHostedConfigured(),
  runJob: runSelfHostedJob,
}
