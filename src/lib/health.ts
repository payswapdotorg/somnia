import { spawn } from 'node:child_process'
import { resolveFfmpegBin } from '@/lib/runtime'

import { db } from '@/lib/db'
import { resolveProvider } from '@/lib/providers'
import { isFalConfigured } from '@/lib/providers/fal-stub'
import { isSelfHostedConfigured, selfHostedModel } from '@/lib/providers/selfhosted'
import type { ProviderHealthDto } from '@/lib/types'

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

  return {
    // resolveProvider() name — 'demo', 'fal' or 'selfhosted' (display string).
    activeProvider: resolveProvider().name,
    falConfigured: isFalConfigured(),
    selfHostedConfigured: isSelfHostedConfigured(),
    selfHostedModel: isSelfHostedConfigured() ? selfHostedModel() : null,
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
