import { db } from '@/lib/db'
import { framePath, writeBase64Png, writePlaceholderFrame } from '@/lib/frames'
import type { AspectRatio } from '@/lib/pricing'
import type { ProviderRunInput, ProviderRunResult, VideoProvider } from '@/lib/providers/types'
import { renderVideo } from '@/lib/video'

/**
 * DemoProvider — the active Reelforge engine.
 *
 * Simulates a realistic generation lifecycle:
 *   queued → dispatched (~1.2s) → running (progress ticks persisted to DB over
 *   ~13s) → moderated → video composite → completed.
 *
 * Keyframes are attempted with the server-side z-ai image generation SDK; if
 * that fails or times out, an original branded SVG placeholder (gradient +
 * prompt text, rasterized to PNG) lands at the exact same path.
 *
 * Phase 2: after the storyboard lands, the ordered stills (optional pinned
 * start frame + keyframes + optional pinned end frame) are composited into a
 * real MP4 clip (Ken Burns zoom + crossfades) via the system ffmpeg. If video
 * rendering fails or times out, the job still completes with frames only.
 */

const SIZE_BY_ASPECT: Record<AspectRatio, '1024x1024' | '768x1344' | '1344x768'> = {
  '16:9': '1344x768',
  '9:16': '768x1344',
  '1:1': '1024x1024',
}

const STORYBOARD_BEATS = [
  'wide establishing shot that sets the scene',
  'medium shot with the main subject in focus and implied motion',
  'closing shot with tighter framing and atmospheric detail',
] as const

const DISPATCH_DELAY_MS = 1200
const RUN_DELAY_MS = 800
const TICK_INTERVAL_MS = 1000
const TICK_PROGRESS = 6
const PROGRESS_FLOOR_WHILE_RUNNING = 8
const PROGRESS_CEILING = 86
const MODERATION_DELAY_MS = 700
// The image API is slow (observed 26-60s) and rate-limits bursts, so each
// keyframe gets a bounded attempt window: staggered starts, one try, then a
// branded placeholder lands at the same path. This keeps every job under ~35s.
// Operators with a faster/image API can raise the budget via env var (e.g.
// long-latency sandboxes where real keyframes beat fast placeholders).
const IMAGE_TIMEOUT_MS = Number(process.env.REELFORGE_IMAGE_TIMEOUT_MS ?? 28000)
const FRAME_STAGGER_MS = 1200

// Video render phase (progress creeps while ffmpeg composites the clip).
const RENDER_PROGRESS_FLOOR = 93
const RENDER_PROGRESS_CEILING = 98

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    sleep(ms).then(() => null),
  ])
}

/** Try the real image SDK; resolve to base64 PNG data or null on any failure.
 * The SDK import is dynamic so environments where it cannot initialize
 * (e.g. serverless without its credentials) fall straight through to the
 * branded placeholder instead of failing the whole module. */
async function generateKeyframeBase64(
  prompt: string,
  beat: string,
  aspectRatio: AspectRatio
): Promise<string | null> {
  try {
    const { default: ZAI } = await import('z-ai-web-dev-sdk')
    const zai = await ZAI.create()
    const response = await zai.images.generations.create({
      prompt: `${prompt}. Storyboard keyframe: ${beat}. Cinematic lighting, rich color, high detail.`,
      size: SIZE_BY_ASPECT[aspectRatio],
    })
    const base64 = response?.data?.[0]?.base64
    return typeof base64 === 'string' && base64.length > 32 ? base64 : null
  } catch (error) {
    console.warn('[DemoProvider] keyframe SDK call failed, using placeholder:', (error as Error)?.message)
    return null
  }
}

async function produceFrame(
  jobId: string,
  prompt: string,
  frameNumber: number,
  aspectRatio: AspectRatio
): Promise<string> {
  const publicPath = framePath(jobId, frameNumber)
  const beat = STORYBOARD_BEATS[(frameNumber - 1) % STORYBOARD_BEATS.length]
  const base64 = await withTimeout(
    generateKeyframeBase64(prompt, beat, aspectRatio),
    IMAGE_TIMEOUT_MS
  )
  if (base64) {
    try {
      await writeBase64Png(publicPath, base64)
      return publicPath
    } catch (error) {
      console.warn('[DemoProvider] failed to write SDK keyframe:', (error as Error)?.message)
    }
  }
  return writePlaceholderFrame({ jobId, frameNumber, prompt, aspectRatio })
}

function safeParseFrames(framesJson: string): string[] {
  try {
    const parsed = JSON.parse(framesJson)
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : []
  } catch {
    return []
  }
}

/** Storyboard order (frame1..N) regardless of completion order. */
function storyboardOrder(frames: string[]): string[] {
  const ordinal = (p: string) => {
    const match = /-frame(\d+)\.png$/.exec(p)
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
  }
  return [...frames].sort((a, b) => ordinal(a) - ordinal(b))
}

/** Serialized appender so parallel frame writers never clobber framesJson. */
function makeFrameAppender(generationId: string) {
  let queue: Promise<void> = Promise.resolve()
  return (publicPath: string): Promise<void> => {
    queue = queue.then(async () => {
      const generation = await db.generation.findUnique({ where: { id: generationId } })
      if (!generation) return
      const frames = safeParseFrames(generation.framesJson)
      if (!frames.includes(publicPath)) frames.push(publicPath)
      await db.generation.update({
        where: { id: generation.id },
        data: { framesJson: JSON.stringify(frames) },
      })
    })
    return queue
  }
}

async function runDemoJob(input: ProviderRunInput): Promise<ProviderRunResult | void> {
  const { jobId, prompt, aspectRatio, tier, durationSec, startFramePath, endFramePath } = input
  const generation = await db.generation.findFirst({ where: { jobId }, orderBy: { createdAt: 'desc' } })

  // Guard against double-dispatch.
  const initial = await db.job.findUnique({ where: { id: jobId } })
  if (!initial || initial.status !== 'queued') return

  let ticker: ReturnType<typeof setInterval> | null = null
  const stopTicker = () => {
    if (ticker) {
      clearInterval(ticker)
      ticker = null
    }
  }

  try {
    await sleep(DISPATCH_DELAY_MS)
    await db.job.update({
      where: { id: jobId },
      data: { status: 'dispatched', progress: 4 },
    })
    if (generation) {
      await db.generation.update({ where: { id: generation.id }, data: { status: 'dispatched' } })
    }

    await sleep(RUN_DELAY_MS)
    await db.job.update({
      where: { id: jobId },
      data: { status: 'running', progress: PROGRESS_FLOOR_WHILE_RUNNING },
    })
    if (generation) {
      await db.generation.update({ where: { id: generation.id }, data: { status: 'running' } })
    }

    // Progress ticker: climb toward the ceiling while frames render.
    ticker = setInterval(() => {
      void (async () => {
        try {
          const job = await db.job.findUnique({ where: { id: jobId } })
          if (!job || job.status !== 'running') {
            stopTicker()
            return
          }
          const next = Math.min(PROGRESS_CEILING, job.progress + TICK_PROGRESS)
          if (next !== job.progress) {
            await db.job.update({ where: { id: jobId }, data: { progress: next } })
          }
        } catch {
          /* a transient tick failure is fine */
        }
      })()
    }, TICK_INTERVAL_MS)

    // Render the three keyframes (SDK first, branded placeholder on failure).
    // Staggered starts avoid tripping the image API's burst rate limit.
    const appendFrame = generation ? makeFrameAppender(generation.id) : null
    await Promise.all(
      [1, 2, 3].map(async (frameNumber) => {
        await sleep((frameNumber - 1) * FRAME_STAGGER_MS)
        const publicPath = await produceFrame(jobId, prompt, frameNumber, aspectRatio)
        if (appendFrame) await appendFrame(publicPath)
      })
    )
    stopTicker()

    // Moderation gate on produced frames (demo pass-through).
    await db.job.update({
      where: { id: jobId },
      data: { status: 'moderated', progress: RENDER_PROGRESS_FLOOR },
    })
    await sleep(MODERATION_DELAY_MS)

    // Record frame assets.
    const finalGeneration = generation
      ? await db.generation.findUnique({ where: { id: generation.id } })
      : null
    const frames: string[] = finalGeneration
      ? storyboardOrder(safeParseFrames(finalGeneration.framesJson))
      : [1, 2, 3].map((n) => framePath(jobId, n))

    if (frames.length > 0) {
      await db.asset.createMany({
        data: frames.map((p) => ({ jobId, kind: 'frame', path: p })),
      })
    }

    // Video phase: composite [start?, keyframes..., end?] into a real clip.
    // ffmpeg failures are logged and skipped — the job still completes.
    ticker = setInterval(() => {
      void (async () => {
        try {
          const job = await db.job.findUnique({ where: { id: jobId } })
          if (!job || job.status !== 'moderated') {
            stopTicker()
            return
          }
          const next = Math.min(RENDER_PROGRESS_CEILING, job.progress + 1)
          if (next !== job.progress) {
            await db.job.update({ where: { id: jobId }, data: { progress: next } })
          }
        } catch {
          /* a transient tick failure is fine */
        }
      })()
    }, TICK_INTERVAL_MS)

    const segments = [startFramePath, ...frames, endFramePath].filter(
      (p): p is string => typeof p === 'string' && p.length > 0
    )
    let video: string | null = null
    try {
      video = await renderVideo({ jobId, tier, aspectRatio, durationSec, segments })
    } catch (error) {
      // renderVideo is non-throwing by contract; this is a belt-and-braces guard.
      console.error('[DemoProvider] video render threw unexpectedly:', (error as Error)?.message)
      video = null
    }
    stopTicker()

    if (video && generation) {
      await db.generation.update({ where: { id: generation.id }, data: { videoPath: video } })
      await db.asset.create({ data: { jobId, kind: 'video', path: video } }).catch(() => undefined)
    }

    await db.job.update({
      where: { id: jobId },
      data: { status: 'completed', progress: 100 },
    })
    if (generation) {
      await db.generation.update({
        where: { id: generation.id },
        data: { status: 'succeeded' },
      })
    }
    return { videoPath: video }
  } catch (error) {
    stopTicker()
    const message = error instanceof Error ? error.message : 'Unknown provider error'
    await db.job
      .update({
        where: { id: jobId },
        data: { status: 'failed', errorMessage: message },
      })
      .catch(() => undefined)
    if (generation) {
      await db.generation
        .update({ where: { id: generation.id }, data: { status: 'failed' } })
        .catch(() => undefined)
    }
  }
}

export const demoProvider: VideoProvider = {
  name: 'demo',
  configured: true,
  runJob: runDemoJob,
}
