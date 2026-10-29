// tests/account-ui.test.tsx — Somnia boards, API keys and plans (T4b).
//
// jsdom contract tests for the account surfaces: board management
// (list/create/delete/share → public board link), sk_somnia API key
// lifecycle (list/mint-once/revoke) and the public plan catalogue.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { BoardsApp } from '@/components/somnia/boards-app'
import { KeysApp } from '@/components/somnia/keys-app'
import { PlansApp } from '@/components/somnia/plans-app'
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

const BOARDS = {
  boards: [
    { id: 'b_1', name: 'Neon Nocturnes', description: 'night city moods', shareToken: null, jobCount: 3 },
    { id: 'b_2', name: 'Paper Worlds', description: 'origami dreamscapes', shareToken: 'btok_2', jobCount: 1 },
  ],
}

const KEYS = {
  keys: [
    { id: 'k_1', name: 'nightly sync', prefix: 'sk_somnia_abc', lastUsedAt: null, revokedAt: null, createdAt: '2026-10-28T00:00:00.000Z' },
    { id: 'k_2', name: 'old laptop', prefix: 'sk_somnia_def', lastUsedAt: '2026-10-29T00:00:00.000Z', revokedAt: '2026-10-29T01:00:00.000Z', createdAt: '2026-10-27T00:00:00.000Z' },
  ],
}

const PLANS = {
  plans: [
    { id: 'trial', label: 'Trial', priceUsd: 0, monthlyCredits: 0, agentMultiplier: 1, agentVariationCap: 2, features: ['1,000 one-time credits', 'Full create suite'] },
    { id: 'spark', label: 'Spark', priceUsd: 30, monthlyCredits: 10_000, agentMultiplier: 1, agentVariationCap: 2, features: ['10,000 credits / month', 'Pulse 3 + Pulse Flash models'] },
    { id: 'studio', label: 'Studio', priceUsd: 90, monthlyCredits: 40_000, agentMultiplier: 4, agentVariationCap: 4, features: ['40,000 credits / month', 'Priority queue'] },
    { id: 'infinite', label: 'Infinite', priceUsd: 300, monthlyCredits: 150_000, agentMultiplier: 15, agentVariationCap: 6, features: ['150,000 credits / month', 'Fastest queue'] },
  ],
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

describe('BoardsApp', () => {
  it('lists boards with honest job counts and shared badges', async () => {
    stubFetch({ '/api/boards': { body: BOARDS } })
    render(<BoardsApp user={USER} />)

    expect(await screen.findByText(/neon nocturnes/i)).toBeInTheDocument()
    expect(screen.getByText(/paper worlds/i)).toBeInTheDocument()
    expect(screen.getByText(/3 dreams/i)).toBeInTheDocument()
    expect(screen.getByText(/1 dream/i)).toBeInTheDocument()
    expect(screen.getByText(/shared/i)).toBeInTheDocument()
  })

  it('creates a board: POST /api/boards with name + description, then refreshes', async () => {
    let created = false
    stubFetch({
      '/api/boards': {
        body: () =>
          created
            ? {
                boards: [
                  ...BOARDS.boards,
                  { id: 'b_3', name: 'Tidal Studies', description: 'slow water', shareToken: null, jobCount: 0 },
                ],
              }
            : BOARDS,
      },
    })
    fetchMock().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/boards' && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ name: 'Tidal Studies', description: 'slow water' })
        created = true
        return jsonResponse(201, { board: { id: 'b_3', name: 'Tidal Studies', description: 'slow water', shareToken: null, jobCount: 0 } })
      }
      if (url === '/api/boards') {
        return jsonResponse(200, created ? { boards: [...BOARDS.boards, { id: 'b_3', name: 'Tidal Studies', description: 'slow water', shareToken: null, jobCount: 0 }] } : BOARDS)
      }
      return jsonResponse(404, { error: 'not_found' })
    })
    render(<BoardsApp user={USER} />)

    await screen.findByText(/neon nocturnes/i)
    fireEvent.change(screen.getByLabelText(/board name/i), { target: { value: 'Tidal Studies' } })
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'slow water' } })
    fireEvent.click(screen.getByRole('button', { name: /create board/i }))

    expect(await screen.findByText(/tidal studies/i)).toBeInTheDocument()
    expect(fetchMock().mock.calls.filter(([u]) => String(u) === '/api/boards').length).toBeGreaterThanOrEqual(3)
  })

  it('deletes a board: DELETE /api/boards/:id, jobs survive note', async () => {
    let deleted = false
    fetchMock().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/boards/b_1' && init?.method === 'DELETE') {
        deleted = true
        return jsonResponse(200, { ok: true })
      }
      if (url === '/api/boards') {
        return jsonResponse(200, deleted ? { boards: BOARDS.boards.slice(1) } : BOARDS)
      }
      return jsonResponse(404, { error: 'not_found' })
    })
    render(<BoardsApp user={USER} />)

    await screen.findByText(/neon nocturnes/i)
    fireEvent.click(screen.getAllByRole('button', { name: /delete/i })[0])

    await waitFor(() => expect(screen.queryByText(/neon nocturnes/i)).not.toBeInTheDocument())
    expect(screen.getByText(/paper worlds/i)).toBeInTheDocument()
  })

  it('shares a board: POST /api/boards/:id/share → public board link', async () => {
    fetchMock().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/boards') return jsonResponse(200, BOARDS)
      if (url === '/api/boards/b_1/share' && init?.method === 'POST') {
        return jsonResponse(201, { shareToken: 'btok_9f' })
      }
      return jsonResponse(404, { error: 'not_found' })
    })
    render(<BoardsApp user={USER} />)

    await screen.findByText(/neon nocturnes/i)
    fireEvent.click(screen.getAllByRole('button', { name: /share/i })[0])

    const link = await screen.findByRole('link', { name: /\/boards\/btok_9f/i })
    expect(link).toHaveAttribute('href', '/boards/btok_9f')
  })

  it('signed out: invites sign-in without API calls', () => {
    render(<BoardsApp user={null} />)

    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/signin')
    expect(fetch).toHaveBeenCalledTimes(0)
  })
})

describe('KeysApp', () => {
  it('lists keys with prefixes and revoked state', async () => {
    stubFetch({ '/api/keys': { body: KEYS } })
    render(<KeysApp user={USER} />)

    expect(await screen.findByText(/nightly sync/i)).toBeInTheDocument()
    expect(screen.getByText(/old laptop/i)).toBeInTheDocument()
    expect(screen.getByText(/sk_somnia_abc/i)).toBeInTheDocument()
    expect(screen.getByText(/revoked/i)).toBeInTheDocument()
  })

  it('mints a key: POST /api/keys with a name, plaintext shown exactly once', async () => {
    fetchMock().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/keys' && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ name: 'automation' })
        return jsonResponse(201, {
          key: 'sk_somnia_plainsecret_do_not_show_again',
          id: 'k_3',
          name: 'automation',
          prefix: 'sk_somnia_pl',
          createdAt: '2026-10-29T00:00:00.000Z',
        })
      }
      if (url === '/api/keys') {
        return jsonResponse(200, KEYS)
      }
      return jsonResponse(404, { error: 'not_found' })
    })
    render(<KeysApp user={USER} />)

    await screen.findByText(/nightly sync/i)
    fireEvent.change(screen.getByLabelText(/key name/i), { target: { value: 'automation' } })
    fireEvent.click(screen.getByRole('button', { name: /mint key/i }))

    const secret = await screen.findByText(/sk_somnia_plainsecret_do_not_show_again/i)
    expect(secret).toBeInTheDocument()
    expect(screen.getByText(/only shown once/i)).toBeInTheDocument()
  })

  it('revokes a key: DELETE /api/keys/:id marks it revoked', async () => {
    let revoked = false
    fetchMock().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/keys/k_1' && init?.method === 'DELETE') {
        revoked = true
        return jsonResponse(200, { ok: true })
      }
      if (url === '/api/keys') {
        return jsonResponse(
          200,
          revoked
            ? { keys: KEYS.keys.map((k) => (k.id === 'k_1' ? { ...k, revokedAt: '2026-10-29T02:00:00.000Z' } : k)) }
            : KEYS
        )
      }
      return jsonResponse(404, { error: 'not_found' })
    })
    render(<KeysApp user={USER} />)

    await screen.findByText(/nightly sync/i)
    fireEvent.click(screen.getAllByRole('button', { name: /revoke/i })[0])

    await waitFor(() => expect(screen.getAllByText(/revoked/i).length).toBeGreaterThanOrEqual(2))
    expect(screen.getByText(/old laptop/i)).toBeInTheDocument()
  })

  it('signed out: invites sign-in without API calls', () => {
    render(<KeysApp user={null} />)

    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/signin')
    expect(fetch).toHaveBeenCalledTimes(0)
  })
})

describe('PlansApp', () => {
  it('renders the public plan catalogue without auth: labels, prices, features', async () => {
    stubFetch({ '/api/plans': { body: PLANS } })
    render(<PlansApp />)

    expect(await screen.findByText(/^spark$/i)).toBeInTheDocument()
    expect(screen.getByText(/^studio$/i)).toBeInTheDocument()
    expect(screen.getByText(/^infinite$/i)).toBeInTheDocument()
    expect(screen.getByText(/^trial$/i)).toBeInTheDocument()
    expect(screen.getByText(/\$30\b/)).toBeInTheDocument()
    expect(screen.getByText(/\$90\b/)).toBeInTheDocument()
    expect(screen.getByText(/\$300\b/)).toBeInTheDocument()
    expect(screen.getByText(/10,000 credits \/ month/i)).toBeInTheDocument()
    expect(screen.getByText(/priority queue/i)).toBeInTheDocument()
    expect(screen.getByText(/current plan/i)).toBeInTheDocument()
  })

  it("marks the caller's plan when a signed-in user is provided", async () => {
    stubFetch({ '/api/plans': { body: PLANS } })
    render(<PlansApp user={{ ...USER, plan: 'spark' }} />)

    const sparkCard = await screen.findByText(/^spark$/i)
    expect(sparkCard.closest('[data-plan="spark"]')).toHaveAttribute('data-current', 'true')
  })
})
