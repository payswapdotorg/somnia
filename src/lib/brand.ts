// src/lib/brand.ts — Somnia brand constants.
//
// Original identity for the clean-room build: every user-facing string and
// visual token funnels through here so the brand stays swappable and the
// provenance boundary (no reference-product names, logos or assets) is
// enforced in one place.

export const BRAND = {
  name: 'Somnia',
  tagline: 'Dream it. Render it.',
  description:
    'Somnia is an original clean-room AI video studio: prompt-to-clip with a 16-keyframe timeline, image mode, boards, an ideas feed and honest credit metering.',
  keywords: ['Somnia', 'AI video', 'keyframes', 'video studio', 'clean-room'],
} as const

/** Avatar gradient seeds (deterministic per user, original palette). */
export const AVATAR_SEEDS = [
  'aurora',
  'ember',
  'tide',
  'orchid',
  'comet',
  'frost',
  'dune',
  'grove',
] as const
