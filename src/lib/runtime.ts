import fs from 'fs'
import path from 'path'
import ffmpegStaticPath from 'ffmpeg-static'
import { waitUntil as vercelWaitUntil } from '@vercel/functions'

/**
 * Reelforge serverless runtime layer (Phase 6).
 *
 * The app was born on a long-lived dev server with a writable repo checkout:
 * media under public/generated, SQLite under the repo, system ffmpeg at
 * /usr/bin/ffmpeg, and fire-and-forget background jobs. Vercel-style
 * serverless platforms invert every one of those assumptions:
 *
 *   - the bundle is read-only; only /tmp is writable
 *   - there is no system ffmpeg (the ffmpeg-static binary ships instead)
 *   - background work dies when the function freezes after the response,
 *     unless the platform's waitUntil hook holds it open
 *
 * This module centralizes every platform decision so the rest of the code
 * stays environment-agnostic. Detection is `!!process.env.VERCEL`, which
 * Vercel sets in every build and runtime context; everything else keys off
 * that single boolean, so local behavior is byte-for-byte what it was.
 */

/** True only on Vercel-style serverless builds. */
export const IS_SERVERLESS = !!process.env.VERCEL

/**
 * Writable home for generated media (keyframes, MP4s, variants).
 * Sandbox/self-hosted: public/generated, served straight off the filesystem.
 * Serverless: /tmp scratch — served through the /api/media route handler
 * (the afterFiles rewrite maps /generated/* onto it when no static file
 * matches, so every stored /generated/... path keeps working unchanged).
 */
export function mediaDir(): string {
  if (process.env.SOMNIA_MEDIA_DIR) return process.env.SOMNIA_MEDIA_DIR
  return IS_SERVERLESS ? '/tmp/somnia-generated' : path.join(process.cwd(), 'public', 'generated')
}

/**
 * Absolute filesystem path for a public-relative media path such as
 * "/generated/<jobId>.mp4". On serverless the /generated prefix maps into
 * the /tmp scratch dir; locally it maps into public/ as before.
 */
export function absoluteMediaPath(publicPath: string): string {
  const relative = publicPath.replace(/^\/+/, '').replace(/^generated\//, '')
  return path.join(mediaDir(), relative)
}

let cachedFfmpegBin: string | null = null

/**
 * Resolve the ffmpeg binary, in priority order:
 *   1. FFMPEG_PATH env override (ops escape hatch)
 *   2. /usr/bin/ffmpeg — the sandbox system binary (preserves the exact
 *      rendering behavior of every clip shipped before Phase 6)
 *   3. the ffmpeg-static package binary (serverless bundles)
 *   4. bare "ffmpeg" on PATH (last resort; matches the old probe behavior)
 */
export function resolveFfmpegBin(): string {
  if (cachedFfmpegBin) return cachedFfmpegBin
  const candidates: string[] = []
  if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH)
  candidates.push('/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg')
  if (typeof ffmpegStaticPath === 'string' && ffmpegStaticPath.length > 0) {
    candidates.push(ffmpegStaticPath)
  }
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      cachedFfmpegBin = candidate
      return candidate
    } catch {
      /* try the next candidate */
    }
  }
  cachedFfmpegBin = 'ffmpeg'
  return cachedFfmpegBin
}

/**
 * Keep a promise alive after the HTTP response is sent.
 *
 * On Vercel this routes through the official @vercel/functions waitUntil,
 * which resolves the platform hook across runtime variants (the raw
 * globalThis symbol probe misses the async-storage context used by current
 * runtimes, which silently killed the pipeline at invocation end). The
 * package throws outside a request context, so every environment falls
 * through to the original fire-and-forget semantics.
 */
export function afterResponse(promise: Promise<unknown>): void {
  try {
    vercelWaitUntil(promise)
    return
  } catch {
    /* not in a serverless request context — fire and forget */
  }
  void promise
}
