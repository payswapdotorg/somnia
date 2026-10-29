// tests/inputs.test.ts — TDD RED first.
// Composer input validation: frame image data URLs (png/jpeg/webp, size cap),
// modify-video uploads (mp4/webm, size cap), and the ordered keyframe list
// rules (1..16, contiguous order, dedupe).
import { describe, expect, it } from 'vitest'
import {
  FRAME_ACCEPT,
  MAX_FRAME_BYTES,
  MAX_VIDEO_BYTES,
  parseImageDataUrl,
  validateFrameUpload,
  validateVideoUpload,
  validateKeyframeList,
} from '@/lib/inputs'

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function bigDataUrl(byteLen: number): string {
  // base64 chars needed so the DECODED payload is >= byteLen bytes (4/3 ratio)
  const chars = Math.ceil((byteLen * 4) / 3)
  return `data:image/png;base64,${'A'.repeat(chars)}`
}

describe('inputs — frame image data URLs', () => {
  it('accepts a valid PNG data URL', () => {
    const res = parseImageDataUrl(PNG_1PX)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.mime).toBe('image/png')
      expect(res.bytes).toBeGreaterThan(0)
      expect(Buffer.isBuffer(res.buffer)).toBe(true)
    }
  })

  it('accepts jpeg and webp, rejects gif/svg/anything else', () => {
    expect(parseImageDataUrl('data:image/jpeg;base64,/9j/4AAQ').ok).toBe(true)
    expect(parseImageDataUrl('data:image/webp;base64,UklGRh4').ok).toBe(true)
    expect(parseImageDataUrl('data:image/gif;base64,R0lGODlh').ok).toBe(false)
    expect(parseImageDataUrl('data:image/svg+xml;base64,PHN2ZyB4bWxucz0').ok).toBe(false)
    expect(parseImageDataUrl('https://example.com/a.png').ok).toBe(false)
    expect(parseImageDataUrl('not a data url').ok).toBe(false)
  })

  it('rejects oversized frames beyond the cap', () => {
    const res = parseImageDataUrl(bigDataUrl(MAX_FRAME_BYTES + 1024))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/too large/i)
  })

  it('rejects corrupted base64 payloads', () => {
    const res = parseImageDataUrl('data:image/png;base64,!!!!not-base64!!!!')
    expect(res.ok).toBe(false)
  })
})

describe('inputs — validateFrameUpload', () => {
  it('validates the whole composer frame payload shape', () => {
    const ok = validateFrameUpload({ dataUrl: PNG_1PX, name: 'frame.png' })
    expect(ok.ok).toBe(true)
    const badMime = validateFrameUpload({ dataUrl: 'data:image/gif;base64,R0lGOD', name: 'x.gif' })
    expect(badMime.ok).toBe(false)
    const badName = validateFrameUpload({ dataUrl: PNG_1PX, name: '' })
    expect(badName.ok).toBe(false)
    expect(FRAME_ACCEPT).toContain('image/png')
  })
})

describe('inputs — modify video uploads', () => {
  it('accepts mp4/webm and rejects other containers', () => {
    expect(validateVideoUpload({ mime: 'video/mp4', bytes: 1024 }).ok).toBe(true)
    expect(validateVideoUpload({ mime: 'video/webm', bytes: 1024 }).ok).toBe(true)
    expect(validateVideoUpload({ mime: 'video/quicktime', bytes: 1024 }).ok).toBe(false)
    expect(validateVideoUpload({ mime: 'application/octet-stream', bytes: 1024 }).ok).toBe(false)
  })

  it('enforces the video size cap', () => {
    expect(validateVideoUpload({ mime: 'video/mp4', bytes: MAX_VIDEO_BYTES + 1 }).ok).toBe(false)
    expect(validateVideoUpload({ mime: 'video/mp4', bytes: MAX_VIDEO_BYTES }).ok).toBe(true)
  })
})

describe('inputs — ordered keyframe list', () => {
  it('accepts 1..16 ordered frames', () => {
    expect(validateKeyframeList([1]).ok).toBe(true)
    const sixteen = Array.from({ length: 16 }, (_, i) => i + 1)
    expect(validateKeyframeList(sixteen).ok).toBe(true)
  })

  it('rejects empty lists and >16 frames', () => {
    expect(validateKeyframeList([]).ok).toBe(false)
    const seventeen = Array.from({ length: 17 }, (_, i) => i + 1)
    expect(validateKeyframeList(seventeen).ok).toBe(false)
  })

  it('rejects non-contiguous order values', () => {
    expect(validateKeyframeList([1, 3]).ok).toBe(false)
    expect(validateKeyframeList([2, 1]).ok).toBe(false)
    expect(validateKeyframeList([0, 1]).ok).toBe(false)
  })
})
