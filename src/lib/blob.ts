// src/lib/blob.ts — durable media storage (T11).
//
// On serverless every generated file lands in per-instance /tmp scratch:
// the clip one function instance rendered is invisible to the instance
// serving the next request. This module is the media twin of the Neon
// migration: writes stay local-first (ffmpeg reads and writes real files)
// but also upload to the Vercel Blob store, and the DATABASE remembers the
// absolute blob URL instead of the ephemeral /generated/... path. Every
// consumer that renders a stored path — players, posters, OG tags — then
// reads the blob URL directly off the store's CDN (native Range support,
// zero function invocations), while the pipeline resolves either shape
// back to a local file when ffmpeg needs bytes:
//
//   resolveMediaInput  blob URL + local hit  → the local file (fast path,
//                                          same invocation wrote it)
//                      blob URL + local miss → one download into scratch
//                      relative /generated/… → the local absolute path
//
// Without BLOB_READ_WRITE_TOKEN every function here is an identity no-op,
// so local dev and the hermetic suite keep byte-for-byte the pre-blob
// behavior (same laziness rule as resolveVideoProvider: the env is read
// at call time, never at module load).

import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { absoluteMediaPath } from '@/lib/runtime'

/** True when a blob store is wired (BLOB_READ_WRITE_TOKEN present). */
export function isBlobConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN
}

/** Recognize absolute http(s) media references (blob URLs, remote fallbacks). */
export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

/** Plain file names only — the same shape the media route guards. */
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

export function mediaContentType(name: string): string {
  return CONTENT_TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Blob key for a public media path: '/generated/<name>' → '<name>'.
 * Traversal, hidden files and empty names are rejected loudly — keys are
 * derived from user-influenced paths, so they guard the store the same way
 * the media route guards the filesystem.
 */
export function blobKeyFor(publicPath: string): string {
  const key = publicPath.replace(/^\/+/, '').replace(/^generated\//, '')
  if (!SAFE_KEY.test(key) || key.includes('..')) {
    throw new Error(`unsafe blob key: ${JSON.stringify(publicPath)}`)
  }
  return key
}

/** Inverse of blobKeyFor — the public path a blob key round-trips to. */
export function publicPathForKey(key: string): string {
  return `/generated/${key}`
}

interface BlobPutResult {
  url: string
}

async function putByKey(key: string, data: Buffer, contentType: string): Promise<string> {
  // addRandomSuffix: false keeps keys deterministic — a re-render overwrites
  // its own artifacts instead of accumulating suffixed copies, and public
  // paths round-trip into blob keys cleanly.
  const { put } = await import('@vercel/blob')
  const result: BlobPutResult = await put(key, data, {
    access: 'public',
    contentType,
    addRandomSuffix: false,
  })
  return result.url
}

/**
 * Store media bytes durably. Returns the absolute blob URL when a store is
 * configured, or the public path unchanged when it is not (identity no-op —
 * local/dev keeps the pre-blob semantics). Upload failures propagate: a job
 * whose artifacts are not durable should fail and refund, not lie.
 */
export async function putMedia(
  publicPath: string,
  data: Buffer,
  contentType?: string
): Promise<string> {
  if (!isBlobConfigured()) return publicPath
  const key = blobKeyFor(publicPath)
  return putByKey(key, data, contentType ?? mediaContentType(publicPath))
}

/**
 * Upload an already-written local file (the MP4s ffmpeg produces) and return
 * its durable URL. Graceful by design: unconfigured, or a missing local
 * file, returns the public path unchanged instead of throwing — the caller
 * keeps the pre-blob behavior rather than losing the render.
 */
export async function mirrorLocalFile(publicPath: string): Promise<string> {
  if (!isBlobConfigured()) return publicPath
  try {
    const data = await fs.readFile(absoluteMediaPath(publicPath))
    return await putMedia(publicPath, data)
  } catch {
    return publicPath
  }
}

const DOWNLOAD_TIMEOUT_MS = 120_000

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  if (!response.ok) {
    throw new Error(`media fetch failed: ${response.status} ${url}`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength === 0) throw new Error(`media fetch returned no bytes: ${url}`)
  return buffer
}

async function isFile(p: string): Promise<boolean> {
  const stat = await fs.stat(p).catch(() => null)
  return !!stat?.isFile()
}

/**
 * Resolve any stored media reference to a local absolute path for ffmpeg.
 *
 *  - relative /generated/... paths resolve against the media dir exactly as
 *    before (missing files stay the caller's graceful-degradation problem)
 *  - blob URLs take the local fast path when the file is already on disk
 *    (the same invocation wrote it), otherwise download once into scratch
 *    so later reads in this invocation hit the disk copy
 *  - arbitrary remote URLs (legacy ingest fallbacks kept when a GPU box was
 *    unreachable) download to a one-shot scratch file
 */
export async function resolveMediaInput(pathOrUrl: string): Promise<string> {
  if (!isHttpUrl(pathOrUrl)) {
    return absoluteMediaPath(pathOrUrl)
  }

  let key: string | null = null
  try {
    const candidate = decodeURIComponent(new URL(pathOrUrl).pathname.replace(/^\/+/, ''))
    if (SAFE_KEY.test(candidate) && !candidate.includes('..')) key = candidate
  } catch {
    key = null
  }

  if (key) {
    const local = absoluteMediaPath(publicPathForKey(key))
    if (await isFile(local)) return local
    const buffer = await download(pathOrUrl)
    await fs.mkdir(path.dirname(local), { recursive: true })
    await fs.writeFile(local, buffer)
    return local
  }

  const ext = path.extname(key ?? '') || '.bin'
  const scratch = path.join(os.tmpdir(), `somnia-media-${randomUUID()}${ext}`)
  await fs.writeFile(scratch, await download(pathOrUrl))
  return scratch
}

/**
 * Absolutize a stored media reference for OG/share surfaces: absolute URLs
 * (blob store, remote fallback) pass through untouched; relative
 * /generated/... paths join onto the site URL. Null/undefined maps to
 * undefined so callers can omit the meta tag entirely.
 */
export function absoluteMediaUrl(
  pathOrUrl: string | null | undefined,
  siteUrl: string
): string | undefined {
  if (!pathOrUrl) return undefined
  if (isHttpUrl(pathOrUrl)) return pathOrUrl
  const base = siteUrl.replace(/\/+$/, '')
  return `${base}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`
}
