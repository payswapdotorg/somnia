import { createReadStream } from 'fs'
import { promises as fs } from 'fs'
import path from 'path'
import { GENERATED_DIR } from '@/lib/frames'

/**
 * Runtime media streaming (Phase 6).
 *
 * Every stored asset path is public-relative ("/generated/<name>"); locally
 * those are true static files, but on serverless the same paths are written
 * to the writable /tmp scratch dir, which no CDN serves. The afterFiles
 * rewrite in next.config.ts maps /generated/* onto /api/media/* whenever no
 * static file matches, so every player, thumbnail, download link and OG tag
 * keeps its original URL on both platforms.
 *
 * Served through the consolidated /api dispatcher (single serverless
 * function) so the streams read the same writable dir the pipeline writes.
 *
 * The handler is Range-aware: browsers need 206 Partial Content responses
 * to seek inside <video> elements.
 */

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

/** Only plain file names may be requested — no traversal, no hidden files. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/

function contentTypeFor(name: string): string {
  return CONTENT_TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream'
}

function jsonNotFound(): Response {
  return new Response(JSON.stringify({ error: 'not_found', message: 'Unknown media file' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  })
}

export function serveMedia(request: Request, name: string): Promise<Response> {
  return serveMediaImpl(request, name)
}

async function serveMediaImpl(request: Request, rawName: string): Promise<Response> {
  const name = Array.isArray(rawName as unknown) ? (rawName as unknown as string[]).join('/') : rawName

  if (!name || !SAFE_NAME.test(name) || name.includes('..')) {
    return jsonNotFound()
  }

  const absolute = path.join(GENERATED_DIR, name)
  const stat = await fs.stat(absolute).catch(() => null)
  if (!stat?.isFile()) {
    return jsonNotFound()
  }

  const type = contentTypeFor(name)
  const size = stat.size
  const rangeHeader = request.headers.get('range')

  // Range request → 206 Partial Content (video seeking).
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
    if (match) {
      const start = match[1] ? Number(match[1]) : 0
      const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
      if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < size) {
        const stream = createReadStream(absolute, { start, end })
        return new Response(stream as unknown as ReadableStream, {
          status: 206,
          headers: {
            'Content-Type': type,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=3600',
          },
        })
      }
    }
    // Malformed or out-of-range request.
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' },
    })
  }

  // Full-body response.
  const stream = createReadStream(absolute)
  return new Response(stream as unknown as ReadableStream, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
