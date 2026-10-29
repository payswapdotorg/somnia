// Reelforge pricing — pure module shared by server and client.
// Credit rates: draft = 10 credits/second, quality = 40 credits/second.
// Provider reference cost: draft = $0.08 per 5s (pro-rated), quality = $0.40 per 5s.

export const TIERS = ['draft', 'quality'] as const
export type Tier = (typeof TIERS)[number]

export const ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const
export type AspectRatio = (typeof ASPECT_RATIOS)[number]

export const DURATIONS = [5, 8, 10, 15] as const
export type DurationSec = (typeof DURATIONS)[number]

export const CREDITS_PER_SEC: Record<Tier, number> = {
  draft: 10,
  quality: 40,
}

export const PROVIDER_COST_PER_5S_USD: Record<Tier, number> = {
  draft: 0.08,
  quality: 0.4,
}

export const DEFAULT_CREDITS = 500
export const DEMO_USER_ID = 'demo'

// Phase 9 (N6): daily free refill — appended once per UTC calendar day the
// first time the balance is read. Play-money counterpart of the daily-login
// credit drops common on multi-model platforms.
export const DAILY_GRANT_CREDITS = 20

// Phase 3 flat-rate clip transforms (no provider call — local ffmpeg only).
export const REFRAME_CREDITS = 10
export const CAMERA_CREDITS = 15

// Phase 11 (N5): restyle — video-to-video grade re-render (local ffmpeg only).
export const RESTYLE_CREDITS = 12

// Phase 8: image mode — one still, flat rate per tier (no duration math).
export const IMAGE_CREDITS: Record<Tier, number> = {
  draft: 12,
  quality: 24,
}

export const IMAGE_PROVIDER_COST_USD: Record<Tier, number> = {
  draft: 0.03,
  quality: 0.06,
}

export function imageCreditCost(tier: Tier): number {
  return IMAGE_CREDITS[tier]
}

export function imageProviderCostUsd(tier: Tier): number {
  return IMAGE_PROVIDER_COST_USD[tier]
}

export function creditCost(tier: Tier, durationSec: number): number {
  return CREDITS_PER_SEC[tier] * durationSec
}

export function providerCostUsd(tier: Tier, durationSec: number): number {
  return round2((PROVIDER_COST_PER_5S_USD[tier] / 5) * durationSec)
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export const TIER_META: Record<
  Tier,
  { label: string; blurb: string; rate: number; cost: string }
> = {
  draft: {
    label: 'Draft',
    blurb: 'Fast storyboard pass for ideation',
    rate: CREDITS_PER_SEC.draft,
    cost: '$0.08 / 5s',
  },
  quality: {
    label: 'Quality',
    blurb: 'Richer keyframes for closer-to-final looks',
    rate: CREDITS_PER_SEC.quality,
    cost: '$0.40 / 5s',
  },
}
