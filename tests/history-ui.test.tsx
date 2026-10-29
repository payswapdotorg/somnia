// tests/history-ui.test.tsx — Somnia history + job detail (T4b).
//
// jsdom contract tests for the history surface: GET /api/jobs lists my work
// with honest status chips, the detail panel mounts the rendered video, and
// every action speaks the exact job route contract (extend, modify,
// reframe, upscale, share/unshare, remix prefill → composer hand-off).
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { HistoryApp } from '@/components/somnia/history-app'
import type { SessionUser } from '@/hooks/use-session'

const pushSpy = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushSpy, refresh: vi.fn() }),
}))

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

function jobDto(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job_1',
    kind: 'video',
    mode: 'create',
    prompt: 'a paper boat drifting through neon canals',
    model: 'pulse-3',
    resolution: '720p',
    aspectRatio: '16:9',
    durationSec: 5,
    hdr: false,
    loop: false,
    status: 'completed',
    progress: 100,
    errorMessage: null,
    creditsCharged: 100,
    shareToken: null,
    sharedAt: null,
    boardId: null,
    createdAt: '2026-10-28T00:00:00.000Z',
    keyframes: [
      { id: 'k_1', jobId: 'job_1', order: 1, path: '/generated/job_1-f1.png', createdAt: '2026-10-28T00:00:00.000Z' },
      { id: 'k_2', jobId: 'job_1', order: 2, path: '/generated/job_1-f2.png', createdAt: '2026-10-28T00:00:00.000Z' },
    ],
    assets: [
      {
        id: 'a_1',
        jobId: 'job_1',
        kind: 'video',
        path: '/generated/job_1.mp4',
        label: null,
        variantKey: 'main',
        createdAt: '2026-10-28T00:00:00.000Z',
      },
    ],
    ...overrides,
  }
}

const REMIX_PREFILL = {
  prompt: 'a paper boat drifting through neon canals',
  model: 'pulse-3',
  resolution: '720p',
  aspectRatio: '16:9',
  durationSec: 5,
  hdr: false,
  loop: false,
  startFramePath: null,
  endFramePath: null,
}

beforeEach(() => {
  window.sessionStorage.clear()
  pushSpy.mockClear()
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

async function openFirstJobDetail() {
  fireEvent.click(await screen.findByRole('button', { name: /paper boat/i }))
  await waitFor(() =>
    expect((screen.getByTestId('rendered-video') as HTMLVideoElement).getAttribute('src')).toBe(
      '/generated/job_1.mp4'
    )
  )
}

describe('HistoryApp — signed out', () => {
  it('invites sign-in and makes no API calls', () => {
    render(<HistoryApp user={null} />)

    const link = screen.getByRole('link', { name: /sign in/i })
    expect(link).toHaveAttribute('href', '/signin')
    expect(fetch).toHaveBeenCalledTimes(0)
  })
})

describe('HistoryApp — list + detail contract', () => {
  it('lists my jobs with honest status chips and kind badges', async () => {
    stubFetch({
      '/api/jobs': {
        body: {
          jobs: [
            jobDto(),
            jobDto({ id: 'job_2', prompt: 'storm over copper rooftops', status: 'queued', progress: 0, creditsCharged: 0, keyframes: [], assets: [] }),
            jobDto({ id: 'job_3', kind: 'image', prompt: 'chrome dunes at dusk', durationSec: 0, status: 'completed' }),
          ],
        },
      },
    })
    render(<HistoryApp user={USER} />)

    expect(await screen.findByText(/paper boat drifting through neon canals/i)).toBeInTheDocument()
    expect(screen.getByText(/storm over copper rooftops/i)).toBeInTheDocument()
    expect(screen.getByText(/chrome dunes at dusk/i)).toBeInTheDocument()
    expect(screen.getAllByText(/completed/i).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/queued/i)).toBeInTheDocument()
    expect(screen.getByText(/image/i)).toBeInTheDocument()
  })

  it('detail: mounts the video + keyframe strip', async () => {
    stubFetch({ '/api/jobs': { body: { jobs: [jobDto()] } } })
    render(<HistoryApp user={USER} />)

    await openFirstJobDetail()

    const strip = screen.getByTestId('keyframe-strip')
    const thumbs = strip.querySelectorAll('img')
    expect(thumbs.length).toBe(2)
    expect(thumbs[0]?.getAttribute('src')).toBe('/generated/job_1-f1.png')
  })

  it('share: POST /api/jobs/:id/share mints the token, link appears; DELETE revokes', async () => {
    stubFetch({
      '/api/jobs': {
        body: { jobs: [jobDto()] },
      },
      '/api/jobs/job_1/share': { status: 201, body: { shareToken: 'tok9f3ab21c' } },
      '/api/jobs/job_1/like': { body: { liked: true, count: 1 } },
    })
    render(<HistoryApp user={USER} />)

    await openFirstJobDetail()
    fireEvent.click(screen.getByRole('button', { name: /share/i }))

    const link = await screen.findByRole('link', { name: /\/share\/tok9f3ab21c/i })
    expect(link).toHaveAttribute('href', '/share/tok9f3ab21c')

    // revoke — DELETE on the same route clears the link
    fetchMock().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/jobs') return jsonResponse(200, { jobs: [jobDto()] })
      if (url === '/api/jobs/job_1/share') {
        expect(init?.method).toBe('DELETE')
        return jsonResponse(200, { ok: true })
      }
      return jsonResponse(404, { error: 'not_found' })
    })
    fireEvent.click(screen.getByRole('button', { name: /stop sharing/i }))

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /\/share\/tok9f3ab21c/i })).not.toBeInTheDocument()
    )
  })

  it('extend: POST /api/jobs/:id/extend (+5s continuation)', async () => {
    stubFetch({
      '/api/jobs': { body: { jobs: [jobDto()] } },
      '/api/jobs/job_1/extend': {
        status: 201,
        body: { job: jobDto({ id: 'job_4', mode: 'extend', prompt: 'a paper boat drifting through neon canals (continued)', status: 'queued' }) },
      },
    })
    render(<HistoryApp user={USER} />)

    await openFirstJobDetail()
    fireEvent.click(screen.getByRole('button', { name: /extend/i }))

    const extendCall = await waitFor(() => {
      const call = fetchMock().mock.calls.find(([u]) => String(u) === '/api/jobs/job_1/extend')
      expect(call).toBeTruthy()
      return call
    })
    expect(extendCall?.[1]).toMatchObject({ method: 'POST' })
    await waitFor(() => expect(screen.getByText(/continued/i)).toBeInTheDocument())
  })

  it('modify: POST /api/jobs/:id/modify with the instruction', async () => {
    stubFetch({
      '/api/jobs': { body: { jobs: [jobDto()] } },
      '/api/jobs/job_1/modify': {
        status: 201,
        body: { job: jobDto({ id: 'job_5', mode: 'modify', prompt: 'a paper boat drifting through neon canals, glassy water' }) },
      },
    })
    render(<HistoryApp user={USER} />)

    await openFirstJobDetail()
    fireEvent.change(screen.getByLabelText(/instruction/i), { target: { value: 'make the water glassy' } })
    fireEvent.click(screen.getByRole('button', { name: /modify clip/i }))

    await waitFor(() => {
      const call = fetchMock().mock.calls.find(([u]) => String(u) === '/api/jobs/job_1/modify')
      expect(call).toBeTruthy()
      expect(call?.[1]).toBeDefined()
      const init = call?.[1] as RequestInit
      expect(init.method).toBe('POST')
      expect(JSON.parse(String(init.body))).toEqual({ instruction: 'make the water glassy' })
    })
    await waitFor(() => expect(screen.getByText(/modify queued/i)).toBeInTheDocument())
  })

  it('reframe: POST /api/jobs/:id/reframe with the chosen aspect', async () => {
    stubFetch({
      '/api/jobs': { body: { jobs: [jobDto()] } },
      '/api/jobs/job_1/reframe': {
        status: 200,
        body: { asset: { id: 'a_r1', jobId: 'job_1', kind: 'reframe', path: '/generated/job_1-reframe-9x16.mp4', label: '9:16', variantKey: 'reframe-9x16' } },
      },
    })
    render(<HistoryApp user={USER} />)

    await openFirstJobDetail()
    fireEvent.change(screen.getByLabelText(/reframe to/i), { target: { value: '9:16' } })
    fireEvent.click(screen.getByRole('button', { name: /^reframe$/i }))

    await waitFor(() => {
      const call = fetchMock().mock.calls.find(([u]) => String(u) === '/api/jobs/job_1/reframe')
      expect(call).toBeTruthy()
      const init = call?.[1] as RequestInit
      expect(init.method).toBe('POST')
      expect(JSON.parse(String(init.body))).toEqual({ aspect: '9:16' })
    })
  })

  it('upscale: POST /api/jobs/:id/upscale', async () => {
    stubFetch({
      '/api/jobs': { body: { jobs: [jobDto()] } },
      '/api/jobs/job_1/upscale': {
        status: 200,
        body: { asset: { id: 'a_u1', jobId: 'job_1', kind: 'upscale', path: '/generated/job_1-upscaled.mp4', label: '4K', variantKey: 'upscale-4k' } },
      },
    })
    render(<HistoryApp user={USER} />)

    await openFirstJobDetail()
    fireEvent.click(screen.getByRole('button', { name: /upscale/i }))

    await waitFor(() => {
      const call = fetchMock().mock.calls.find(([u]) => String(u) === '/api/jobs/job_1/upscale')
      expect(call).toBeTruthy()
      expect(call?.[1]).toMatchObject({ method: 'POST' })
    })
  })

  it('remix: POST /api/jobs/:id/remix → prefill into sessionStorage and route home', async () => {
    stubFetch({
      '/api/jobs': { body: { jobs: [jobDto()] } },
      '/api/jobs/job_1/remix': { body: REMIX_PREFILL },
    })
    render(<HistoryApp user={USER} />)

    await openFirstJobDetail()
    fireEvent.click(screen.getByRole('button', { name: /remix/i }))

    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith('/'))
    expect(window.sessionStorage.getItem('somnia:remix')).toBe(JSON.stringify(REMIX_PREFILL))
  })
})
