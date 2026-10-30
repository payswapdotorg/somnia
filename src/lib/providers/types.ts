// src/lib/providers/types.ts — hosted video provider contract (T6a).
//
// Adapters are PURE HTTP + download: they submit a queued Somnia video job
// to a remote renderer, poll it to completion and ingest the finished MP4
// (plus any remote keyframes) into public/generated. They never touch the
// database — the render pipeline (src/lib/pipeline.ts) owns all job state,
// asset rows and the engine's refund/completion semantics, so hosted and
// local renders fail and settle identically.

/** Everything a hosted renderer needs for one queued video job. */
export interface HostedRenderInput {
  jobId: string
  prompt: string
  /** Somnia model id (pulse-3 | pulse-flash | prism). */
  model: string
  /** 540p | 720p | 1080p. */
  resolution: string
  /** 16:9 | 9:16 | 1:1 | 4:3 | 3:4 | 21:9 | 9:21. */
  aspectRatio: string
  durationSec: number
  hdr: boolean
  loop: boolean
  /** Pinned first frame (public-relative path); gateways resolve against origin. */
  startFramePath: string | null
  /** Pinned last frame (public-relative path). */
  endFramePath: string | null
  /**
   * T15 pinned-timeline fidelity: the job's ordered pinned keyframes (durable
   * references — blob URLs in production, public-relative paths in dev/test).
   * Gateways that composite user imagery should use these verbatim instead of
   * regenerating the storyboard from the prompt; empty for prompt-only jobs.
   * Optional so adapters with fixed vendor payloads (fal) can omit it.
   */
  keyframes?: string[]
}

export interface HostedRenderResult {
  /** Ingested public-relative local path (or the remote URL if the download failed). */
  videoPath: string
  /** Ingested keyframe paths (public-relative; empty when the renderer sends none). */
  frames: string[]
}

export interface HostedRenderOptions {
  /** Progress mirror hook (0..100) — called between polls and at milestones. */
  onProgress?: (pct: number) => Promise<void> | void
}

export interface HostedVideoProvider {
  name: 'selfhosted' | 'fal'
  /** Dynamic env probe — re-read on every access so tests can toggle config. */
  configured: boolean
  render(input: HostedRenderInput, opts?: HostedRenderOptions): Promise<HostedRenderResult>
}
