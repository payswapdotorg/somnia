// tests/covers-ui.test.tsx — cover stills in the UI + OG imagery (T9).
//
// jsdom contract tests for the visual half of covers: board cards render
// the cover still thumbnail (img + honest alt) with a branded placeholder
// when a board has nothing completed, and the public pages carry real OG
// imagery — the share page pins the dream's poster as og:image /
// twitter:image, the public board page pins the board cover, and both
// degrade to text-only cards when no still exists (never a broken URL).
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { BoardsApp } from '@/components/somnia/boards-app'
import { generateMetadata as shareMetadata } from '@/app/share/[token]/page'
import { generateMetadata as boardMetadata } from '@/app/boards/[token]/page'
import type { SessionUser } from '@/hooks/use-session'

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response
}

const USER: SessionUser = {
  id: 'u_123',
  email: 'maker@somnia.test',
  name: 'Maker',
  avatarSeed: 'aurora',
  plan: 'trial',
  credits: 1000,
  createdAt: '2026-10-29T00:00:00.000Z',
}

const BASE = 'http://localhost:3000'

const BOARDS = {
  boards: [
    {
      id: 'b_1',
      name: 'Neon Nocturnes',
      description: 'night city moods',
      shareToken: null,
      jobCount: 3,
      coverPath: '/generated/cover-1.png',
    },
    {
      id: 'b_2',
      name: 'Paper Worlds',
      description: 'origami dreamscapes',
      shareToken: 'btok_2',
      jobCount: 0,
      coverPath: null,
    },
  ],
}

const SHARED_JOB = (posterPath: string | null, videoPath: string | null = '/generated/j_1.mp4') => ({
  job: {
    id: 'j_1',
    prompt: 'a lantern drifting over still water',
    model: 'pulse-3',
    resolution: '720p',
    aspectRatio: '16:9',
    durationSec: 5,
    loop: true,
    hdr: false,
    createdAt: '2026-10-29T00:00:00.000Z',
  },
  author: { name: 'Maker', avatarSeed: 'aurora' },
  likeCount: 4,
  videoPath,
  posterPath,
})

const SHARED_BOARD = (coverPath: string | null, jobPoster: string | null) => ({
  board: {
    id: 'b_1',
    name: 'Neon Nocturnes',
    description: 'night city moods',
    sharedAt: '2026-10-28T00:00:00.000Z',
  },
  coverPath,
  jobs: [
    {
      id: 'j_1',
      prompt: 'a lantern drifting over still water',
      model: 'pulse-3',
      resolution: '720p',
      aspectRatio: '16:9',
      loop: true,
      createdAt: '2026-10-29T00:00:00.000Z',
      videoPath: '/generated/j_1.mp4',
      posterPath: jobPoster,
    },
  ],
})

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: 'unauthorized' })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function stubJson(url: string, body: unknown) {
  ;(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (input: RequestInfo | URL) => {
      if (String(input) === url) return jsonResponse(200, body)
      return jsonResponse(404, { error: 'not_found', message: `unhandled ${String(input)}` })
    }
  )
}

describe('BoardsApp — cover thumbnails', () => {
  it('renders the cover still with an honest alt; placeholder when a board has none', async () => {
    stubJson('/api/boards', BOARDS)
    render(<BoardsApp user={USER} />)

    const cover = await screen.findByRole('img', { name: /neon nocturnes cover/i })
    expect(cover).toHaveAttribute('src', '/generated/cover-1.png')

    // no completed dreams -> branded placeholder, never a broken image
    const empty = screen.getByTestId('cover-b_2')
    expect(empty).toHaveAttribute('data-cover', 'empty')
    expect(empty.querySelector('img')).toBeNull()
  })
})

describe('share page OG imagery', () => {
  it('pins the poster still as og:image and twitter:image (absolute URL)', async () => {
    stubJson(`${BASE}/api/jobs/shared/tok_1`, SHARED_JOB('/generated/j_1-poster.png'))

    const meta = await shareMetadata({ params: Promise.resolve({ token: 'tok_1' }) })

    expect(meta.openGraph?.images).toEqual([
      { url: `${BASE}/generated/j_1-poster.png` },
    ])
    expect(meta.twitter?.card).toBe('summary_large_image')
    expect(meta.twitter?.images).toEqual([`${BASE}/generated/j_1-poster.png`])
  })

  it('degrades to a text-only card when the dream has no still', async () => {
    stubJson(`${BASE}/api/jobs/shared/tok_2`, SHARED_JOB(null, null))

    const meta = await shareMetadata({ params: Promise.resolve({ token: 'tok_2' }) })

    expect(meta.openGraph?.images).toBeUndefined()
    expect(meta.twitter?.card).toBe('summary')
    expect(meta.twitter?.images).toBeUndefined()
  })
})

describe('public board page OG imagery', () => {
  it('pins the board cover as og:image and twitter:image (absolute URL)', async () => {
    stubJson(
      `${BASE}/api/boards/shared/btok_1`,
      SHARED_BOARD('/generated/j_1-poster.png', '/generated/j_1-poster.png')
    )

    const meta = await boardMetadata({ params: Promise.resolve({ token: 'btok_1' }) })

    expect(meta.openGraph?.images).toEqual([
      { url: `${BASE}/generated/j_1-poster.png` },
    ])
    expect(meta.twitter?.card).toBe('summary_large_image')
    expect(meta.twitter?.images).toEqual([`${BASE}/generated/j_1-poster.png`])
  })

  it('degrades to a text-only card when the board has no cover', async () => {
    stubJson(`${BASE}/api/boards/shared/btok_2`, SHARED_BOARD(null, null))

    const meta = await boardMetadata({ params: Promise.resolve({ token: 'btok_2' }) })

    expect(meta.openGraph?.images).toBeUndefined()
    expect(meta.twitter?.card).toBe('summary')
    expect(meta.twitter?.images).toBeUndefined()
  })
})
