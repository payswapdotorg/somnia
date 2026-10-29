// tests/economics.test.ts — hosted provider economics (T7).
//
// The per-model provider cost model that makes the margin lens work on
// hosted tiers: demo renders are free (local compositing), selfhosted and
// fal carry per-(model x resolution) 5s cost estimates, provider cost
// scales with render time (10s = 2x) — NOT the 3x retail multiplier — HDR
// adds compute (1.5x), prism stills are flat per-image, and operators can
// pin actual pricing via the SOMNIA_PROVIDER_COSTS JSON env override
// without a code change. usdPerCredit derives the revenue proxy from the
// real plan ladder.
import { describe, it, expect, afterEach } from 'vitest'
import {
  providerCostUsd,
  usdPerCredit,
  DEFAULT_PROVIDER_COSTS,
} from '@/lib/economics'

const ENV_KEYS = ['SOMNIA_PROVIDER_COSTS']

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key]
})

// ------------------------------------------------------------ demo is free

describe('providerCostUsd — demo tier', () => {
  it('costs nothing for every model, resolution, duration and HDR', () => {
    for (const model of ['pulse-3', 'pulse-flash']) {
      for (const resolution of ['540p', '720p', '1080p']) {
        for (const durationSec of [5, 10]) {
          expect(
            providerCostUsd({ provider: 'demo', kind: 'video', model, resolution, durationSec })
          ).toBe(0)
        }
      }
    }
    expect(providerCostUsd({ provider: 'demo', kind: 'image', model: 'prism', resolution: '720p', durationSec: 0 })).toBe(0)
  })
})

// -------------------------------------------------------------- video tiers

describe('providerCostUsd — hosted video tiers', () => {
  it('selfhosted and fal carry distinct per-model 5s base costs', () => {
    const self = providerCostUsd({
      provider: 'selfhosted', kind: 'video', model: 'pulse-3', resolution: '720p', durationSec: 5,
    })
    const fal = providerCostUsd({
      provider: 'fal', kind: 'video', model: 'pulse-3', resolution: '720p', durationSec: 5,
    })
    expect(self).toBeGreaterThan(0)
    expect(fal).toBeGreaterThan(0)
    // hosted API carries a premium over owned GPUs for the same render
    expect(fal).toBeGreaterThan(self)
  })

  it('scales with resolution within one model', () => {
    const c540 = providerCostUsd({ provider: 'fal', kind: 'video', model: 'pulse-3', resolution: '540p', durationSec: 5 })
    const c720 = providerCostUsd({ provider: 'fal', kind: 'video', model: 'pulse-3', resolution: '720p', durationSec: 5 })
    const c1080 = providerCostUsd({ provider: 'fal', kind: 'video', model: 'pulse-3', resolution: '1080p', durationSec: 5 })
    expect(c540).toBeLessThan(c720)
    expect(c720).toBeLessThan(c1080)
  })

  it('pulse-flash is cheaper than pulse-3 at every resolution', () => {
    for (const resolution of ['540p', '720p', '1080p']) {
      const flash = providerCostUsd({ provider: 'fal', kind: 'video', model: 'pulse-flash', resolution, durationSec: 5 })
      const flagship = providerCostUsd({ provider: 'fal', kind: 'video', model: 'pulse-3', resolution, durationSec: 5 })
      expect(flash).toBeLessThan(flagship)
    }
  })

  it('doubles for 10s renders (render time, not the 3x retail multiplier)', () => {
    const base = providerCostUsd({ provider: 'selfhosted', kind: 'video', model: 'pulse-3', resolution: '720p', durationSec: 5 })
    expect(providerCostUsd({ provider: 'selfhosted', kind: 'video', model: 'pulse-3', resolution: '720p', durationSec: 10 })).toBeCloseTo(base * 2, 6)
  })

  it('adds 1.5x compute for HDR', () => {
    const base = providerCostUsd({ provider: 'fal', kind: 'video', model: 'pulse-3', resolution: '720p', durationSec: 5 })
    expect(providerCostUsd({ provider: 'fal', kind: 'video', model: 'pulse-3', resolution: '720p', durationSec: 5, hdr: true })).toBeCloseTo(base * 1.5, 6)
  })

  it('does not surcharge loops', () => {
    const base = providerCostUsd({ provider: 'fal', kind: 'video', model: 'pulse-flash', resolution: '540p', durationSec: 5 })
    expect(providerCostUsd({ provider: 'fal', kind: 'video', model: 'pulse-flash', resolution: '540p', durationSec: 5, loop: true })).toBe(base)
  })
})

// -------------------------------------------------------------- prism stills

describe('providerCostUsd — prism image stills', () => {
  it('is a flat per-image cost on hosted tiers and free on demo', () => {
    const fal = providerCostUsd({ provider: 'fal', kind: 'image', model: 'prism', resolution: '720p', durationSec: 0 })
    const self = providerCostUsd({ provider: 'selfhosted', kind: 'image', model: 'prism', resolution: '720p', durationSec: 0 })
    expect(fal).toBeGreaterThan(0)
    expect(self).toBeGreaterThan(0)
    expect(fal).toBeLessThan(0.05) // sanity: a still is far cheaper than a clip
    expect(providerCostUsd({ provider: 'demo', kind: 'image', model: 'prism', resolution: '720p', durationSec: 0 })).toBe(0)
  })
})

// ------------------------------------------------------- unknown combos + env

describe('providerCostUsd — fallbacks and env overrides', () => {
  it('falls back to 0 for unknown provider/model/resolution combos (never blocks a render)', () => {
    expect(
      providerCostUsd({ provider: 'fal', kind: 'video', model: 'unknown-model', resolution: '720p', durationSec: 5 })
    ).toBe(0)
    expect(
      providerCostUsd({ provider: 'demo', kind: 'video', model: 'pulse-3', resolution: '4k', durationSec: 5 })
    ).toBe(0)
  })

  it('merges the SOMNIA_PROVIDER_COSTS JSON override over the built-in table', () => {
    process.env.SOMNIA_PROVIDER_COSTS = JSON.stringify({
      fal: { 'pulse-3': { '720p': 0.15 } },
    })
    expect(providerCostUsd({ provider: 'fal', kind: 'video', model: 'pulse-3', resolution: '720p', durationSec: 5 })).toBe(0.15)
    // untouched entries keep the built-in numbers
    expect(providerCostUsd({ provider: 'fal', kind: 'video', model: 'pulse-3', resolution: '540p', durationSec: 5 })).toBe(
      DEFAULT_PROVIDER_COSTS.fal['pulse-3']['540p']
    )
  })

  it('ignores a malformed SOMNIA_PROVIDER_COSTS override (built-ins stay)', () => {
    process.env.SOMNIA_PROVIDER_COSTS = '{not json'
    expect(providerCostUsd({ provider: 'fal', kind: 'video', model: 'pulse-3', resolution: '720p', durationSec: 5 })).toBe(
      DEFAULT_PROVIDER_COSTS.fal['pulse-3']['720p']
    )
  })
})

// ------------------------------------------------------------ revenue proxy

describe('usdPerCredit — revenue proxy from the plan ladder', () => {
  it('derives per-credit USD from each paid plan price', () => {
    expect(usdPerCredit('spark')).toBeCloseTo(30 / 10_000, 8)
    expect(usdPerCredit('studio')).toBeCloseTo(90 / 40_000, 8)
    expect(usdPerCredit('infinite')).toBeCloseTo(300 / 150_000, 8)
  })

  it('trial credits generate no revenue', () => {
    expect(usdPerCredit('trial')).toBe(0)
  })

  it('unknown plans fall back to the cheapest paid rate', () => {
    expect(usdPerCredit('nonsense')).toBe(usdPerCredit('spark'))
  })
})
