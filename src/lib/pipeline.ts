// src/lib/pipeline.ts — the Somnia render pipeline (T5).
//
// Drives a queued Job all the way to a finished asset:
//   video: ordered timeline [start?, beats, end?] → ffmpeg Ken Burns MP4
//   image: one generated still → poster asset
//
// Frame imagery comes from a FrameSource. The default source tries the
// server-side image SDK and falls back to an original Somnia-branded
// placeholder — tests inject a fake so nothing here touches the network.
//
// T6a — hosted tiers: when SELFHOSTED_URL / FAL_KEY is configured the VIDEO
// path delegates to the hosted provider (submit → poll → ingest the finished
// MP4) instead of compositing keyframes locally. IMAGE jobs always keep the
// local prism path. Hosted and local renders share the exact same DB
// semantics: only `queued` jobs are picked up, failures refund through
// markJobFailed, completion lands the asset rows via markJobCompleted.
//
// Statuses flow queued → running → completed | failed. Processing is
// idempotent: anything not `queued` (moderated, completed, failed,
// already-running) is returned untouched.
//
// The SDK import stays dynamic: environments where it cannot initialize
// (serverless without credentials) fall straight through to the
// placeholder instead of failing the module.

import sharp from 'sharp'
import { db } from '@/lib/db'
import { markJobCompleted, markJobFailed } from '@/lib/engine'
import { providerCostUsd } from '@/lib/economics'
import { framePath, writeBuffer } from '@/lib/frames'
import { renderVideo } from '@/lib/video'
import { failoverOrder } from '@/lib/routing'
import type { HostedRenderResult, HostedVideoProvider } from '@/lib/providers'
import type { Job } from '@prisma/client'

// ---------------------------------------------------------------- frame source

export interface FrameSource {
  /** Produce one keyframe image; null = caller should use the placeholder. */
  generate(prompt: string, beat: string, aspectRatio: string): Promise<Buffer | null>
}

const STORYBOARD_BEATS = [
  'wide establishing shot that sets the scene',
  'medium shot with the main subject in focus and implied motion',
  'closing shot with tighter framing and atmospheric detail',
  'insert detail beat that deepens the mood',
  'final payoff shot with cinematic closure',
] as const

/** Storyboard density: 5s clips get 3 beats, 10s clips get 5. */
export function beatCount(durationSec: number): number {
  return durationSec >= 10 ? 5 : 3
}

type SdkSize = '1344x768' | '768x1344' | '1024x1024'

const SDK_SIZE: Record<string, SdkSize> = {
  '16:9': '1344x768',
  '21:9': '1344x768',
  '9:16': '768x1344',
  '9:21': '768x1344',
  '1:1': '1024x1024',
  '4:3': '1024x1024',
  '3:4': '1024x1024',
}

async function generateWithSdk(
  prompt: string,
  beat: string,
  aspectRatio: string
): Promise<Buffer | null> {
  try {
    const { default: ZAI } = await import('z-ai-web-dev-sdk')
    const zai = await ZAI.create()
    const response = await zai.images.generations.create({
      prompt: `${prompt}. Storyboard keyframe: ${beat}. Cinematic lighting, rich color, high detail.`,
      size: SDK_SIZE[aspectRatio] ?? ('1024x1024' as SdkSize),
    })
    const base64 = response?.data?.[0]?.base64
    if (typeof base64 !== 'string' || base64.length < 32) return null
    return Buffer.from(base64, 'base64')
  } catch (error) {
    console.warn(
      '[pipeline] keyframe SDK call failed, using placeholder:',
      (error as Error)?.message
    )
    return null
  }
}

/** The production source: real imagery when the SDK is reachable. */
export const defaultFrameSource: FrameSource = { generate: generateWithSdk }

// ---------------------------------------------------------------- placeholder

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function truncate(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

/** Placeholder canvas: 768 short side, sized to the job's aspect. */
function placeholderDims(aspectRatio: string): { w: number; h: number } {
  const [a, b] = aspectRatio.split(':').map((n) => Number(n) || 1)
  if (a >= b) return { w: Math.round((768 * a) / b), h: 768 }
  return { w: 768, h: Math.round((768 * b) / a) }
}

/** Original Somnia placeholder keyframe (SVG rasterized to PNG). */
async function placeholderBuffer(
  prompt: string,
  index: number,
  count: number,
  aspectRatio: string
): Promise<Buffer> {
  const { w, h } = placeholderDims(aspectRatio)
  const fontSize = Math.round(w / 28)
  const escaped = escapeXml(truncate(prompt, 130))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f0c1d"/>
      <stop offset="55%" stop-color="#1e1b33"/>
      <stop offset="100%" stop-color="#2b1b3d"/>
    </linearGradient>
    <linearGradient id="dream" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="#6366f1"/>
      <stop offset="100%" stop-color="#d946ef"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.42" r="0.65">
      <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.34"/>
      <stop offset="100%" stop-color="#8b5cf6" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect width="${w}" height="${h}" fill="url(#glow)"/>
  <circle cx="${w * 0.5}" cy="${h * 0.4}" r="${w * 0.09}" fill="url(#dream)" opacity="0.9"/>
  <text x="${w / 2}" y="${h * 0.41}" font-family="Georgia, 'Times New Roman', serif" font-size="${fontSize}" fill="#0f0c1d" text-anchor="middle" font-weight="bold">S${index}</text>
  <text x="${w / 2}" y="${h * 0.66}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize * 0.85}" fill="#c4b5fd" text-anchor="middle" letter-spacing="6">SOMNIA KEYFRAME ${index} / ${count}</text>
  <text x="${w / 2}" y="${h * 0.75}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize * 0.75}" fill="#e4e4e7" text-anchor="middle" opacity="0.85">${escaped}</text>
  <text x="${w / 2}" y="${h - h * 0.06}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize * 0.62}" fill="#a1a1aa" text-anchor="middle" letter-spacing="3">SOMNIA PLACEHOLDER — SIMULATED RENDER</text>
</svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

// ---------------------------------------------------------------- processing

function stillPath(jobId: string): string {
  return `/generated/${jobId}-still.png`
}

export interface ProcessOptions {
  frameSource?: FrameSource
  /** Hosted video provider override (null forces the local demo path). */
  provider?: HostedVideoProvider | null
}

/**
 * Process one job end-to-end. Idempotent: only `queued` jobs are picked up
 * (moderated prompts and finished jobs return untouched). Failures refund.
 */
export async function processJob(jobId: string, opts: ProcessOptions = {}): Promise<Job> {
  const job = await db.job.findUnique({ where: { id: jobId } })
  if (!job) throw new Error('job not found')
  if (job.status !== 'queued') return job

  const source = opts.frameSource ?? defaultFrameSource
  // T12 — multi-model routing: the render order for this job's model (the
  // pinned route first, then the remaining configured tiers as failover
  // candidates). An explicit opts.provider pins exactly one tier; null
  // forces the local composite path. Hosted tiers render VIDEO jobs only —
  // prism stills always stay local.
  const chain: HostedVideoProvider[] =
    job.kind === 'video'
      ? opts.provider !== undefined
        ? opts.provider
          ? [opts.provider]
          : []
        : failoverOrder(job.model)
      : []

  // T7 — provider economics: stamp what this render costs the operator at
  // dispatch time. Demo/local compositing is free; hosted tiers look up the
  // per-model table (env-overridable). The stamp survives failures on
  // purpose: a failed hosted render still burns real GPU/API money, while
  // the customer is made whole through the engine's refund. T12: when a
  // failover completes on a different tier, the stamp is corrected below to
  // the provider that actually rendered — Insights margins stay honest.
  const costInput = {
    kind: job.kind,
    model: job.model,
    resolution: job.resolution,
    durationSec: job.durationSec || 5,
    hdr: job.hdr,
    loop: job.loop,
  } as const
  const providerName = chain[0]?.name ?? 'demo'
  const costUsd = providerCostUsd({ provider: providerName, ...costInput })
  const generation = await db.generation.create({
    data: { jobId: job.id, provider: providerName, status: 'running' },
  })
  await db.job.update({
    where: { id: job.id },
    data: { status: 'running', progress: 12, providerCostUsd: costUsd },
  })

  try {
    if (job.kind === 'image') {
      const buffer = await source.generate(job.prompt, 'still image', job.aspectRatio)
      const png =
        buffer ?? (await placeholderBuffer(job.prompt, 1, 1, job.aspectRatio))
      // writeBuffer returns the durable reference (blob URL when a store is
      // wired) — the database remembers that, not the ephemeral local path
      const imagePath = await writeBuffer(stillPath(job.id), png)
      await db.job.update({ where: { id: job.id }, data: { progress: 80 } })
      await markJobCompleted(job.id, { imagePath })
      await db.generation.update({
        where: { id: generation.id },
        data: { status: 'succeeded', imagePath },
      })
    } else if (chain.length > 0) {
      // ---- hosted tiers: try each in failover order ----
      let result: HostedRenderResult | null = null
      let renderedBy: HostedVideoProvider | null = null
      let lastError: unknown = null
      for (const provider of chain) {
        try {
          result = await provider.render(
            {
              jobId: job.id,
              prompt: job.prompt,
              model: job.model,
              resolution: job.resolution,
              aspectRatio: job.aspectRatio,
              durationSec: job.durationSec || 5,
              hdr: job.hdr,
              loop: job.loop,
              startFramePath: job.startFramePath,
              endFramePath: job.endFramePath,
            },
            {
              onProgress: async (pct) => {
                await db.job
                  .update({
                    where: { id: job.id },
                    data: { progress: Math.max(0, Math.min(99, pct)) },
                  })
                  .catch(() => undefined)
              },
            }
          )
          renderedBy = provider
          break
        } catch (error) {
          lastError = error
          console.warn(
            `[pipeline] provider ${provider.name} failed for job ${job.id}${
              chain.some((p) => p.name !== provider.name) ? ', trying the next tier' : ''
            }:`,
            (error as Error)?.message ?? error
          )
        }
      }
      if (!result || !renderedBy) {
        // every configured tier failed — fail and refund; never silently
        // degrade a paid render to the local placeholder pipeline
        throw lastError instanceof Error ? lastError : new Error(String(lastError))
      }
      if (renderedBy.name !== providerName) {
        // T12 failover bookkeeping: the operator pays (and Insights reports)
        // the tier that ACTUALLY rendered, not the one that was routed first
        await db.job
          .update({
            where: { id: job.id },
            data: {
              providerCostUsd: providerCostUsd({ provider: renderedBy.name, ...costInput }),
            },
          })
          .catch(() => undefined)
        await db.generation
          .update({ where: { id: generation.id }, data: { provider: renderedBy.name } })
          .catch(() => undefined)
      }

      if (result.frames.length > 0) {
        await db.asset.createMany({
          data: result.frames.map((p) => ({ jobId: job.id, kind: 'frame', path: p })),
        })
      }
      await markJobCompleted(job.id, { videoPath: result.videoPath })
      await db.generation.update({
        where: { id: generation.id },
        data: {
          status: 'succeeded',
          framesJson: JSON.stringify(result.frames),
          videoPath: result.videoPath,
        },
      })
    } else {
      // ---- build the ordered timeline ----
      const pinned = await db.keyframe.findMany({
        where: { jobId: job.id },
        orderBy: { order: 'asc' },
      })

      let middle: string[]
      if (pinned.length > 0) {
        // A pinned timeline IS the storyboard — the engine already mirrored
        // its first/last frames into startFramePath/endFramePath, so use the
        // timeline directly (no duplication, no generation).
        middle = pinned.map((k) => k.path)
      } else {
        const count = beatCount(job.durationSec)
        middle = []
        for (let i = 1; i <= count; i++) {
          const buffer = await source.generate(
            job.prompt,
            STORYBOARD_BEATS[(i - 1) % STORYBOARD_BEATS.length],
            job.aspectRatio
          )
          const png =
            buffer ?? (await placeholderBuffer(job.prompt, i, count, job.aspectRatio))
          const durablePath = await writeBuffer(framePath(job.id, i), png)
          middle.push(durablePath)
        }
        await db.asset.createMany({
          data: middle.map((p) => ({ jobId: job.id, kind: 'frame', path: p })),
        })
      }

      const segments =
        pinned.length > 0
          ? middle
          : [job.startFramePath, ...middle, job.endFramePath].filter(
              (p): p is string => typeof p === 'string' && p.length > 0
            )

      await db.job.update({ where: { id: job.id }, data: { progress: 55 } })

      // ---- composite (renderVideo never throws; null = frames-only) ----
      const video = await renderVideo({
        jobId: job.id,
        resolution: job.resolution as '540p' | '720p' | '1080p',
        aspectRatio: job.aspectRatio as never,
        durationSec: job.durationSec || 5,
        segments,
      })

      await markJobCompleted(job.id, video ? { videoPath: video } : undefined)
      await db.generation.update({
        where: { id: generation.id },
        data: {
          status: 'succeeded',
          framesJson: JSON.stringify(segments),
          videoPath: video,
        },
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await markJobFailed(job.id, message)
    await db.generation
      .update({ where: { id: generation.id }, data: { status: 'failed' } })
      .catch(() => undefined)
  }

  return db.job.findUniqueOrThrow({ where: { id: job.id } })
}

/** Sweep every queued job (oldest first). Returns how many were processed. */
export async function processQueuedJobs(
  opts: ProcessOptions = {},
  limit = 10
): Promise<number> {
  const queued = await db.job.findMany({
    where: { status: 'queued' },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true },
  })
  for (const { id } of queued) {
    await processJob(id, opts)
  }
  return queued.length
}
