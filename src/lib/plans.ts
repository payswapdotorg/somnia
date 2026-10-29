// src/lib/plans.ts — Somnia pricing & plan matrix.
//
// Functional mirror of the reference product's credit economics under original
// names: three paid tiers on a 10k/40k/150k monthly credit ladder ($30/$90/$300)
// plus a one-time trial grant; per-clip costs keyed by model x resolution x
// duration with a 3x 10s multiplier and a 2x HDR multiplier; free loops;
// modify priced at 5x base; extend at the plain 5s base; flat fees for
// reframe / 4K upscale / image generation. Failed generations refund in full.

export type PlanId = 'trial' | 'spark' | 'studio' | 'infinite'
export type ModelId = 'pulse-3' | 'pulse-flash' | 'prism'
export type Resolution = '540p' | '720p' | '1080p'
export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9' | '9:21'

export const ASPECT_RATIOS: AspectRatio[] = [
  '16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21',
]
export const RESOLUTIONS: Resolution[] = ['540p', '720p', '1080p']
export const DURATIONS = [5, 10] as const
export const VIDEO_MODELS: ModelId[] = ['pulse-3', 'pulse-flash']
export const MAX_KEYFRAMES = 16

export interface GenerateParams {
  model: ModelId | string
  resolution: Resolution | string
  durationSec: number
  hdr?: boolean
  loop?: boolean
}

export interface PlanSpec {
  id: PlanId
  label: string
  priceUsd: number
  monthlyCredits: number // 0 = trial (one-time grant, never expires)
  agentMultiplier: number
  /** Max simultaneous variations an agent run may dispatch. */
  agentVariationCap: number
  features: string[]
}

export const PLANS: Record<PlanId, PlanSpec> = {
  trial: {
    id: 'trial',
    label: 'Trial',
    priceUsd: 0,
    monthlyCredits: 0,
    agentMultiplier: 1,
    agentVariationCap: 2,
    features: ['1,000 one-time credits', 'Full create suite', 'Ideas feed & boards', 'Agent runs'],
  },
  spark: {
    id: 'spark',
    label: 'Spark',
    priceUsd: 30,
    monthlyCredits: 10_000,
    agentMultiplier: 1,
    agentVariationCap: 2,
    features: [
      '10,000 credits / month',
      'Pulse 3 + Pulse Flash models',
      'Prism image generation',
      'Commercial use',
      'Agent runs (1x usage)',
    ],
  },
  studio: {
    id: 'studio',
    label: 'Studio',
    priceUsd: 90,
    monthlyCredits: 40_000,
    agentMultiplier: 4,
    agentVariationCap: 4,
    features: [
      '40,000 credits / month',
      'Everything in Spark',
      'Agent runs (4x usage)',
      'Priority queue',
      'API access',
    ],
  },
  infinite: {
    id: 'infinite',
    label: 'Infinite',
    priceUsd: 300,
    monthlyCredits: 150_000,
    agentMultiplier: 15,
    agentVariationCap: 6,
    features: [
      '150,000 credits / month',
      'Everything in Studio',
      'Agent runs (15x usage)',
      'Fastest queue',
      'API access',
    ],
  },
}

const TRIAL_CREDITS = 1_000
const DEFAULT_PLAN: PlanId = 'trial'

export function planCredits(plan: string): number {
  const spec = PLANS[plan as PlanId] ?? PLANS[DEFAULT_PLAN]
  return spec.id === 'trial' ? TRIAL_CREDITS : spec.monthlyCredits
}

export function planPriceUsd(plan: string): number {
  return (PLANS[plan as PlanId] ?? PLANS[DEFAULT_PLAN]).priceUsd
}

export function planAgentMultiplier(plan: string): number {
  return (PLANS[plan as PlanId] ?? PLANS[DEFAULT_PLAN]).agentMultiplier
}

export function agentVariationCap(plan: string): number {
  return (PLANS[plan as PlanId] ?? PLANS[DEFAULT_PLAN]).agentVariationCap
}

export { TRIAL_CREDITS }

/** 5s base cost by model x resolution (credits). */
const BASE_5S: Record<string, Record<string, number>> = {
  'pulse-3': { '540p': 60, '720p': 100, '1080p': 400 },
  'pulse-flash': { '540p': 25, '720p': 40, '1080p': 160 },
}

/** Duration multiplier: 10s clips cost 3x the 5s base (flagship ratio). */
const DURATION_MULT: Record<number, number> = { 5: 1, 10: 3 }
const HDR_MULT = 2
const MODIFY_MULT = 5

function requireBase5s(model: string, resolution: string): number {
  const row = BASE_5S[model]
  if (!row) throw new Error(`unknown model: ${model}`)
  const cost = row[resolution]
  if (!cost) throw new Error(`unknown resolution: ${resolution}`)
  return cost
}

export function clipCost(params: GenerateParams): number {
  const mult = DURATION_MULT[params.durationSec]
  if (!mult) throw new Error(`unsupported duration: ${params.durationSec}s`)
  let cost = requireBase5s(params.model, params.resolution) * mult
  if (params.hdr) cost *= HDR_MULT
  // loops are rendered at no surcharge
  return cost
}

export function modifyCost(model: string, resolution: string): number {
  return requireBase5s(model, resolution) * MODIFY_MULT
}

export function extendCost(model: string, resolution: string): number {
  return requireBase5s(model, resolution)
}

export function reframeCost(): number {
  return 10
}

export function upscaleCost(): number {
  return 200
}

export function imageCost(): number {
  return 20
}

export interface CostPreview {
  credits: number
  breakdown: string
  currency: 'credits'
}

export function costPreview(params: GenerateParams): CostPreview {
  const credits = clipCost(params)
  const bits: string[] = [String(params.resolution), `${params.durationSec}s`]
  if (params.hdr) bits.push('HDR')
  if (params.loop) bits.push('loop')
  return { credits, breakdown: bits.join(' · '), currency: 'credits' }
}
