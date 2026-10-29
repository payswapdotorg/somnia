// Reelforge Phase 9 — model lineup directory metadata (N1).
//
// The honest "model lineup" of this build is its engine tiers and editing
// tools: every card below maps to a real, shipped capability with its actual
// credit rate and provider reference cost, sourced from lib/pricing.ts.
// The /models surface renders this module; deep links land on the composer
// (create-app) with the recipe preselected, mirroring the model-directory
// grammar of multi-model platforms while keeping Reelforge's original brand.

import {
  ASPECT_RATIOS,
  DURATIONS,
  IMAGE_CREDITS,
  IMAGE_PROVIDER_COST_USD,
  PROVIDER_COST_PER_5S_USD,
  CREDITS_PER_SEC,
  CAMERA_CREDITS,
  REFRAME_CREDITS,
  type Tier,
} from '@/lib/pricing'

export type ModelGroup = 'video' | 'image' | 'agent' | 'editing'

export interface ModelCard {
  /** Stable id used in deep links (/ ?mode=video&tier=draft). */
  id: string
  /** Display name of the engine. */
  name: string
  /** One-line identity blurb. */
  blurb: string
  /** Directory group the card belongs to. */
  group: ModelGroup
  /** Recipe this card preselects on the composer. */
  recipe: {
    mode: 'video' | 'image' | 'agent'
    tier?: Tier
  }
  /** Optional badge (e.g. 'Popular', 'New'). */
  badge?: string
  /** Capability chips (durations, aspect ratios, resolution…). */
  capabilities: string[]
  /** Human credit economics line, e.g. '10 cr / s'. */
  creditLine: string
  /** Reference provider cost line, e.g. '$0.08 / 5s'. */
  costLine: string
  /** Where the engine runs (honest provider story). */
  engineNote: string
}

const ENGINE_NOTE_LOCAL = 'Local ffmpeg render pipeline — keyframes, Ken Burns motion, crossfades'

export const MODEL_CARDS: ModelCard[] = [
  {
    id: 'video-draft',
    name: 'Draft Engine',
    blurb: 'Fast storyboard pass — three keyframes composited into a motion study.',
    group: 'video',
    recipe: { mode: 'video', tier: 'draft' },
    badge: 'Popular',
    capabilities: ['5–15 s clips', '16:9 / 9:16 / 1:1', '3 keyframes + crossfades'],
    creditLine: `${CREDITS_PER_SEC.draft} cr / second`,
    costLine: `$${PROVIDER_COST_PER_5S_USD.draft.toFixed(2)} / 5 s`,
    engineNote: ENGINE_NOTE_LOCAL,
  },
  {
    id: 'video-quality',
    name: 'Quality Engine',
    blurb: 'Richer keyframes and longer blends for closer-to-final looks.',
    group: 'video',
    recipe: { mode: 'video', tier: 'quality' },
    badge: 'New',
    capabilities: ['5–15 s clips', '16:9 / 9:16 / 1:1', '5 keyframes + graded blend'],
    creditLine: `${CREDITS_PER_SEC.quality} cr / second`,
    costLine: `$${PROVIDER_COST_PER_5S_USD.quality.toFixed(2)} / 5 s`,
    engineNote: 'Provider-backed keyframes (fal.ai or self-hosted) + local render',
  },
  {
    id: 'image-draft',
    name: 'Draft Image Forge',
    blurb: 'One striking still, quick pass for moodboards and thumbnails.',
    group: 'image',
    recipe: { mode: 'image', tier: 'draft' },
    capabilities: ['Single still', '16:9 / 9:16 / 1:1', 'PNG delivery'],
    creditLine: `${IMAGE_CREDITS.draft} cr / still`,
    costLine: `$${IMAGE_PROVIDER_COST_USD.draft.toFixed(2)} / still`,
    engineNote: 'Server-side image SDK with branded placeholder fallback',
  },
  {
    id: 'image-quality',
    name: 'Quality Image Forge',
    blurb: 'Higher-detail still with richer lighting and composition.',
    group: 'image',
    recipe: { mode: 'image', tier: 'quality' },
    capabilities: ['Single still', '16:9 / 9:16 / 1:1', 'PNG delivery'],
    creditLine: `${IMAGE_CREDITS.quality} cr / still`,
    costLine: `$${IMAGE_PROVIDER_COST_USD.quality.toFixed(2)} / still`,
    engineNote: 'Server-side image SDK with branded placeholder fallback',
  },
  {
    id: 'forge-agent',
    name: 'Forge Agent',
    blurb: 'Chat your way to the shot — the agent proposes launchable recipes.',
    group: 'agent',
    recipe: { mode: 'agent' },
    badge: 'New',
    capabilities: ['Chat to create', 'Structured recipes', 'One-tap handoff'],
    creditLine: 'Chat free — generation billed per engine',
    costLine: 'See engine rates',
    engineNote: 'Server-side chat model + the same generation pipeline',
  },
  {
    id: 'tool-reframe',
    name: 'Reframe',
    blurb: 'Re-crop any finished clip to a new aspect ratio.',
    group: 'editing',
    recipe: { mode: 'video', tier: 'draft' },
    capabilities: ['16:9 / 9:16 / 1:1', 'Flat-rate edit', 'Studio panel'],
    creditLine: `${REFRAME_CREDITS} cr / clip`,
    costLine: 'Local only — $0',
    engineNote: ENGINE_NOTE_LOCAL,
  },
  {
    id: 'tool-camera',
    name: 'Camera Moves',
    blurb: 'Push in, pull back or drift — motion presets on existing clips.',
    group: 'editing',
    recipe: { mode: 'video', tier: 'draft' },
    capabilities: ['4 presets', 'Flat-rate edit', 'Studio panel'],
    creditLine: `${CAMERA_CREDITS} cr / clip`,
    costLine: 'Local only — $0',
    engineNote: ENGINE_NOTE_LOCAL,
  },
]

export const MODEL_GROUP_META: Record<
  ModelGroup,
  { label: string; blurb: string }
> = {
  video: { label: 'Video engines', blurb: 'Prompt to clip — pick your render tier' },
  image: { label: 'Image engines', blurb: 'Prompt to still — flat-rate forgeries' },
  agent: { label: 'Agent', blurb: 'Conversational creation' },
  editing: { label: 'Editing tools', blurb: 'Flat-credit clip transforms' },
}

/** Cost-at-a-glance comparison table rows (video tiers by duration). */
export const VIDEO_COST_TABLE: Array<{
  tier: Tier
  label: string
  seconds: number
  credits: number
  providerUsd: number
}> = DURATIONS.flatMap((seconds) =>
  (['draft', 'quality'] as const).map((tier) => ({
    tier,
    label: tier === 'draft' ? 'Draft' : 'Quality',
    seconds,
    credits: CREDITS_PER_SEC[tier] * seconds,
    providerUsd: (PROVIDER_COST_PER_5S_USD[tier] / 5) * seconds,
  }))
)

/** Aspect ratio support is uniform today — exported for the capability note. */
export const MODEL_ASPECT_NOTE = `All engines render ${ASPECT_RATIOS.join(' / ')}`
