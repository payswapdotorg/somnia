// tests/explore-ui.test.tsx — Somnia ideas feed (T4b).
//
// jsdom contract tests for the public explore surface: GET /api/ideas on
// mount, like/unlike through the session-authenticated job routes, the
// signed-out like path (sign-in invitation, no API call), and page-based
// pagination via the offset parameter.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { ExploreApp } from '@/components/somnia/explore-app'
import type { SessionUser } from '@/hooks/use-session'

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response
}

const VIEWER: SessionUser = {
  id: 'u_123',
  email: 'maker@somnia.test',
  name: 'Maker',
  avatarSeed: 'aurora',
  plan: 'trial',
  credits: 1000,
  createdAt: '2026-10-29T00:00:00.000Z',
}

function feedItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'j_1',
    prompt: 'a paper boat drifting through neon canals',
    model: 'pulse-3',
    resolution: '720p',
    aspectRatio: '16:9',
    durationSec: 5,
    loop: false,
    createdAt: '2026-10-28T00:00:00.000Z',
    author: { name: 'Nocturne', avatarSeed: 'ember' },
    videoPath: '/generated/j_1.mp4',
    likeCount: 3,
    likedByMe: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: 'unauthorized' })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function fetchMock() {
  return fetch as unknown as ReturnType<typeof vi.fn>
}

function stubFetch(routes: Record<string, { status?: number; body: unknown }>) {
  fetchMock().mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    const route = routes[url]
    if (route) return jsonResponse(route.status ?? 200, route.body)
    return jsonResponse(404, { error: 'not_found', message: `unhandled ${url}` })
  })
}

describe('ExploreApp — public feed', () => {
  it('loads the ideas feed on mount and renders prompt, author and like counts', async () => {
    stubFetch({
      '/api/ideas?limit=24&offset=0': {
        body: {
          items: [feedItem(), feedItem({ id: 'j_2', prompt: 'frost creeping over glass orchids', likeCount: 7 })],
          total: 2,
        },
      },
    })
    render(<ExploreApp />)

    expect(await screen.findByText(/paper boat drifting through neon canals/i)).toBeInTheDocument()
    expect(screen.getByText(/frost creeping over glass orchids/i)).toBeInTheDocument()
    expect(screen.getAllByText(/nocturne/i).length).toBe(2)
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('like: POST /api/jobs/:id/like for the signed-in viewer and bumps the count', async () => {
    stubFetch({
      '/api/ideas?limit=24&offset=0': { body: { items: [feedItem()], total: 1 } },
      '/api/jobs/j_1/like': { body: { liked: true, count: 4 } },
    })
    render(<ExploreApp viewer={VIEWER} />)

    await screen.findByText(/paper boat/i)
    fireEvent.click(screen.getByRole('button', { name: /like/i }))

    await waitFor(() => expect(screen.getByText('4')).toBeInTheDocument())
    const likeCall = fetchMock().mock.calls.find(([u]) => String(u) === '/api/jobs/j_1/like')
    expect(likeCall?.[1]).toMatchObject({ method: 'POST' })
  })

  it('unlike: DELETE /api/jobs/:id/like on an already-liked card', async () => {
    stubFetch({
      '/api/ideas?limit=24&offset=0': {
        body: { items: [feedItem({ likedByMe: true, likeCount: 5 })], total: 1 },
      },
      '/api/jobs/j_1/like': { body: { liked: false, count: 4 } },
    })
    render(<ExploreApp viewer={VIEWER} />)

    await screen.findByText(/paper boat/i)
    fireEvent.click(screen.getByRole('button', { name: /unlike/i }))

    await waitFor(() => expect(screen.getByText('4')).toBeInTheDocument())
    const likeCall = fetchMock().mock.calls.find(([u]) => String(u) === '/api/jobs/j_1/like')
    expect(likeCall?.[1]).toMatchObject({ method: 'DELETE' })
  })

  it('signed out: like invites sign-in without any API call', async () => {
    stubFetch({
      '/api/ideas?limit=24&offset=0': { body: { items: [feedItem()], total: 1 } },
    })
    render(<ExploreApp viewer={null} />)

    await screen.findByText(/paper boat/i)
    fireEvent.click(screen.getByRole('button', { name: /like/i }))

    const link = await screen.findByRole('link', { name: /sign in to like/i })
    expect(link).toHaveAttribute('href', '/signin')
    expect(fetchMock().mock.calls.some(([u]) => String(u) === '/api/jobs/j_1/like')).toBe(false)
  })

  it('load more: fetches the next page at offset=24 and appends the cards', async () => {
    stubFetch({
      '/api/ideas?limit=24&offset=0': { body: { items: [feedItem()], total: 2 } },
      '/api/ideas?limit=24&offset=24': {
        body: { items: [feedItem({ id: 'j_2', prompt: 'aurora over a sleeping volcano' })], total: 2 },
      },
    })
    render(<ExploreApp />)

    await screen.findByText(/paper boat/i)
    fireEvent.click(screen.getByRole('button', { name: /load more/i }))

    expect(await screen.findByText(/aurora over a sleeping volcano/i)).toBeInTheDocument()
    expect(screen.getByText(/paper boat/i)).toBeInTheDocument()
    expect(fetchMock().mock.calls.some(([u]) => String(u) === '/api/ideas?limit=24&offset=24')).toBe(true)
  })

  it('renders each card with its playable video element', async () => {
    stubFetch({
      '/api/ideas?limit=24&offset=0': { body: { items: [feedItem()], total: 1 } },
    })
    render(<ExploreApp />)

    await screen.findByText(/paper boat/i)
    const video = screen.getByTestId('feed-video') as HTMLVideoElement
    expect(video.getAttribute('src')).toBe('/generated/j_1.mp4')
    // React sets muted as a DOM property, not an attribute — check the property
    expect(video.muted).toBe(true)
  })
})
