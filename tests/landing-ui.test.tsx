// tests/landing-ui.test.tsx — the signed-out marketing landing (T6c).
//
// Anonymous visitors to / see an original Somnia landing: hero with the
// brand tagline, a sign-in CTA, the public plan catalogue (GET /api/plans —
// the only network call) and honest graceful degradation when the catalogue
// is unreachable. No session endpoints are touched.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { LandingApp } from '@/components/somnia/landing'

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response
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
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, PLANS)))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function fetchMock() {
  return fetch as unknown as ReturnType<typeof vi.fn>
}

describe('LandingApp', () => {
  it('renders the hero: tagline, description, sign-in CTA and the ideas link', async () => {
    render(<LandingApp />)

    // the brand tagline leads the hero
    expect(screen.getByRole('heading', { level: 1, name: /dream it\. render it\./i })).toBeInTheDocument()

    // the primary CTA goes to the auth surface with the trial promise
    const cta = screen.getByRole('link', { name: /start dreaming/i })
    expect(cta).toHaveAttribute('href', '/signin')
    expect(screen.getByText(/1,000 credits/i)).toBeInTheDocument()

    // the secondary CTA routes to the public ideas feed
    expect(screen.getByRole('link', { name: /browse the ideas feed/i })).toHaveAttribute('href', '/explore')

    // the feature grid covers the six pillars (pillar cards are h3 headings,
    // distinct from the hero description paragraph)
    expect(screen.getByRole('heading', { name: 'Prompt to clip' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '16-keyframe timeline' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Prism stills' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Boards' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ideas feed & remix' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Honest credits' })).toBeInTheDocument()

    // plans were fetched (the only allowed network call)
    await waitFor(() => expect(fetchMock()).toHaveBeenCalledTimes(1))
    expect(fetchMock().mock.calls[0]![0]).toBe('/api/plans')
  })

  it('renders the public plan catalogue with prices and credit pools', async () => {
    render(<LandingApp />)

    expect(await screen.findByText(/^spark$/i)).toBeInTheDocument()
    expect(screen.getByText(/\$30\b/)).toBeInTheDocument()
    expect(screen.getByText(/\$90\b/)).toBeInTheDocument()
    expect(screen.getByText(/\$300\b/)).toBeInTheDocument()
    // credit pools render as plan-card <p> lines (feature bullets are <li>)
    expect(screen.getByText(/150,000 credits \/ month/i, { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText(/10,000 credits \/ month/i, { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText(/priority queue/i)).toBeInTheDocument()
  })

  it('degrades gracefully when the catalogue is unreachable — hero stays', async () => {
    fetchMock().mockImplementation(async () => jsonResponse(500, { error: 'boom' }))
    render(<LandingApp />)

    expect(screen.getByRole('heading', { level: 1, name: /dream it\. render it\./i })).toBeInTheDocument()
    expect(await screen.findByText(/catalogue could not be loaded/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /start dreaming/i })).toHaveAttribute('href', '/signin')
  })
})
