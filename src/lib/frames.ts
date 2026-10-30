import { promises as fs } from 'fs'
import path from 'path'
import sharp from 'sharp'
import { IS_SERVERLESS, absoluteMediaPath, mediaDir } from '@/lib/runtime'
import { putMedia } from '@/lib/blob'

// Reelforge frame storage. Locally files live under public/generated so they
// are servable as static assets straight from the browser; on serverless the
// same logical /generated/... paths are written to the writable /tmp scratch
// dir (see @/lib/runtime) and streamed by the /api/media route handler.

export const GENERATED_DIR = mediaDir()

export function framePath(jobId: string, frameNumber: number): string {
  return `/generated/${jobId}-frame${frameNumber}.png`
}

export function startFramePath(jobId: string): string {
  return `/generated/${jobId}-start.png`
}

export function endFramePath(jobId: string): string {
  return `/generated/${jobId}-end.png`
}

export function absoluteFromPublic(publicPath: string): string {
  if (IS_SERVERLESS) return absoluteMediaPath(publicPath)
  return path.join(process.cwd(), 'public', publicPath.replace(/^\//, ''))
}

async function ensureGeneratedDir() {
  await fs.mkdir(GENERATED_DIR, { recursive: true })
}

/** Ensure the generated dir exists and is writable (for non-PNG writers too). */
export async function ensureGeneratedDirWritable() {
  await ensureGeneratedDir()
  await fs.access(GENERATED_DIR, fs.constants.W_OK)
}

export async function writeBase64Png(publicPath: string, base64: string): Promise<string> {
  const buffer = Buffer.from(base64, 'base64')
  return writeBuffer(publicPath, buffer)
}

/**
 * Write media bytes into local scratch and return the durable reference the
 * database should remember: the absolute blob URL when a store is wired
 * (T11), or the public path unchanged otherwise (local/dev parity). The
 * local copy always exists for the same-invocation fast path.
 */
export async function writeBuffer(publicPath: string, data: Buffer): Promise<string> {
  await ensureGeneratedDir()
  await fs.writeFile(absoluteFromPublic(publicPath), data)
  return putMedia(publicPath, data)
}

/**
 * Original Reelforge placeholder art: a branded gradient storyboard frame
 * with the prompt text baked in. Rasterized to PNG via sharp so it can live
 * at the exact same path a real generated keyframe would occupy.
 */
export function buildPlaceholderFrameSvg(options: {
  frameNumber: number
  prompt: string
  aspectRatio: '16:9' | '9:16' | '1:1'
  status?: string
}): string {
  const { frameNumber, prompt, aspectRatio } = options
  const dims =
    aspectRatio === '16:9'
      ? { w: 1344, h: 768 }
      : aspectRatio === '9:16'
        ? { w: 768, h: 1344 }
        : { w: 1024, h: 1024 }

  const escapedPrompt = escapeXml(truncate(prompt, 130))
  const fontSize = Math.round(dims.w / 28)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dims.w}" height="${dims.h}" viewBox="0 0 ${dims.w} ${dims.h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#18181b"/>
      <stop offset="55%" stop-color="#27272a"/>
      <stop offset="100%" stop-color="#3f2a12"/>
    </linearGradient>
    <linearGradient id="ember" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="#f97316"/>
      <stop offset="100%" stop-color="#fbbf24"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.42" r="0.65">
      <stop offset="0%" stop-color="#f97316" stop-opacity="0.34"/>
      <stop offset="100%" stop-color="#f97316" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${dims.w}" height="${dims.h}" fill="url(#bg)"/>
  <rect width="${dims.w}" height="${dims.h}" fill="url(#glow)"/>
  <g opacity="0.16" stroke="#fbbf24" stroke-width="1.5">
    ${Array.from({ length: 7 }, (_, i) => {
      const step = dims.h / 7
      const y = step * (i + 0.5)
      return `<line x1="0" y1="${y}" x2="${dims.w}" y2="${y}" opacity="${0.9 - i * 0.1}"/>`
    }).join('\n    ')}
  </g>
  <circle cx="${dims.w * 0.5}" cy="${dims.h * 0.4}" r="${dims.w * 0.09}" fill="url(#ember)" opacity="0.9"/>
  <text x="${dims.w / 2}" y="${dims.h * 0.41}" font-family="Georgia, 'Times New Roman', serif" font-size="${fontSize}" fill="#18181b" text-anchor="middle" font-weight="bold">R${frameNumber}</text>
  <text x="${dims.w / 2}" y="${dims.h * 0.66}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize * 0.85}" fill="#fdba74" text-anchor="middle" letter-spacing="6">STORYBOARD KEYFRAME ${frameNumber} / 3</text>
  <text x="${dims.w / 2}" y="${dims.h * 0.75}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize * 0.75}" fill="#e4e4e7" text-anchor="middle" opacity="0.85">${escapedPrompt}</text>
  <text x="${dims.w / 2}" y="${dims.h - dims.h * 0.06}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize * 0.62}" fill="#a1a1aa" text-anchor="middle" letter-spacing="3">REFLFORGE PLACEHOLDER — SIMULATED RENDER</text>
</svg>`
}

export async function writePlaceholderFrame(options: {
  jobId: string
  frameNumber: number
  prompt: string
  aspectRatio: '16:9' | '9:16' | '1:1'
}): Promise<string> {
  const publicPath = framePath(options.jobId, options.frameNumber)
  const svg = buildPlaceholderFrameSvg({
    frameNumber: options.frameNumber,
    prompt: options.prompt,
    aspectRatio: options.aspectRatio,
  })
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  await writeBuffer(publicPath, png)
  return publicPath
}

function truncate(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
