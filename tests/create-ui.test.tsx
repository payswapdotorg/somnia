// tests/create-ui.test.tsx — Somnia cockpit composer (T4b).
//
// jsdom contract tests for the create surface: the composer must speak the
// exact /api/{boards,brainstorm,generate,image,jobs/:id} contract with the
// Somnia pricing math (plans.ts) rendered honestly, the remix prefill
// applied, and server rejections surfaced verbatim.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { CreateApp } from '@/components/somnia/create-app'
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

const QUEUED_JOB = {
  id: 'job_1',
  kind: 'video',
  prompt: 'bioluminescent tide pool at night',
  model: 'pulse-3',
  resolution: '720p',
  aspectRatio: '16:9',
  durationSec: 5,
  hdr: false,
  loop: false,
  status: 'queued',
  progress: 0,
  creditsCharged: 100,
  placeholderRender: false,
  keyframes: [],
  assets: [],
}

const COMPLETED_JOB = {
  ...QUEUED_JOB,
  status: 'completed',
  progress: 100,
  assets: [
    {
      id: 'a_1',
      jobId: 'job_1',
      kind: 'video',
      path: '/generated/job_1.mp4',
      label: null,
      variantKey: 'main',
      createdAt: '2026-10-29T00:00:00.000Z',
    },
  ],
}

const REMIX_PREFILL = {
  prompt: 'a lighthouse sweeping a storm-lit sea',
  model: 'pulse-flash',
  resolution: '540p',
  aspectRatio: '9:16',
  durationSec: 10,
  hdr: true,
  loop: false,
  startFramePath: '/generated/src-end.png',
  endFramePath: null,
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

/** Route-level fetch stub: exact-URL matcher with assertion callbacks. */
function stubFetch(routes: Record<string, { status?: number; body: (init?: RequestInit) => unknown }>) {
  fetchMock().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const route = routes[url]
    if (route) return jsonResponse(route.status ?? 200, route.body(init))
    return jsonResponse(404, { error: 'not_found', message: `unhandled ${url}` })
  })
}

async function submitPrompt(prompt: string) {
  fireEvent.change(screen.getByLabelText(/prompt/i), { target: { value: prompt } })
  fireEvent.click(screen.getByRole('button', { name: /dream it/i }))
}

describe('CreateApp — signed out', () => {
  it('invites sign-in instead of rendering the composer, with no API calls', () => {
    render(<CreateApp user={null} />)

    const link = screen.getByRole('link', { name: /sign in/i })
    expect(link).toHaveAttribute('href', '/signin')
    expect(screen.queryByRole('button', { name: /dream it/i })).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(0)
  })
})

describe('CreateApp — render truth (T14)', () => {
  it('shows the demo-tier notice when health reports activeProvider demo', async () => {
    stubFetch({
      '/api/boards': { status: 200, body: () => ({ boards: [] }) },
      '/api/providers/health': {
        status: 200,
        body: () => ({
          activeProvider: 'demo',
          imageSdkAvailable: false,
          llmConfigured: true,
          llmModel: 'meta-llama/llama-3.3-70b-instruct',
          modelRoutes: { 'pulse-3': 'demo', 'pulse-flash': 'demo' },
        }),
      },
    })
    render(<CreateApp user={USER} />)

    const notice = await screen.findByTestId('demo-tier-notice')
    expect(notice).toHaveTextContent(/demo tier/i)
    expect(notice).toHaveTextContent(/placeholder art/i)
  })

  it('softens the notice when the local image SDK is reachable (real keyframes)', async () => {
    stubFetch({
      '/api/boards': { status: 200, body: () => ({ boards: [] }) },
      '/api/providers/health': {
        status: 200,
        body: () => ({
          activeProvider: 'demo',
          imageSdkAvailable: true,
          llmConfigured: false,
          llmModel: null,
          modelRoutes: {},
        }),
      },
    })
    render(<CreateApp user={USER} />)

    const notice = await screen.findByTestId('demo-tier-notice')
    expect(notice).toHaveTextContent(/locally generated keyframes/i)
    expect(notice).not.toHaveTextContent(/placeholder art/i)
  })

  it('stays silent when a hosted provider tier is active', async () => {
    stubFetch({
      '/api/boards': { status: 200, body: () => ({ boards: [] }) },
      '/api/providers/health': {
        status: 200,
        body: () => ({
          activeProvider: 'fal',
          imageSdkAvailable: false,
          llmConfigured: false,
          llmModel: null,
          modelRoutes: { 'pulse-3': 'fal' },
        }),
      },
    })
    render(<CreateApp user={USER} />)

    await waitFor(() =>
      expect(fetchMock().mock.calls.some(([u]) => String(u) === '/api/providers/health')).toBe(true)
    )
    expect(screen.queryByTestId('demo-tier-notice')).not.toBeInTheDocument()
  })

  it('badges a completed simulated render on the active job card', async () => {
    stubFetch({
      '/api/boards': { status: 200, body: () => ({ boards: [] }) },
      '/api/providers/health': { status: 200, body: () => ({ activeProvider: 'demo', imageSdkAvailable: false }) },
      '/api/generate': { status: 201, body: () => ({ job: QUEUED_JOB }) },
      '/api/jobs/job_1': {
        status: 200,
        body: () => ({ job: { ...COMPLETED_JOB, placeholderRender: true } }),
      },
    })
    render(<CreateApp user={USER} />)

    await waitFor(() => expect(screen.getByText(/100 credits/i)).toBeInTheDocument())
    await submitPrompt('bioluminescent tide pool at night')

    await waitFor(() => expect(screen.getByText(/simulated render/i)).toBeInTheDocument())
  })
})

describe('CreateApp — composer contract', () => {
  it('loads boards on mount and renders the honest cost preview (pulse-3 · 720p · 5s = 100 credits)', async () => {
    stubFetch({
      '/api/boards': { status: 200, body: () => ({ boards: [] }) },
    })
    render(<CreateApp user={USER} />)

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/boards', expect.anything()))
    await waitFor(() => expect(screen.getByText(/100 credits/i)).toBeInTheDocument())
    expect(screen.queryByText(/40 credits/i)).not.toBeInTheDocument()
  })

  it('submits a video job: POST /api/generate with the full recipe + idempotency key', async () => {
    stubFetch({
      '/api/boards': { status: 200, body: () => ({ boards: [] }) },
      '/api/generate': {
        status: 201,
        body: (init?: RequestInit) => {
          expect(init?.method).toBe('POST')
          expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
          const parsed = JSON.parse(String(init?.body)) as Record<string, unknown>
          expect(parsed).toEqual({
            prompt: 'bioluminescent tide pool at night',
            model: 'pulse-3',
            resolution: '720p',
            aspectRatio: '16:9',
            durationSec: 5,
            hdr: false,
            loop: false,
            idempotencyKey: expect.any(String),
          })
          return { job: QUEUED_JOB }
        },
      },
    })
    const onCreditsChanged = vi.fn()
    render(<CreateApp user={USER} onCreditsChanged={onCreditsChanged} />)

    await waitFor(() => expect(screen.getByText(/100 credits/i)).toBeInTheDocument())
    await submitPrompt('bioluminescent tide pool at night')

    await waitFor(() => expect(screen.getByText(/queued/i)).toBeInTheDocument())
    expect(onCreditsChanged).toHaveBeenCalledTimes(1)
  })

  it('tracks cost live: Pulse Flash + 10s + HDR update the preview', async () => {
    stubFetch({ '/api/boards': { status: 200, body: () => ({ boards: [] }) } })
    render(<CreateApp user={USER} />)

    await waitFor(() => expect(screen.getByText(/100 credits/i)).toBeInTheDocument())

    // pulse-flash 720p 5s = 40; ×3 for 10s = 120; ×2 for HDR = 240
    fireEvent.click(screen.getByRole('button', { name: /pulse flash/i }))
    fireEvent.click(screen.getByRole('button', { name: /^10s$/i }))
    fireEvent.click(screen.getByLabelText(/hdr/i))

    await waitFor(() => expect(screen.getByText(/240 credits/i)).toBeInTheDocument())
  })

  it('image mode: POST /api/image with prompt + aspect only (prism, flat 20 credits)', async () => {
    stubFetch({
      '/api/boards': { status: 200, body: () => ({ boards: [] }) },
      '/api/image': {
        status: 201,
        body: (init?: RequestInit) => {
          expect(init?.method).toBe('POST')
          const parsed = JSON.parse(String(init?.body)) as Record<string, unknown>
          expect(parsed).toEqual({
            prompt: 'a prism still of chrome dunes',
            aspectRatio: '16:9',
            idempotencyKey: expect.any(String),
          })
          return { job: { ...QUEUED_JOB, kind: 'image', durationSec: 0, creditsCharged: 20 } }
        },
      },
    })
    render(<CreateApp user={USER} />)

    await waitFor(() => expect(screen.getByText(/100 credits/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /^image$/i }))
    await waitFor(() => expect(screen.getByText(/20 credits/i)).toBeInTheDocument())

    await submitPrompt('a prism still of chrome dunes')
    await waitFor(() => expect(fetchMock().mock.calls.some(([u]) => String(u) === '/api/image')).toBe(true))
  })

  it('brainstorm: POST /api/brainstorm, apply a variant, submit carries prompt + enhancedPrompt', async () => {
    let submitted = false
    stubFetch({
      '/api/boards': { status: 200, body: () => ({ boards: [] }) },
      '/api/brainstorm': {
        status: 200,
        body: (init?: RequestInit) => {
          expect(JSON.parse(String(init?.body))).toEqual({ prompt: 'tide pool' })
          // T18: the REAL contract — suggestBrainstorms returns variant objects
          // {style,label,text,blurb}, never bare strings (mock drift crashed
          // the live app before this shape was pinned here).
          return {
            variants: [
              {
                style: 'cinematic',
                label: 'Cinematic',
                text: 'a neon jellyfish bloom in the tide pool',
                blurb: 'Camera-first storytelling — lens, light and mood choreographed for film feel.',
              },
              {
                style: 'vivid',
                label: 'Vivid',
                text: 'moonlit anemones',
                blurb: 'Saturated color and bold contrast, composed for maximum visual impact.',
              },
            ],
          }
        },
      },
      '/api/generate': {
        status: 201,
        body: (init?: RequestInit) => {
          const parsed = JSON.parse(String(init?.body)) as Record<string, unknown>
          submitted = true
          expect(parsed.prompt).toBe('a neon jellyfish bloom in the tide pool')
          expect(parsed.enhancedPrompt).toBe('a neon jellyfish bloom in the tide pool')
          return { job: QUEUED_JOB }
        },
      },
    })
    render(<CreateApp user={USER} />)

    await waitFor(() => expect(screen.getByText(/100 credits/i)).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/prompt/i), { target: { value: 'tide pool' } })
    fireEvent.click(screen.getByRole('button', { name: /enhance/i }))

    const chip = await screen.findByRole('button', { name: /neon jellyfish/i })
    fireEvent.click(chip)

    await waitFor(() =>
      expect((screen.getByLabelText(/prompt/i) as HTMLTextAreaElement).value).toBe(
        'a neon jellyfish bloom in the tide pool'
      )
    )
    fireEvent.click(screen.getByRole('button', { name: /dream it/i }))

    await waitFor(() => expect(submitted).toBe(true))
  })

  it('surfaces a 402 insufficient-credits rejection honestly', async () => {
    stubFetch({
      '/api/boards': { status: 200, body: () => ({ boards: [] }) },
      '/api/generate': {
        status: 402,
        body: () => ({
          error: 'insufficient_credits',
          message: 'insufficient credits: this dream costs 100, you have 3',
        }),
      },
    })
    render(<CreateApp user={USER} />)

    await waitFor(() => expect(screen.getByText(/100 credits/i)).toBeInTheDocument())
    await submitPrompt('bioluminescent tide pool at night')

    await waitFor(() =>
      expect(screen.getByText(/insufficient credits: this dream costs 100, you have 3/i)).toBeInTheDocument()
    )
    expect(screen.queryByText(/queued/i)).not.toBeInTheDocument()
  })

  it('polls the accepted job to completion and mounts the rendered video', async () => {
    stubFetch({
      '/api/boards': { status: 200, body: () => ({ boards: [] }) },
      '/api/generate': { status: 201, body: () => ({ job: QUEUED_JOB }) },
      '/api/jobs/job_1': { status: 200, body: () => ({ job: COMPLETED_JOB }) },
    })
    render(<CreateApp user={USER} />)

    await waitFor(() => expect(screen.getByText(/100 credits/i)).toBeInTheDocument())
    await submitPrompt('bioluminescent tide pool at night')

    const video = await waitFor(
      () => {
        const el = screen.getByTestId('rendered-video') as HTMLVideoElement
        expect(el).toBeInTheDocument()
        return el
      },
      { timeout: 5000 }
    )
    expect(video.getAttribute('src')).toBe('/generated/job_1.mp4')
  })

  it('applies a remix prefill to every scalar field', async () => {
    stubFetch({ '/api/boards': { status: 200, body: () => ({ boards: [] }) } })
    render(<CreateApp user={USER} prefill={REMIX_PREFILL} />)

    await waitFor(() => {
      expect((screen.getByLabelText(/prompt/i) as HTMLTextAreaElement).value).toBe(
        'a lighthouse sweeping a storm-lit sea'
      )
    })
    expect(screen.getByRole('button', { name: /pulse flash/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /540p/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /9:16/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^10s$/i })).toHaveAttribute('aria-pressed', 'true')
    expect((screen.getByLabelText(/hdr/i) as HTMLInputElement).checked).toBe(true)
    // 540p pulse-flash 10s HDR = 25 × 3 × 2 = 150
    expect(screen.getByText(/150 credits/i)).toBeInTheDocument()
  })

  it('applies a late-arriving remix prefill (sessionStorage hand-off after mount)', async () => {
    stubFetch({ '/api/boards': { status: 200, body: () => ({ boards: [] }) } })
    // the screen mounts before the history hand-off lands (router.push then
    // the sessionStorage read) — the prefill arrives as a NEW prop
    const view = render(<CreateApp user={USER} prefill={null} />)
    await waitFor(() => expect(screen.getByText(/100 credits/i)).toBeInTheDocument())

    view.rerender(<CreateApp user={USER} prefill={REMIX_PREFILL} />)

    await waitFor(() => {
      expect((screen.getByLabelText(/prompt/i) as HTMLTextAreaElement).value).toBe(
        'a lighthouse sweeping a storm-lit sea'
      )
    })
    expect(screen.getByRole('button', { name: /pulse flash/i })).toHaveAttribute('aria-pressed', 'true')
    expect((screen.getByLabelText(/hdr/i) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText(/150 credits/i)).toBeInTheDocument()
  })
})
