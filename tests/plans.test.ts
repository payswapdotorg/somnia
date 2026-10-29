// tests/plans.test.ts — TDD RED first.
// Somnia pricing matrix: functional mirror of the Luma plan/credit structure
// (Plus/Pro/Ultra pools, per-clip credit costs by resolution and duration,
// HDR multiplier, refund-on-failure policy) under original names.
import { describe, expect, it } from 'vitest'
import {
  PLANS,
  clipCost,
  costPreview,
  modifyCost,
  extendCost,
  reframeCost,
  upscaleCost,
  imageCost,
  agentVariationCap,
  planCredits,
  planPriceUsd,
  planAgentMultiplier,
  type GenerateParams,
} from '@/lib/plans'

describe('plans — subscription tiers', () => {
  it('exposes four tiers with Luma-shaped pools (trial/one-time + 3 paid)', () => {
    expect(Object.keys(PLANS)).toEqual(['trial', 'spark', 'studio', 'infinite'])
  })

  it('paid pools match the 10k / 40k / 150k ladder', () => {
    expect(planCredits('spark')).toBe(10_000)
    expect(planCredits('studio')).toBe(40_000)
    expect(planCredits('infinite')).toBe(150_000)
  })

  it('prices map to the $30 / $90 / $300 monthly ladder', () => {
    expect(planPriceUsd('spark')).toBe(30)
    expect(planPriceUsd('studio')).toBe(90)
    expect(planPriceUsd('infinite')).toBe(300)
    expect(planPriceUsd('trial')).toBe(0)
  })

  it('agent usage multipliers are 1x / 4x / 15x (paid tiers)', () => {
    expect(planAgentMultiplier('trial')).toBe(1)
    expect(planAgentMultiplier('spark')).toBe(1)
    expect(planAgentMultiplier('studio')).toBe(4)
    expect(planAgentMultiplier('infinite')).toBe(15)
  })

  it('caps simultaneous agent variations by plan multiplier', () => {
    expect(agentVariationCap('spark')).toBe(2)
    expect(agentVariationCap('studio')).toBe(4)
    expect(agentVariationCap('infinite')).toBe(6)
  })

  it('unknown plan falls back to trial', () => {
    expect(planCredits('nope' as never)).toBe(1_000)
  })
})

describe('plans — video clip costs (credits)', () => {
  const base = (model: string, res: string, sec: number) =>
    clipCost({ model, resolution: res, durationSec: sec } as GenerateParams)

  it('flagship 5s: 60 / 100 / 400 credits by 540p / 720p / 1080p', () => {
    expect(base('pulse-3', '540p', 5)).toBe(60)
    expect(base('pulse-3', '720p', 5)).toBe(100)
    expect(base('pulse-3', '1080p', 5)).toBe(400)
  })

  it('flagship 10s costs 3x the 5s clip (Luma ratio)', () => {
    expect(base('pulse-3', '720p', 10)).toBe(300)
    expect(base('pulse-3', '1080p', 10)).toBe(1_200)
  })

  it('flash model is the economical tier (uniform 3x for 10s)', () => {
    expect(base('pulse-flash', '720p', 5)).toBe(40)
    expect(base('pulse-flash', '540p', 5)).toBe(25)
    expect(base('pulse-flash', '1080p', 5)).toBe(160)
    expect(base('pulse-flash', '720p', 10)).toBe(120)
  })

  it('HDR doubles the clip cost (Luma HDR 2x rule)', () => {
    expect(
      clipCost({ model: 'pulse-3', resolution: '720p', durationSec: 5, hdr: true } as GenerateParams)
    ).toBe(200)
    expect(
      clipCost({ model: 'pulse-flash', resolution: '720p', durationSec: 5, hdr: true } as GenerateParams)
    ).toBe(80)
  })

  it('loops carry no surcharge', () => {
    const noLoop = clipCost({ model: 'pulse-3', resolution: '720p', durationSec: 5 } as GenerateParams)
    const loop = clipCost({
      model: 'pulse-3', resolution: '720p', durationSec: 5, loop: true,
    } as GenerateParams)
    expect(loop).toBe(noLoop)
  })

  it('rejects unknown model / resolution / duration combos', () => {
    expect(() => base('pulse-99', '720p', 5)).toThrow()
    expect(() => base('pulse-3', '4k', 5)).toThrow()
    expect(() => base('pulse-3', '720p', 7)).toThrow()
  })
})

describe('plans — transform & image costs', () => {
  it('modify (video-to-video) costs 5x the 5s base of the chosen model at 720p', () => {
    expect(modifyCost('pulse-3', '720p')).toBe(500)
    expect(modifyCost('pulse-flash', '720p')).toBe(200)
  })

  it('extend charges the plain 5s base (no 10s multiplier, no HDR carry)', () => {
    expect(extendCost('pulse-3', '720p')).toBe(100)
    expect(extendCost('pulse-flash', '540p')).toBe(25)
  })

  it('reframe is a flat 10 credits', () => {
    expect(reframeCost()).toBe(10)
  })

  it('4K upscale is a flat 200 credits', () => {
    expect(upscaleCost()).toBe(200)
  })

  it('image generation (Prism) is a flat 20 credits', () => {
    expect(imageCost()).toBe(20)
  })
})

describe('plans — composer cost preview', () => {
  it('returns the exact shape the composer renders', () => {
    const preview = costPreview({
      model: 'pulse-3',
      resolution: '720p',
      durationSec: 5,
      hdr: false,
      loop: true,
    } as GenerateParams)
    expect(preview).toEqual({
      credits: 100,
      breakdown: expect.stringContaining('720p'),
      currency: 'credits',
    })
  })

  it('preview mentions HDR and loop when set', () => {
    const preview = costPreview({
      model: 'pulse-3', resolution: '540p', durationSec: 5, hdr: true, loop: true,
    } as GenerateParams)
    expect(preview.credits).toBe(120)
    expect(preview.breakdown).toContain('HDR')
    expect(preview.breakdown).toContain('loop')
  })
})
