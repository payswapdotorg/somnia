// tests/insights-ui.test.tsx — the Insights / usage surface (T8).
//
// jsdom contract tests for the margin lens UI: one GET /api/insights on
// mount (no polling), the snapshot rendered honestly — job totals, ledger
// flow, revenue / provider cost / gross margin, and the per-(provider x
// model x resolution) tier table. Honesty rules pinned here: negative
// margins render with a negative marker, zero revenue renders 0% (never
// NaN), demo tiers render $0.00, and the provider-cost card says failures
// are included. Plus: manual refresh, load error with retry, and the
// signed-out invitation.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { InsightsApp } from '@/components/somnia/insights-app'
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
  plan: 'spark',
  credits: 7900,
  createdAt: '2026-10-29T00:00:00.000Z',
}

// Internally consistent with the spark rate ($30 / 10,000 cr = $0.003/credit):
// tiers charge 3,000 credits total -> tier revenue sums to $9.00, while the
// global revenue prices CONSUMED credits (3,000 - 100 refunded = 2,900) at
// $8.70 — the same deliberate distinction the backend makes.
const SNAPSHOT = {
  plan: 'spark',
  jobs: { total: 15, queued: 1, running: 1, moderated: 0, completed: 12, failed: 1 },
  ledger: { granted: 11000, spent: 3000, refunded: 100, balance: 7900 },
  economics: { revenueUsd: 8.7, providerCostUsd: 4.4, grossMarginPct: 49.4253 },
  tiers: [
    { provider: 'fal', model: 'pulse-3', resolution: '720p', jobs: 8, credits: 1600, costUsd: 0.8, revenueUsd: 4.8, marginPct: 83.3333, avgCostUsdPerJob: 0.1 },
    { provider: 'demo', model: 'pulse-flash', resolution: '480p', jobs: 4, credits: 800, costUsd: 0, revenueUsd: 2.4, marginPct: 100, avgCostUsdPerJob: 0 },
    { provider: 'selfhosted', model: 'wan2.2-t2v-5b', resolution: '1080p', jobs: 3, credits: 600, costUsd: 3.6, revenueUsd: 1.8, marginPct: -100, avgCostUsdPerJob: 1.2 },
  ],
  generatedAt: '2026-10-29T12:00:00.000Z',
}

const TRIAL_SNAPSHOT = {
  plan: 'trial',
  jobs: { total: 2, queued: 0, running: 0, moderated: 0, completed: 2, failed: 0 },
  ledger: { granted: 1000, spent: 200, refunded: 0, balance: 800 },
  economics: { revenueUsd: 0, providerCostUsd: 0.16, grossMarginPct: 0 },
  tiers: [
    { provider: 'fal', model: 'pulse-3', resolution: '720p', jobs: 2, credits: 200, costUsd: 0.16, revenueUsd: 0, marginPct: 0, avgCostUsdPerJob: 0.08 },
  ],
  generatedAt: '2026-10-29T12:00:00.000Z',
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

function insightsCalls() {
  return fetchMock().mock.calls.filter(([u]) => String(u) === '/api/insights').length
}

describe('InsightsApp', () => {
  it('signed out: invites sign-in without API calls', () => {
    render(<InsightsApp user={null} />)

    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/signin')
    expect(fetch).toHaveBeenCalledTimes(0)
  })

  it('shows a skeleton while the snapshot loads', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    const { container } = render(<InsightsApp user={USER} />)

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })

  it('renders the margin lens honestly: totals, ledger, economics, tier table — one GET, no NaN', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, SNAPSHOT)))
    render(<InsightsApp user={USER} />)

    // ---- KPI cards
    expect(await screen.findByText(/^15$/)).toBeInTheDocument()
    expect(screen.getByText(/12 completed · 1 failed/)).toBeInTheDocument()
    expect(screen.getByText(/\$8\.70/)).toBeInTheDocument()
    expect(screen.getByText(/\$4\.40/)).toBeInTheDocument()
    expect(screen.getByText(/49\.4%/)).toBeInTheDocument()

    // provider cost is honest about failures still costing the operator
    expect(screen.getByText(/failures included/i)).toBeInTheDocument()

    // ---- ledger flow
    expect(screen.getByText(/11,000/)).toBeInTheDocument()
    expect(screen.getByText(/3,000/)).toBeInTheDocument()
    expect(screen.getByText(/^100$/)).toBeInTheDocument()
    expect(screen.getByText(/7,900/)).toBeInTheDocument()

    // ---- plan chip + snapshot time
    expect(screen.getByText(/spark plan/i)).toBeInTheDocument()
    expect(screen.getByText(/2026-10-29 12:00 UTC/)).toBeInTheDocument()

    // ---- tier table
    expect(screen.getByText('Provider')).toBeInTheDocument()
    expect(screen.getByText('Resolution')).toBeInTheDocument()
    expect(screen.getByText('Avg cost')).toBeInTheDocument()
    expect(screen.getByText('fal')).toBeInTheDocument()
    expect(screen.getByText('demo')).toBeInTheDocument()
    expect(screen.getByText('wan2.2-t2v-5b')).toBeInTheDocument()
    expect(screen.getByText('1080p')).toBeInTheDocument()
    expect(screen.getByText(/\$4\.80/)).toBeInTheDocument()
    expect(screen.getByText('83.3%')).toBeInTheDocument()
    expect(screen.getByText(/\$0\.10/)).toBeInTheDocument()

    // demo tiers are free — cost and avg cost both $0.00
    expect(screen.getAllByText('$0.00').length).toBe(2)

    // negative margins are marked, not hidden
    const negative = screen.getByText('-100%')
    expect(negative).toBeInTheDocument()
    expect(negative.closest('[data-margin]')).toHaveAttribute('data-margin', 'negative')

    // never a NaN anywhere in the lens
    expect(screen.queryByText(/NaN/i)).not.toBeInTheDocument()

    // exactly one GET on mount — the lens does not poll
    expect(insightsCalls()).toBe(1)
  })

  it('zero-revenue snapshot renders 0% margin with an honest empty note (trial)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, TRIAL_SNAPSHOT)))
    render(<InsightsApp user={USER} />)

    expect(await screen.findByText(/trial plan/i)).toBeInTheDocument()
    // both the margin card and the single tier row honestly render 0%
    expect(screen.getAllByText(/^0%$/).length).toBe(2)
    expect(screen.getByText(/no revenue yet/i)).toBeInTheDocument()
    expect(screen.queryByText(/NaN/i)).not.toBeInTheDocument()
  })

  it('refreshes on demand: re-fetches /api/insights and shows the new totals', async () => {
    let refreshed = false
    fetchMock().mockImplementation(async () =>
      jsonResponse(
        200,
        refreshed
          ? { ...SNAPSHOT, jobs: { ...SNAPSHOT.jobs, total: 16, completed: 13 } }
          : SNAPSHOT
      )
    )
    render(<InsightsApp user={USER} />)

    await screen.findByText(/^15$/)
    refreshed = true
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))

    expect(await screen.findByText(/^16$/)).toBeInTheDocument()
    expect(screen.getByText(/13 completed · 1 failed/)).toBeInTheDocument()
    expect(insightsCalls()).toBe(2)
  })

  it('surfaces a load error with a working retry', async () => {
    let broken = true
    fetchMock().mockImplementation(async () =>
      broken ? jsonResponse(500, { error: 'internal' }) : jsonResponse(200, SNAPSHOT)
    )
    render(<InsightsApp user={USER} />)

    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument()
    broken = false
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))

    await waitFor(() => expect(screen.getByText(/\$8\.70/)).toBeInTheDocument())
    expect(insightsCalls()).toBe(2)
  })
})
