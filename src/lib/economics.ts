// src/lib/economics.ts — hosted provider economics (T7).
//
// The per-model cost side of the margin lens: what each render actually
// costs the operator, keyed by provider x model x resolution, so
// Job.providerCostUsd carries real numbers on hosted tiers (demo/local
// compositing is free). Retail credits and provider USD deliberately use
// DIFFERENT duration multipliers: retail prices 10s at 3x the 5s base
// (flagship value ladder), while provider spend scales with render time
// (~linear: 2x). HDR adds compute (1.5x); loops ride free.
//
// Numbers are clean-room planning estimates, not quotes. Operators pin
// actual pricing through SOMNIA_PROVIDER_COSTS (JSON, same shape as
// DEFAULT_PROVIDER_COSTS, merged at provider/model/resolution depth) —
// no code change required. Unknown combinations cost 0 rather than
// blocking a render.
//
// usdPerCredit derives the revenue proxy from the real plan ladder
// (price / monthly credits): trial credits generate no revenue.

import { PLANS, type PlanId } from '@/lib/plans'

export interface ProviderCostInput {
  /** 'demo' | 'fal' | 'selfhosted' (anything else resolves to 0). */
  provider: string
  /** 'video' | 'image'. */
  kind: string
  model: string
  resolution: string
  durationSec: number
  hdr?: boolean
  loop?: boolean
}

/** provider -> model -> cost-key -> USD. Cost key is the resolution for
 *  video models and the literal 'image' for prism stills. */
export type ProviderCostTable = Record<string, Record<string, number>>

/**
 * Built-in planning estimates (USD per 5s render / per still):
 *
 *   selfhosted — owned GPUs (~$0.60/hr class running open weights)
 *   fal        — hosted API premium over the same render
 *   demo       — local compositing, always free (empty table)
 */
export const DEFAULT_PROVIDER_COSTS: Record<string, ProviderCostTable> = {
  demo: {},
  selfhosted: {
    'pulse-3': { '540p': 0.04, '720p': 0.09, '1080p': 0.22 },
    'pulse-flash': { '540p': 0.02, '720p': 0.05, '1080p': 0.13 },
    prism: { image: 0.004 },
  },
  fal: {
    'pulse-3': { '540p': 0.06, '720p': 0.12, '1080p': 0.3 },
    'pulse-flash': { '540p': 0.03, '720p': 0.06, '1080p': 0.15 },
    prism: { image: 0.01 },
  },
}

const HDR_COST_MULT = 1.5
const ENV_KEY = 'SOMNIA_PROVIDER_COSTS'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Validated numeric entries only — junk in the override is skipped. */
function numericEntries(row: unknown): Record<string, number> {
  if (!isPlainObject(row)) return {}
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      out[key] = value
    }
  }
  return out
}

/** Deep-merge the env override over the built-ins (3 levels). */
function mergeCosts(override: unknown): Record<string, ProviderCostTable> {
  const merged: Record<string, ProviderCostTable> = {}
  for (const [provider, models] of Object.entries(DEFAULT_PROVIDER_COSTS)) {
    merged[provider] = { ...models }
  }
  if (!isPlainObject(override)) return merged
  for (const [provider, models] of Object.entries(override)) {
    const target: ProviderCostTable = merged[provider] ?? {}
    if (isPlainObject(models)) {
      for (const [model, row] of Object.entries(models)) {
        target[model] = { ...(target[model] ?? {}), ...numericEntries(row) }
      }
    }
    merged[provider] = target
  }
  return merged
}

/** Built-ins + SOMNIA_PROVIDER_COSTS override (malformed JSON ignored). */
function effectiveCosts(): Record<string, ProviderCostTable> {
  const raw = process.env[ENV_KEY]
  if (!raw) return DEFAULT_PROVIDER_COSTS
  try {
    return mergeCosts(JSON.parse(raw))
  } catch {
    return DEFAULT_PROVIDER_COSTS
  }
}

/** Render-time multiplier: ~linear in seconds (5s -> 1x, 10s -> 2x). */
function durationCostMult(kind: string, durationSec: number): number {
  if (kind === 'image' || durationSec <= 0) return 1
  if (durationSec <= 5) return 1
  return Math.ceil(durationSec / 5)
}

/**
 * Provider cost in USD for one render. Demo and unknown combinations are 0;
 * HDR multiplies video cost by 1.5; loops are never surcharged. Result is
 * rounded to 8 decimals to keep JSON payloads free of float dust.
 */
export function providerCostUsd(input: ProviderCostInput): number {
  if (input.provider === 'demo') return 0
  const table = effectiveCosts()[input.provider]
  if (!table) return 0
  const key = input.kind === 'image' ? 'image' : input.resolution
  const base = table[input.model]?.[key]
  if (typeof base !== 'number' || !Number.isFinite(base)) return 0

  let cost = base * durationCostMult(input.kind, input.durationSec)
  if (input.kind !== 'image' && input.hdr) cost *= HDR_COST_MULT
  return Math.round(cost * 1e8) / 1e8
}

/** Cheapest paid plan backs the fallback rate for unknown plan ids. */
const FALLBACK_RATE_PLAN: PlanId = 'spark'

/**
 * Revenue proxy: USD per credit derived from the plan ladder
 * (priceUsd / monthlyCredits). Trial credits are free -> 0.
 */
export function usdPerCredit(plan: string): number {
  const spec = PLANS[plan as PlanId]
  if (spec && spec.id === 'trial') return 0
  if (!spec || spec.monthlyCredits <= 0) {
    const fallback = PLANS[FALLBACK_RATE_PLAN]
    return fallback.priceUsd / fallback.monthlyCredits
  }
  return spec.priceUsd / spec.monthlyCredits
}
