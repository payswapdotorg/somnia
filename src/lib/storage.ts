// src/lib/storage.ts — frame upload storage.
//
// Writes validated frame images into the platform-appropriate writable media
// directory and returns the durable web reference: the absolute blob URL
// when a store is wired (T11 — pinned timelines, start/end frames survive
// the function instance that uploaded them), or the public /generated/...
// path otherwise (local/dev parity). The local copy always lands first so
// the same-invocation pipeline reads (ffmpeg segment inputs) stay on disk.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseImageDataUrl } from '@/lib/inputs'
import { putMedia } from '@/lib/blob'

export function mediaDir(): string {
  if (process.env.VERCEL) return '/tmp/somnia-generated'
  return process.env.SOMNIA_MEDIA_DIR ?? path.join(process.cwd(), 'public', 'generated')
}

/** Persist a validated frame data URL; returns the durable media reference. */
export async function storeFrameDataUrl(dataUrl: string): Promise<string> {
  const parsed = parseImageDataUrl(dataUrl)
  if (!parsed.ok) throw new Error(`invalid frame: ${parsed.reason}`)
  const ext =
    parsed.mime === 'image/png' ? 'png' : parsed.mime === 'image/webp' ? 'webp' : 'jpg'
  const name = `${randomUUID()}.${ext}`
  const dir = mediaDir()
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, name), parsed.buffer)
  return putMedia(`/generated/${name}`, parsed.buffer, parsed.mime)
}
