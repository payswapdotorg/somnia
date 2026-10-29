// src/lib/providers/ingest.ts — shared hosted-asset plumbing (T6a).
//
// Timings shrink automatically under SOMNIA_TEST so the hermetic suite (a
// local node:http gateway) polls in milliseconds; PROVIDER_POLL_INTERVAL_MS
// / PROVIDER_POLL_TIMEOUT_MS override both knobs explicitly.

import { writeBuffer } from '@/lib/frames'

const DOWNLOAD_TIMEOUT_MS = 120_000
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Poll cadence + overall render deadline. */
export function timings(defaultIntervalMs: number, defaultTimeoutMs: number) {
  if (process.env.SOMNIA_TEST) {
    return {
      intervalMs: Number(process.env.PROVIDER_POLL_INTERVAL_MS) || 15,
      timeoutMs: Number(process.env.PROVIDER_POLL_TIMEOUT_MS) || 5_000,
    }
  }
  return { intervalMs: defaultIntervalMs, timeoutMs: defaultTimeoutMs }
}

/** Extension for a downloaded asset, defaulted by kind when the URL has none. */
export function extensionOf(url: string, kind: 'video' | 'frame'): string {
  const match = /\.(mp4|webm|mov|png|jpg|jpeg|webp)(?:$|[?#])/i.exec(url)
  if (match) return match[1]!.toLowerCase()
  return kind === 'video' ? 'mp4' : 'png'
}

/**
 * Ingest a remote asset into public/generated so the app serves it locally.
 * Falls back to the remote URL when the download fails (resilience first —
 * the clip stays playable even if the GPU box is slow or unreachable later).
 */
export async function ingestAsset(
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
