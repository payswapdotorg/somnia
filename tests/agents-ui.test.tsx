// tests/agents-ui.test.tsx — Somnia agent runs (T6b).
//
// jsdom contract specs for the /agents surface: goal → POST /api/agents →
// the plan cards (gated by the user's plan variation cap), dispatch →
// POST /api/agents/:id/start, then live polling of GET /api/agents/:id +
// GET /api/jobs filtered to the run until every variation settles.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { AgentsApp } from '@/components/somnia/agents-app'
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
  plan: 'studio',
  credits: 4000,
  createdAt: '2026-10-29T00:00:00.000Z',
}

const GOAL = 'a slow drone shot over a foggy polder at dawn'

const PLAN = [
  { shot: 1, prompt: `${GOAL} — wide establishing shot, coherent visual style`, note: 'establishing' },
  { shot: 2, prompt: `${GOAL} — medium tracking shot, coherent visual style`, note: 'medium' },
  { shot: 3, prompt: `${GOAL} — close detail insert, coherent visual style`, note: 'detail' },
  { shot: 4, prompt: `${GOAL} — kinetic motion beat, coherent visual style`, note: 'motion' },
]

const PLANNED_RUN = {
  id: 'run_1',
  goal: GOAL,
  status: 'planning',
  variations: 0,
  creditsBudget: 0,
  plan: PLAN,
  createdAt: '2026-10-29T00:00:00.000Z',
  completedAt: null,
}

const DISPATCHED_RUN = {
  ...PLANNED_RUN,
  status: 'completed',
  variations: 4,
  creditsBudget: 400,
  completedAt: '2026-10-29T00:01:00.000Z',
}

function job(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'j_x',
    kind: 'video',
    mode: 'agent',
    prompt: 'prompt',
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
    agentRunId: 'run_1',
    createdAt: '2026-10-29T00:00:00.000Z',
    keyframes: [],
    assets: [
      { id: 'a_1', jobId: 'j_x', kind: 'video', path: '/generated/runvid-1.mp4', label: null, variantKey: 'main', createdAt: '2026-10-29T00:00:00.000Z' },
    ],
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

describe('AgentsApp', () => {
  it('signed out: invites sign-in without API calls', () => {
    render(<AgentsApp user={null} />)

    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/signin')
    expect(fetch).toHaveBeenCalledTimes(0)
  })

  it('plans a run from a goal: POST /api/agents, renders the gated plan cards', async () => {
    fetchMock().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/agents' && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ goal: GOAL })
        return jsonResponse(201, { run: PLANNED_RUN, plan: PLAN })
      }
      return jsonResponse(404, { error: 'not_found', message: `unhandled ${url}` })
    })
    render(<AgentsApp user={USER} />)

    fireEvent.change(screen.getByLabelText(/goal/i), { target: { value: GOAL } })
    fireEvent.click(screen.getByRole('button', { name: /plan the run/i }))

    // every plan step renders with its shot number, prompt and note
    expect(await screen.findByText(new RegExp(PLAN[0]!.prompt, 'i'))).toBeInTheDocument()
    expect(screen.getByText(new RegExp(PLAN[3]!.prompt, 'i'))).toBeInTheDocument()
    expect(screen.getByText(/shot 1/i)).toBeInTheDocument()
    expect(screen.getByText(/shot 4/i)).toBeInTheDocument()

    // the budget line is honest: 4 variations × 100 credits
    expect(screen.getByText('4 variations planned')).toBeInTheDocument()
    expect(screen.getByText(/400 credits/i)).toBeInTheDocument()

    // dispatch is gated behind the plan
    expect(screen.getByRole('button', { name: /dispatch/i })).toBeInTheDocument()
  })

  it('dispatches the plan and polls the linked jobs to settlement', async () => {
    let dispatched = false
    let polls = 0
    fetchMock().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/agents' && init?.method === 'POST') {
        return jsonResponse(201, { run: PLANNED_RUN, plan: PLAN })
      }
      if (url === '/api/agents/run_1/start' && init?.method === 'POST') {
        expect(JSON.parse(String(init.body ?? '{}'))).toEqual({})
        dispatched = true
        return jsonResponse(200, { run: DISPATCHED_RUN })
      }
      if (url === '/api/agents/run_1') {
        return jsonResponse(200, DISPATCHED_RUN)
      }
      if (url === '/api/jobs?limit=100') {
        polls += 1
        const settled = polls >= 2
        return jsonResponse(200, {
          jobs: [
            job({ id: 'j_a', prompt: `${GOAL} — wide establishing shot, coherent visual style`, status: settled ? 'completed' : 'running', progress: settled ? 100 : 48, assets: settled ? job({}).assets : [] }),
            job({ id: 'j_b', prompt: `${GOAL} — medium tracking shot, coherent visual style`, status: settled ? 'completed' : 'queued', progress: settled ? 100 : 0, assets: settled ? job({ id: 'j_b' }).assets : [] }),
            // an unrelated job from another surface must not leak in
            job({ id: 'j_other', agentRunId: null, mode: 'create', prompt: 'unrelated dream' }),
          ],
        })
      }
      return jsonResponse(404, { error: 'not_found', message: `unhandled ${url}` })
    })
    render(<AgentsApp user={USER} />)

    fireEvent.change(screen.getByLabelText(/goal/i), { target: { value: GOAL } })
    fireEvent.click(screen.getByRole('button', { name: /plan the run/i }))
    await screen.findByText(/shot 1/i)

    fireEvent.click(screen.getByRole('button', { name: /dispatch/i }))

    // variation cards render from the run's jobs, live progress visible;
    // unrelated jobs filtered out
    expect(await screen.findByText(/48%/)).toBeInTheDocument()
    expect(screen.queryByText(/unrelated dream/i)).not.toBeInTheDocument()
    await waitFor(
      () => {
        // both linked variations settle completed with their rendered clips
        const videos = screen.getAllByRole('link', { name: /watch clip/i })
        expect(videos).toHaveLength(2)
        expect(videos[0]).toHaveAttribute('href', '/generated/runvid-1.mp4')
        expect(screen.queryByText(/unrelated dream/i)).not.toBeInTheDocument()
      },
      { timeout: 5000 }
    )

    // the run view polls until every variation settles (≥2 job fetches)
    expect(dispatched).toBe(true)
    expect(polls).toBeGreaterThanOrEqual(2)

    // the run summary is honest: variations + budget
    expect(screen.getByText('4 variations')).toBeInTheDocument()
    expect(screen.getByText(/400 credits/i)).toBeInTheDocument()
  })

  it('surfaces dispatch failures honestly without inventing variations', async () => {
    fetchMock().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/agents' && init?.method === 'POST') {
        return jsonResponse(201, { run: PLANNED_RUN, plan: PLAN })
      }
      if (url === '/api/agents/run_1/start' && init?.method === 'POST') {
        return jsonResponse(400, {
          error: 'insufficient_credits',
          message: 'insufficient credits for the planned 4 variations',
        })
      }
      return jsonResponse(404, { error: 'not_found', message: `unhandled ${url}` })
    })
    render(<AgentsApp user={USER} />)

    fireEvent.change(screen.getByLabelText(/goal/i), { target: { value: GOAL } })
    fireEvent.click(screen.getByRole('button', { name: /plan the run/i }))
    await screen.findByText(/shot 1/i)

    fireEvent.click(screen.getByRole('button', { name: /dispatch/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/insufficient credits for the planned 4 variations/i)
    expect(screen.queryByText(/watch clip/i)).not.toBeInTheDocument()
  })

  it('validates the goal before calling the API', async () => {
    render(<AgentsApp user={USER} />)

    fireEvent.click(screen.getByRole('button', { name: /plan the run/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/describe the dream first/i)
    expect(fetch).toHaveBeenCalledTimes(0)
  })
})
