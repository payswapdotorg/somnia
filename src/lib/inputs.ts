// src/lib/inputs.ts — Somnia composer input validation.
//
// Pure validation helpers for frame image data URLs (png/jpeg/webp under a
// byte cap), modify-video uploads (mp4/webm under a byte cap), and ordered
// keyframe lists (1..16 contiguous). No I/O — callers persist what passes.

import { MAX_KEYFRAMES } from '@/lib/plans'

export const FRAME_ACCEPT = ['image/png', 'image/jpeg', 'image/webp'] as const
export const FRAME_MIME_SET = new Set<string>(FRAME_ACCEPT)
export const MAX_FRAME_BYTES = 6 * 1024 * 1024 // 6 MB per pinned frame

export const VIDEO_ACCEPT = ['video/mp4', 'video/webm'] as const
export const VIDEO_MIME_SET = new Set<string>(VIDEO_ACCEPT)
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024 // 100 MB per modify-video upload

const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/

/** Linear strict-base64 check (charset + padding placement + length mod 4).
 *  A regex here would recurse to death on multi-MB payloads in V8. */
function isStrictBase64(payload: string): boolean {
  const len = payload.length
  if (len % 4 === 1) return false
  const padStart = payload.indexOf('=')
  if (padStart !== -1) {
    // '=' only as the final one or two chars, and only in quartet-aligned lengths
    if (padStart !== len - 1 && padStart !== len - 2) return false
    if (len % 4 !== 0) return false
  }
  const end = padStart === -1 ? len : padStart
  for (let i = 0; i < end; i++) {
    const c = payload.charCodeAt(i)
    const ok =
      (c >= 65 && c <= 90) || // A-Z
      (c >= 97 && c <= 122) || // a-z
      (c >= 48 && c <= 57) || // 0-9
      c === 43 || // +
      c === 47 // /
    if (!ok) return false
  }
  return true
}

export type ParseImageResult =
  | { ok: true; mime: string; bytes: number; buffer: Buffer }
  | { ok: false; reason: string }

/** Parse and validate an inline frame image (data URL) for pinning. */
export function parseImageDataUrl(dataUrl: string): ParseImageResult {
  if (typeof dataUrl !== 'string') {
    return { ok: false, reason: 'frame must be a data URL string' }
  }
  const match = DATA_URL_RE.exec(dataUrl)
  if (!match) {
    if (!dataUrl.startsWith('data:')) {
      return { ok: false, reason: 'not a data URL' }
    }
    const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'unknown'
    return FRAME_MIME_SET.has(mime)
      ? { ok: false, reason: 'only base64 data URLs are supported' }
      : { ok: false, reason: `unsupported frame type: ${mime}` }
  }
  const mime = match[1]
  if (!FRAME_MIME_SET.has(mime)) {
    return { ok: false, reason: `unsupported frame type: ${mime}` }
  }
  const payload = match[2]
  if (!isStrictBase64(payload)) {
    return { ok: false, reason: 'corrupted base64 payload' }
  }
  const buffer = Buffer.from(payload, 'base64')
  if (buffer.length > MAX_FRAME_BYTES) {
    return {
      ok: false,
      reason: `frame too large: ${buffer.length} bytes > ${MAX_FRAME_BYTES} cap`,
    }
  }
  return { ok: true, mime, bytes: buffer.length, buffer }
}

export type Validation =
  | { ok: true }
  | { ok: false; reason: string }

/** Validate the composer's frame upload payload shape. */
export function validateFrameUpload(input: {
  dataUrl: string
  name?: string
}): Validation {
  if (!input || typeof input.dataUrl !== 'string') {
    return { ok: false, reason: 'missing frame data' }
  }
  if (typeof input.name === 'string' && input.name.trim().length === 0) {
    return { ok: false, reason: 'missing frame name' }
  }
  const parsed = parseImageDataUrl(input.dataUrl)
  return parsed.ok ? { ok: true } : { ok: false, reason: parsed.reason }
}

/** Validate an uploaded reference video for Modify (video-to-video). */
export function validateVideoUpload(input: {
  mime: string
  bytes: number
}): Validation {
  if (!input || typeof input.mime !== 'string') {
    return { ok: false, reason: 'missing video' }
  }
  if (!VIDEO_MIME_SET.has(input.mime)) {
    return { ok: false, reason: `unsupported video type: ${input.mime}` }
  }
  if (!Number.isFinite(input.bytes) || input.bytes < 0) {
    return { ok: false, reason: 'invalid video size' }
  }
  if (input.bytes > MAX_VIDEO_BYTES) {
    return {
      ok: false,
      reason: `video too large: ${input.bytes} bytes > ${MAX_VIDEO_BYTES} cap`,
    }
  }
  return { ok: true }
}

/**
 * Validate an ordered keyframe list. Order values must be exactly the
 * contiguous sequence 1..N with N between 1 and 16.
 */
export function validateKeyframeList(orders: number[]): Validation {
  if (!Array.isArray(orders)) {
    return { ok: false, reason: 'keyframes must be a list' }
  }
  if (orders.length < 1) {
    return { ok: false, reason: 'at least one keyframe is required' }
  }
  if (orders.length > MAX_KEYFRAMES) {
    return {
      ok: false,
      reason: `at most ${MAX_KEYFRAMES} keyframes are supported`,
    }
  }
  for (let i = 0; i < orders.length; i++) {
    if (orders[i] !== i + 1) {
      return {
        ok: false,
        reason: 'keyframe order must be contiguous starting at 1',
      }
    }
  }
  return { ok: true }
}
