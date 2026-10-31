// tests/models.test.ts — T19 per-model render profiles.
//
// The profiles are the single source of truth for storyboard density and
// motion depth per model; the E2B gateway (scripts/e2b/gateway.mjs)
// mirrors this table, so any change here must be mirrored there.
import { describe, it, expect } from 'vitest'
import { renderProfileFor, beatCountFor, DEFAULT_RENDER_PROFILE } from '@/lib/models'

describe('models — render profiles', () => {
  it('gives pulse-3 the premium profile: deeper travel, denser storyboard', () => {
    const profile = renderProfileFor('pulse-3')
    expect(profile.kenBurnsMaxZoom).toBe(1.18)
    expect(profile.crfDelta).toBe(0)
    expect(beatCountFor('pulse-3', 5)).toBe(4)
    expect(beatCountFor('pulse-3', 10)).toBe(5)
  })

  it('gives pulse-flash the fast profile: tight travel, lean storyboard, coarser encode', () => {
    const profile = renderProfileFor('pulse-flash')
    expect(profile.kenBurnsMaxZoom).toBe(1.06)
    expect(profile.crfDelta).toBe(2)
    expect(beatCountFor('pulse-flash', 5)).toBe(2)
    expect(beatCountFor('pulse-flash', 10)).toBe(3)
  })

  it('premium renders deeper motion than flash', () => {
    expect(renderProfileFor('pulse-3').kenBurnsMaxZoom).toBeGreaterThan(
      renderProfileFor('pulse-flash').kenBurnsMaxZoom
    )
  })

  it('unknown and missing model ids keep the original constants (rotation back-compat)', () => {
    for (const model of [undefined, null, '', 'e2b-kenburns-cpu', 'prism', 'wan2.2-t2v-5b']) {
      expect(renderProfileFor(model as string | undefined)).toBe(DEFAULT_RENDER_PROFILE)
    }
    // The pre-T19 density split: 5s → 3 beats, 10s → 5 beats.
    expect(beatCountFor('e2b-kenburns-cpu', 5)).toBe(3)
    expect(beatCountFor('e2b-kenburns-cpu', 10)).toBe(5)
    expect(beatCountFor(undefined, 5)).toBe(3)
  })

  it('storyboard density is monotonic in duration for every profile', () => {
    for (const model of ['pulse-3', 'pulse-flash', 'e2b-kenburns-cpu']) {
      expect(beatCountFor(model, 10)).toBeGreaterThanOrEqual(beatCountFor(model, 5))
    }
  })
})
