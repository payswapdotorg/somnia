// src/lib/providers/selfhosted.ts — self-hosted GPU tier adapter (T6a).
//
// The cost-control tier from the architecture blueprint: your own queue-style
// gateway around open video models (Wan 2.2 / LTX-2.5 / HunyuanVideo behind a
// RunPod/ComfyUI/FastAPI wrapper). Same credits UX, no per-second vendor
// billing. Pure HTTP — the render pipeline owns every database write.
//
// HTTP contract (a minimal queue API any thin gateway can implement):
//
//   POST {SELFHOSTED_URL}/v1/video/jobs
//        { model, prompt, resolution, duration_sec, aspect_ratio,
//          hdr, loop, start_frame?, end_frame? }     → 202 { id }
//   GET  {SELFHOSTED_URL}/v1/video/jobs/{id}
//        { status: 'queued'|'running'|'succeeded'|'failed',
//          progress?: 0..100, error?: string,
//          video_url?: string, frames?: string[] }
//
// Frame fields carry public-relative paths (`/generated/...`); gateways that
// need the pixels resolve them against the app origin.
//
// Env gating (NEVER active without configuration):
//   SELFHOSTED_URL       base URL of the gateway — required to activate
//   SELFHOSTED_MODEL     model id (default: wan2.2-t2v-5b)
//   SELFHOSTED_API_KEY   optional bearer token

import { ingestAsset, sleep, timings } from '@/lib/providers/ingest'
import type {
  HostedRenderInput,
  HostedRenderOptions,
  HostedRenderResult,
  HostedVideoProvider,
} from '@/lib/providers/types'

const SUBMIT_TIMEOUT_MS = 20_000
const POLL_TIMEOUT_MS = 15 * 60 * 1000
const POLL_INTERVAL_MS = 3_000

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

function gatewayHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const key = process.env.SELFHOSTED_API_KEY
  if (key && key.trim().length > 0) {
    headers.Authorization = `Bearer ${key.trim()}`
  }
  return headers
}

interface GatewayJobStatus {
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  progress?: number
  error?: string
  video_url?: string | null
  frames?: string[]
}

async function submitJob(input: HostedRenderInput): Promise<{ id: string }> {
  const response = await fetch(`${baseUrl()}/v1/video/jobs`, {
    method: 'POST',
    headers: gatewayHeaders(),
    signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    body: JSON.stringify({
      model: selfHostedModel(),
      prompt: input.prompt,
      resolution: input.resolution,
      duration_sec: input.durationSec,
      aspect_ratio: input.aspectRatio,
      hdr: input.hdr,
      loop: input.loop,
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

async function pollJob(gatewayJobId: string): Promise<GatewayJobStatus> {
  const response = await fetch(
    `${baseUrl()}/v1/video/jobs/${encodeURIComponent(gatewayJobId)}`,
    { headers: gatewayHeaders(), signal: AbortSignal.timeout(10_000) }
  )
  if (!response.ok) {
    throw new Error(`self-hosted status poll failed: ${response.status}`)
  }
  return (await response.json()) as GatewayJobStatus
}

async function renderSelfHosted(
  input: HostedRenderInput,
  opts?: HostedRenderOptions
): Promise<HostedRenderResult> {
  const { intervalMs, timeoutMs } = timings(POLL_INTERVAL_MS, POLL_TIMEOUT_MS)

  await opts?.onProgress?.(6)
  const submission = await submitJob(input)
  await opts?.onProgress?.(PROGRESS_FLOOR)

  const deadline = Date.now() + timeoutMs
  let progress = PROGRESS_FLOOR
  while (Date.now() < deadline) {
    await sleep(intervalMs)
    const status = await pollJob(submission.id)

    if (status.status === 'queued') continue

    if (status.status === 'running') {
      const remote =
        typeof status.progress === 'number' && Number.isFinite(status.progress)
          ? Math.max(0, Math.min(100, status.progress))
          : null
      progress =
        remote !== null
          ? Math.max(progress, Math.min(PROGRESS_CEILING, remote))
          : Math.min(PROGRESS_CEILING, progress + 6)
      await opts?.onProgress?.(progress)
      continue
    }

    if (status.status === 'failed') {
      throw new Error(status.error || 'self-hosted render failed')
    }

    // succeeded — ingest the finished clip and any remote keyframes.
    const remoteFrames = (status.frames ?? []).filter(
      (f) => typeof f === 'string' && f.length > 0
    )
    const frames: string[] = []
    for (const [index, remoteFrame] of remoteFrames.entries()) {
      frames.push(
        await ingestAsset(
          remoteFrame,
          `/generated/${input.jobId}-provider-frame${index + 1}.png`,
          'frame'
        )
      )
    }

    if (!status.video_url) {
      throw new Error('self-hosted render succeeded without a video_url')
    }
    const videoPath = await ingestAsset(
      status.video_url,
      `/generated/${input.jobId}-provider.mp4`,
      'video'
    )
    await opts?.onProgress?.(92)
    return { videoPath, frames }
  }
  throw new Error('self-hosted render timed out')
}

export const selfHostedProvider: HostedVideoProvider = {
  name: 'selfhosted',
  get configured() {
    return isSelfHostedConfigured()
  },
  render: renderSelfHosted,
}
