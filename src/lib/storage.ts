// src/lib/storage.ts — frame upload storage.
//
// Writes validated frame images into the platform-appropriate writable media
// directory and returns the public web path. On Vercel the repo bundle is
// read-only so media lives in /tmp (streamed back through the media route);
// locally it lands in public/generated and is served statically.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseImageDataUrl } from '@/lib/inputs'

export function mediaDir(): string {
  if (process.env.VERCEL) return '/tmp/somnia-generated'
  return process.env.SOMNIA_MEDIA_DIR ?? path.join(process.cwd(), 'public', 'generated')
}

/** Persist a validated frame data URL; returns `/generated/<uuid>.<ext>`. */
export function storeFrameDataUrl(dataUrl: string): string {
  const parsed = parseImageDataUrl(dataUrl)
  if (!parsed.ok) throw new Error(`invalid frame: ${parsed.reason}`)
  const ext =
    parsed.mime === 'image/png' ? 'png' : parsed.mime === 'image/webp' ? 'webp' : 'jpg'
  const name = `${randomUUID()}.${ext}`
  const dir = mediaDir()
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, name), parsed.buffer)
  return `/generated/${name}`
}
