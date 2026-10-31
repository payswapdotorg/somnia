// tests/blob.test.ts — durable media storage (T11).
//
// On serverless every media file the pipeline writes lands in per-instance
// /tmp scratch: the clip that rendered on one function instance is invisible
// to the instance serving the next request. The blob layer fixes the seam
// the same way Neon fixed the database:
//
//   - writes stay local-first (ffmpeg reads and writes real files) but also
//     upload to the Vercel Blob store, and the DATABASE remembers the
//     absolute blob URL instead of the ephemeral /generated/... path
//   - pipeline reads resolve either shape to a local file for ffmpeg — the
//     local fast path when the file is already on disk (same invocation),
//     a one-shot download when only the blob copy exists (cross-instance)
//   - without BLOB_READ_WRITE_TOKEN every function is an identity no-op, so
//     local dev and the hermetic suite keep byte-for-byte the pre-blob
//     behavior
//
// Hermetic: @vercel/blob is vi.mock'ed (no outbound network) and resolve
// downloads are served by a stubbed global fetch.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

vi.mock('@vercel/blob', () => ({
  put: vi.fn(
    async (
      pathname: string,
      _body: Buffer | Uint8Array | ArrayBuffer | string,
      options?: { contentType?: string; access?: string; addRandomSuffix?: boolean }
    ) => ({
      url: `https://fake-store.public.blob.vercel-storage.com/${pathname}`,
      pathname,
      contentType: options?.contentType ?? 'application/octet-stream',
      contentDisposition: `attachment; filename="${pathname}"`,
    })
  ),
}))

import { put } from '@vercel/blob'
import { db } from '@/lib/db'
import { signup } from '@/lib/auth'
import { createJob } from '@/lib/engine'
import { processJob, type FrameSource } from '@/lib/pipeline'
import { absoluteMediaPath } from '@/lib/runtime'
import {
  isBlobConfigured,
  putMedia,
  blobKeyFor,
  mirrorLocalFile,
  resolveMediaInput,
  absoluteMediaUrl,
} from '@/lib/blob'
import sharp from 'sharp'

const putMock = vi.mocked(put)

const FRAME = await sharp({
  create: { width: 16, height: 16, channels: 3, background: '#334455' },
})
  .png()
  .toBuffer()

let seq = 0
async function newUser() {
  const { user } = await signup({
    email: `blob${Date.now()}-${++seq}@somnia.test`,
    password: 'password123',
  })
  return user
}

function fakeFrameSource() {
  const calls: string[] = []
  const source: FrameSource = {
    async generate(prompt: string, beat: string) {
      calls.push(`${prompt}|${beat}`)
      return FRAME
    },
  }
  return { source, calls }
}

async function isFile(p: string): Promise<boolean> {
  const stat = await fs.stat(p).catch(() => null)
  return !!stat?.isFile()
}

beforeEach(() => {
  putMock.mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

// ------------------------------------------------------- configuration & put

describe('blob — configuration', () => {
  it('reads BLOB_READ_WRITE_TOKEN lazily at call time', () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '')
    expect(isBlobConfigured()).toBe(false)
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_test')
    expect(isBlobConfigured()).toBe(true)
  })
})

describe('blob — putMedia', () => {
  it('is an identity no-op without a token (local/dev parity)', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '')
    const result = await putMedia('/generated/x-frame.png', FRAME, 'image/png')
    expect(result).toBe('/generated/x-frame.png')
    expect(putMock).not.toHaveBeenCalled()
  })

  it('uploads under the derived key with deterministic options and returns the blob URL', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_test')
    const result = await putMedia('/generated/x-frame.png', FRAME, 'image/png')
    expect(result).toBe('https://fake-store.public.blob.vercel-storage.com/x-frame.png')
    expect(putMock).toHaveBeenCalledTimes(1)
    const [pathname, body, options] = putMock.mock.calls[0]!
    expect(pathname).toBe('x-frame.png') // /generated prefix stripped
    expect(body).toBe(FRAME)
    expect(options).toMatchObject({
      access: 'public',
      contentType: 'image/png',
      addRandomSuffix: false, // keys stay derivable from public paths
    })
  })
})

describe('blob — blobKeyFor', () => {
  it('strips the /generated prefix and tolerates the bare form', () => {
    expect(blobKeyFor('/generated/a.mp4')).toBe('a.mp4')
    expect(blobKeyFor('a.mp4')).toBe('a.mp4')
    expect(blobKeyFor('generated/a.mp4')).toBe('a.mp4')
  })

  it('rejects traversal, hidden and empty names', () => {
    expect(() => blobKeyFor('/generated/../etc/passwd')).toThrow()
    expect(() => blobKeyFor('/generated/a/../b.png')).toThrow()
    expect(() => blobKeyFor('/generated/.hidden')).toThrow()
    expect(() => blobKeyFor('/generated/')).toThrow()
    expect(() => blobKeyFor('')).toThrow()
  })
})

// ----------------------------------------------------------- mirror & resolve

describe('blob — mirrorLocalFile', () => {
  it('returns the public path unchanged when unconfigured or the file is missing', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '')
    const missing = `/generated/${randomUUID()}.png`
    expect(await mirrorLocalFile(missing)).toBe(missing)
    expect(putMock).not.toHaveBeenCalled()

    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_test')
    expect(await mirrorLocalFile(missing)).toBe(missing)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('uploads an existing local file and returns the durable URL', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_test')
    const name = `${randomUUID()}.png`
    const local = absoluteMediaPath(`/generated/${name}`)
    await fs.mkdir(path.dirname(local), { recursive: true })
    await fs.writeFile(local, FRAME)
    try {
      const result = await mirrorLocalFile(`/generated/${name}`)
      expect(result).toBe(`https://fake-store.public.blob.vercel-storage.com/${name}`)
      expect(putMock).toHaveBeenCalledTimes(1)
      expect(putMock.mock.calls[0]![0]).toBe(name)
      expect(putMock.mock.calls[0]![2]).toMatchObject({ contentType: 'image/png' })
    } finally {
      await fs.rm(local, { force: true }).catch(() => undefined)
    }
  })
})

describe('blob — resolveMediaInput', () => {
  it('maps a plain public path to the local absolute path without any network', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_test')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const local = await resolveMediaInput('/generated/plain-frame.png')
    expect(local).toBe(absoluteMediaPath('/generated/plain-frame.png'))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('prefers the local copy of a blob URL (same-invocation fast path)', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_test')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const name = `${randomUUID()}.png`
    const local = absoluteMediaPath(`/generated/${name}`)
    await fs.mkdir(path.dirname(local), { recursive: true })
    await fs.writeFile(local, FRAME)
    try {
      const resolved = await resolveMediaInput(
        `https://fake-store.public.blob.vercel-storage.com/${name}`
      )
      expect(resolved).toBe(local)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      await fs.rm(local, { force: true }).catch(() => undefined)
    }
  })

  it('downloads a missing blob URL into local scratch once, then hits the local copy', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_test')
    const name = `${randomUUID()}.png`
    const url = `https://fake-store.public.blob.vercel-storage.com/${name}`
    const local = absoluteMediaPath(`/generated/${name}`)
    const fetchSpy = vi.fn(async () => new Response(FRAME, { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const first = await resolveMediaInput(url)
      expect(first).toBe(local)
      expect(await isFile(local)).toBe(true)
      expect(fetchSpy).toHaveBeenCalledTimes(1)

      const second = await resolveMediaInput(url)
      expect(second).toBe(local)
      expect(fetchSpy).toHaveBeenCalledTimes(1) // local hit, no re-download
    } finally {
      await fs.rm(local, { force: true }).catch(() => undefined)
    }
  })

  it('downloads a URL with an unsafe pathname to a one-shot scratch file (legacy ingest fallbacks)', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_test')
    const fetchSpy = vi.fn(async () => new Response(FRAME, { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    // pathname decodes to "render clip" (a space) — not a safe blob key, so it
    // can never collide with the /generated scratch namespace
    const resolved = await resolveMediaInput('https://gpu.box.example/render%20clip?a=1')
    expect(resolved.includes('somnia-media-')).toBe(true)
    expect(path.dirname(resolved)).toBe(os.tmpdir())
    expect(await isFile(resolved)).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    await fs.rm(resolved, { force: true }).catch(() => undefined)
  })

  it('throws a clear error when the blob copy cannot be fetched', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_test')
    const name = `${randomUUID()}.png`
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('gone', { status: 404 }))
    )
    await expect(
      resolveMediaInput(`https://fake-store.public.blob.vercel-storage.com/${name}`)
    ).rejects.toThrow(/404|fetch/i)
  })
})

// ---------------------------------------------------------------- url helper

describe('blob — absoluteMediaUrl', () => {
  it('passes absolute URLs through untouched', () => {
    const url = 'https://fake-store.public.blob.vercel-storage.com/x.png'
    expect(absoluteMediaUrl(url, 'https://somnia-bay.vercel.app')).toBe(url)
  })

  it('joins relative media paths onto the site URL, null-safe', () => {
    expect(absoluteMediaUrl('/generated/x.png', 'https://somnia-bay.vercel.app/')).toBe(
      'https://somnia-bay.vercel.app/generated/x.png'
    )
    expect(absoluteMediaUrl(null, 'https://somnia-bay.vercel.app')).toBeUndefined()
    expect(absoluteMediaUrl(undefined, 'https://somnia-bay.vercel.app')).toBeUndefined()
  })
})

// ------------------------------------------------- pipeline durability (DB)

describe('blob — pipeline durability', () => {
  it('lands image-job outputs as blob URLs while keeping the local file', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_test')
    const user = await newUser()
    const job = await createJob({
      userId: user.id,
      kind: 'image',
      prompt: 'a still of glowing tidepools',
    })
    const { source } = fakeFrameSource()

    const done = await processJob(job.id, { frameSource: source })
    expect(done.status).toBe('completed')

    const poster = await db.asset.findFirst({
      where: { jobId: job.id, kind: 'poster', variantKey: 'main' },
    })
    expect(poster?.path).toBe(
      `https://fake-store.public.blob.vercel-storage.com/${job.id}-still.png`
    )
    const generation = await db.generation.findFirst({ where: { jobId: job.id } })
    expect(generation?.imagePath).toBe(
      `https://fake-store.public.blob.vercel-storage.com/${job.id}-still.png`
    )
    // the local copy exists too — the same-invocation fast path stays hot
    expect(await isFile(absoluteMediaPath(`/generated/${job.id}-still.png`))).toBe(true)
  })

  it('lands video-job keyframes and the rendered MP4 as blob URLs', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_test')
    const user = await newUser()
    const job = await createJob({
      userId: user.id,
      kind: 'video',
      prompt: 'a slow pan across night dunes',
      durationSec: 5,
    })
    const { source } = fakeFrameSource()

    const done = await processJob(job.id, { frameSource: source })
    expect(done.status).toBe('completed')

    const video = await db.asset.findFirst({
      where: { jobId: job.id, kind: 'video', variantKey: 'main' },
    })
    expect(video?.path).toBe(
      `https://fake-store.public.blob.vercel-storage.com/${job.id}.mp4`
    )
    expect(await isFile(absoluteMediaPath(`/generated/${job.id}.mp4`))).toBe(true)

    const frames = await db.asset.findMany({
      where: { jobId: job.id, kind: 'frame' },
    })
    expect(frames).toHaveLength(4) // 5s storyboard = 4 beats (T19 pulse-3 profile)
    for (const frame of frames) {
      expect(frame.path).toMatch(
        /^https:\/\/fake-store\.public\.blob\.vercel-storage\.com\/.+\.png$/
      )
    }
    const generation = await db.generation.findFirst({ where: { jobId: job.id } })
    expect(generation?.videoPath).toBe(video?.path)
  })

  it('keeps the exact pre-blob /generated paths when no token is configured', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '')
    const user = await newUser()
    const job = await createJob({
      userId: user.id,
      kind: 'image',
      prompt: 'an unconfigured still',
    })
    const done = await processJob(job.id, { frameSource: fakeFrameSource().source })
    expect(done.status).toBe('completed')
    const poster = await db.asset.findFirst({
      where: { jobId: job.id, kind: 'poster', variantKey: 'main' },
    })
    expect(poster?.path).toBe(`/generated/${job.id}-still.png`)
    expect(putMock).not.toHaveBeenCalled()
  })
})
