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
//          hdr, loop, start_frame?, end_frame?, keyframes }  → 202 { id }
//   GET  {SELFHOSTED_URL}/v1/video/jobs/{id}
//        { status: 'queued'|'running'|'succeeded'|'failed',
//          progress?: 0..100, error?: string,
//          video_url?: string, frames?: string[] }
//
// T16 — the same gateway serves prism stills:
//
//   POST {SELFHOSTED_URL}/v1/image/jobs
//        { model, prompt, resolution, aspect_ratio, start_frame?,
//          keyframes }  → 202 { id }
//   GET  {SELFHOSTED_URL}/v1/image/jobs/{id}
//        { status, progress?, error?, image_url? }
//
// Frame fields carry public-relative paths (`/generated/...`) or durable
// absolute URLs (blob CDN); gateways that need the pixels resolve them
// (absolute URLs fetch directly, relative paths against the app origin).
// `keyframes` is the job's full ordered pinned timeline — compositing
// gateways render the user's own imagery verbatim instead of regenerating
// a storyboard; it is an empty array for prompt-only jobs.
//
// Env gating (NEVER active without configuration):
//   SELFHOSTED_URL       base URL of the gateway — required to activate
//   SELFHOSTED_MODEL     model id (default: wan2.2-t2v-5b)
//   SELFHOSTED_API_KEY   optional bearer token

import { ingestAsset, sleep, timings } from '@/lib/providers/ingest'
import type {
  HostedImageInput,
  HostedImageResult,
  HostedRenderInput,
  HostedRenderOptions,
  HostedRenderResult,
  HostedVideoProvider,
} from '@/lib/providers/types'

const SUBMIT_TIMEOUT_MS = 20_000
const POLL_TIMEOUT_MS = 15 * 60 * 1000
const POLL_INTERVAL_MS = 3_000

// T15 transient-hiccup resilience: a real self-hosted gateway restarts
// (sandbox recycle, supervisor respawn) and its edge answers 401/502/503 for
// a moment. One submit retry + a small consecutive-poll tolerance rides out
// exactly that window; anything persistent still fails and refunds.
const SUBMIT_ATTEMPTS = 2
const POLL_FAILURE_TOLERANCE = 2
const RETRY_DELAY_MS = process.env.SOMNIA_TEST ? 15 : 2_000

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

interface GatewayImageJobStatus {
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  progress?: number
  error?: string
  image_url?: string | null
}

async function submitJobOnce(input: HostedRenderInput): Promise<{ id: string }> {
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
      // T15: the full pinned timeline — always present (empty for prompt-only
      // jobs) so gateways can composite the user's imagery verbatim.
      keyframes: input.keyframes ?? [],
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

/** Submit with one retry — rides out a gateway restart blip, fails fast on a persistent one. */
async function submitJob(input: HostedRenderInput): Promise<{ id: string }> {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= SUBMIT_ATTEMPTS; attempt++) {
    if (attempt > 1) await sleep(RETRY_DELAY_MS)
    try {
      return await submitJobOnce(input)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

// T16 — prism stills ride the same gateway, the same resilience contract.
async function submitImageJobOnce(input: HostedImageInput): Promise<{ id: string }> {
  const response = await fetch(`${baseUrl()}/v1/image/jobs`, {
    method: 'POST',
    headers: gatewayHeaders(),
    signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    body: JSON.stringify({
      model: selfHostedModel(),
      prompt: input.prompt,
      resolution: input.resolution,
      aspect_ratio: input.aspectRatio,
      start_frame: input.startFramePath,
      // A pinned still IS the user's imagery — pass it verbatim.
      keyframes: input.keyframes ?? [],
    }),
  })
  if (!response.ok) {
    throw new Error(`self-hosted gateway rejected the still job: ${response.status}`)
  }
  const data = (await response.json()) as { id?: string }
  if (!data.id) {
    throw new Error('self-hosted gateway returned no still job id')
  }
  return { id: data.id }
}

async function submitImageJob(input: HostedImageInput): Promise<{ id: string }> {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= SUBMIT_ATTEMPTS; attempt++) {
    if (attempt > 1) await sleep(RETRY_DELAY_MS)
    try {
      return await submitImageJobOnce(input)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
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

async function pollImageJob(gatewayJobId: string): Promise<GatewayImageJobStatus> {
  const response = await fetch(
    `${baseUrl()}/v1/image/jobs/${encodeURIComponent(gatewayJobId)}`,
    { headers: gatewayHeaders(), signal: AbortSignal.timeout(10_000) }
  )
  if (!response.ok) {
    throw new Error(`self-hosted image poll failed: ${response.status}`)
  }
  return (await response.json()) as GatewayImageJobStatus
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
  let pollFailures = 0
  while (Date.now() < deadline) {
    await sleep(intervalMs)
    let status: GatewayJobStatus
    try {
      status = await pollJob(submission.id)
      pollFailures = 0
    } catch (error) {
      // T15: a single dropped poll (edge hiccup, gateway restart) must not
      // fail a charged render — tolerate a couple in a row, then give up.
      pollFailures += 1
      if (pollFailures > POLL_FAILURE_TOLERANCE) throw error
      continue
    }

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

/**
 * T16 — render one prism still through the gateway: submit → poll → ingest
 * the finished image. Same poll-tolerance and deadline semantics as video;
 * a still that succeeds without an image_url is a contract violation and
 * fails honestly.
 */
async function renderStillSelfHosted(
  input: HostedImageInput,
  opts?: HostedRenderOptions
): Promise<HostedImageResult> {
  const { intervalMs, timeoutMs } = timings(POLL_INTERVAL_MS, POLL_TIMEOUT_MS)

  await opts?.onProgress?.(6)
  const submission = await submitImageJob(input)
  await opts?.onProgress?.(PROGRESS_FLOOR)

  const deadline = Date.now() + timeoutMs
  let progress = PROGRESS_FLOOR
  let pollFailures = 0
  while (Date.now() < deadline) {
    await sleep(intervalMs)
    let status: GatewayImageJobStatus
    try {
      status = await pollImageJob(submission.id)
      pollFailures = 0
    } catch (error) {
      pollFailures += 1
      if (pollFailures > POLL_FAILURE_TOLERANCE) throw error
      continue
    }

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
      throw new Error(status.error || 'self-hosted still render failed')
    }

    if (!status.image_url) {
      throw new Error('self-hosted still render succeeded without an image_url')
    }
    const imagePath = await ingestAsset(
      status.image_url,
      `/generated/${input.jobId}-still.png`,
      'frame'
    )
    await opts?.onProgress?.(92)
    return { imagePath }
  }
  throw new Error('self-hosted still render timed out')
}

export const selfHostedProvider: HostedVideoProvider = {
  name: 'selfhosted',
  get configured() {
    return isSelfHostedConfigured()
  },
  render: renderSelfHosted,
  imageCapable: true,
  renderStill: renderStillSelfHosted,
}
