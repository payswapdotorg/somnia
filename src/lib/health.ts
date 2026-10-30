import { spawn } from 'node:child_process'
import { resolveFfmpegBin } from '@/lib/runtime'
import { resolveVideoProvider } from '@/lib/providers'
import { isBlobConfigured } from '@/lib/blob'
import { effectiveRoutes, effectiveImageRoutes } from '@/lib/routing'
import { hostedLlmConfig } from '@/lib/llm'
import { imageSdkProbe } from '@/lib/pipeline'
import { tierGatewayHealth } from '@/lib/tier-gateway'

import { db } from '@/lib/db'

/** Provider/system health snapshot DTO (client-safe value type). */
export interface ProviderHealthDto {
  /** Active engine name — 'demo', 'fal' or 'selfhosted'. */
  activeProvider: string
  /** FAL_KEY present? Boolean only — the value itself is never exposed. */
  falConfigured: boolean
  /** SELFHOSTED_URL present? Boolean only — the value itself is never exposed. */
  selfHostedConfigured: boolean
  /** Display string for the configured self-hosted model id (or null). */
  selfHostedModel: string | null
  /** Blob store wired (BLOB_READ_WRITE_TOKEN)? Boolean only — durable media vs per-instance scratch. */
  blobStorageConfigured: boolean
  /** Hosted LLM wired (OPENROUTER_API_KEY)? Boolean only — agent planning via the real tier vs heuristic fallback. */
  llmConfigured: boolean
  /** Display string for the hosted LLM model id (or null). */
  llmModel: string | null
  /**
   * T14 render truth — can the local image SDK initialize here? On the demo
   * tier this is the difference between composites of real generated
   * keyframes and composites of placeholder art. Boolean only.
   */
  imageSdkAvailable: boolean
  /** Effective per-model routing (T12): which tier serves each video model right now. */
  modelRoutes: Record<string, string>
  /** Effective image-model routing (T16): which tier serves prism stills right now. */
  imageModelRoutes: Record<string, string>
  /**
   * T16 live-tier durability — the gateway endpoint registered in the
   * TierGateway DB row. `SELFHOSTED_URL` points at the stable relay; these
   * three fields say whether a live sandbox is actually behind it (a row
   * can exist while its sandbox is dead — the hourly E2B cap). Booleans +
   * an ISO timestamp only; the URL and key are never exposed.
   */
  tierGatewayConfigured: boolean
  /** Liveness probe of the registered endpoint; null when nothing is registered. */
  tierGatewayAlive: boolean | null
  /** Last rotation (row updatedAt), ISO string; null when nothing is registered. */
  tierGatewayRotatedAt: string | null
  ffmpegAvailable: boolean
  /** Parsed from `ffmpeg -version` (first line); null when unavailable. */
  ffmpegVersion: string | null
  lastJobAt: string | null
  /** Job activity in the trailing 5-minute window (by Job.createdAt). */
  last5m: { submitted: number; completed: number; failed: number }
  /** Multi-user Somnia: registered accounts (balances are per-user). */
  registeredUsers: number
  checkedAt: string
}

/**
 * Phase 4 — read-only provider/system health snapshot.
 * Never exposes env values or secrets: booleans and safe display strings only.
 */

interface FfmpegProbe {
  available: boolean
  version: string | null
}

const globalForProbe = globalThis as unknown as {
  rfFfmpegProbe?: Promise<FfmpegProbe>
}

const FFMPEG_TIMEOUT_MS = 5_000

/** Spawn `ffmpeg -version`, resolve within the timeout, kill on overrun. */
function probeFfmpegOnce(): Promise<FfmpegProbe> {
  return new Promise<FfmpegProbe>((resolve) => {
    let settled = false
    let stdout = ''

    const finish = (result: FfmpegProbe) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(resolveFfmpegBin(), ['-version'], { stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      resolve({ available: false, version: null })
      return
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ available: false, version: null })
    }, FFMPEG_TIMEOUT_MS)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.on('error', () => finish({ available: false, version: null }))
    child.on('close', (code) => {
      if (code !== 0) {
        finish({ available: false, version: null })
        return
      }
      const firstLine = stdout.split('\n')[0]?.trim() ?? ''
      const match = /ffmpeg version (\S+)/i.exec(firstLine)
      finish({
        available: true,
        version: match ? match[1] : firstLine.slice(0, 60) || 'ffmpeg',
      })
    })
  })
}

/**
 * ffmpeg -version probe, run once per process and cached (spawning on every
 * request would add ~30-80ms and log noise to each health check).
 */
export function ffmpegProbe(): Promise<FfmpegProbe> {
  if (!globalForProbe.rfFfmpegProbe) {
    globalForProbe.rfFfmpegProbe = probeFfmpegOnce()
  }
  return globalForProbe.rfFfmpegProbe
}

const LAST_5M_MS = 5 * 60 * 1000

export async function getProviderHealth(): Promise<ProviderHealthDto> {
  const windowStart = new Date(Date.now() - LAST_5M_MS)

  const [userCount, ffmpeg, lastJob, last5mStatuses] = await Promise.all([
    db.user.count(),
    ffmpegProbe(),
    db.job.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    db.job.groupBy({ by: ['status'], _count: { _all: true }, where: { createdAt: { gte: windowStart } } }),
  ])

  const count5m = (status: string) =>
    last5mStatuses.find((g) => g.status === status)?._count._all ?? 0

  const llm = hostedLlmConfig()
  const imageSdk = await imageSdkProbe()
  const tierGateway = await tierGatewayHealth()

  return {
    // The render pipeline resolves the hosted tier on every job (dynamic env
    // getters); display string only — never the values.
    activeProvider: resolveVideoProvider()?.name ?? 'demo',
    falConfigured: !!process.env.FAL_KEY,
    selfHostedConfigured: !!process.env.SELFHOSTED_URL,
    selfHostedModel: process.env.SELFHOSTED_URL
      ? (process.env.SELFHOSTED_MODEL ?? 'wan2.2-t2v-5b')
      : null,
    blobStorageConfigured: isBlobConfigured(),
    llmConfigured: !!llm,
    llmModel: llm ? llm.model : null,
    imageSdkAvailable: imageSdk,
    modelRoutes: effectiveRoutes(),
    imageModelRoutes: effectiveImageRoutes(),
    tierGatewayConfigured: tierGateway.configured,
    tierGatewayAlive: tierGateway.alive,
    tierGatewayRotatedAt: tierGateway.rotatedAt,
    ffmpegAvailable: ffmpeg.available,
    ffmpegVersion: ffmpeg.version,
    lastJobAt: lastJob?.updatedAt.toISOString() ?? null,
    last5m: {
      submitted: count5m('queued') + count5m('dispatched') + count5m('running') + count5m('moderated'),
      completed: count5m('completed'),
      failed: count5m('failed'),
    },
    /** Multi-user Somnia: registered accounts (balances are per-user). */
    registeredUsers: userCount,
    checkedAt: new Date().toISOString(),
  }
}
