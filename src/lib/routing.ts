// src/lib/routing.ts — multi-model routing across hosted + self-hosted
// tiers (T12).
//
// resolveVideoProvider() (providers/index.ts) picks ONE tier for every job.
// Real deployments want per-model routing: the cost-control tier (owned
// GPUs) serves the models it can, the hosted API covers the rest, and a
// tier outage fails over to the other REAL tier before the job fails.
//
// Policy decisions, deliberately:
//
//   - the route table is env-overridable (SOMNIA_MODEL_ROUTES JSON,
//     {"pulse-3":"selfhosted","pulse-flash":"fal"}) and re-read lazily on
//     every call — the same contract as every other env probe in the tree
//   - a route pinned to an UNCONFIGURED provider falls back to the
//     cost-control chain instead of failing the job
//   - failover only crosses REAL hosted tiers (selfhosted ↔ fal). It never
//     silently degrades a paid render to the local placeholder pipeline:
//     when every configured tier fails the job fails and refunds — the
//     customer is made whole, not handed simulated art
//   - the operator cost stamp follows the tier that ACTUALLY rendered
//     (the pipeline re-stamps on failover), so Insights margins stay honest

import { selfHostedProvider, falProvider } from '@/lib/providers'
import type { HostedVideoProvider } from '@/lib/providers/types'
import { VIDEO_MODELS } from '@/lib/plans'

/** Provider ids addressable from the route table. */
export type ProviderId = 'selfhosted' | 'fal' | 'demo'

const ROUTES_ENV = 'SOMNIA_MODEL_ROUTES'

/**
 * The per-model route table from SOMNIA_MODEL_ROUTES. Malformed JSON,
 * non-object shapes and unknown provider ids are skipped — routing is a
 * policy knob, never a crash vector.
 */
export function modelRoutes(): Record<string, ProviderId> {
  const raw = process.env[ROUTES_ENV]
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const out: Record<string, ProviderId> = {}
  for (const [model, provider] of Object.entries(parsed as Record<string, unknown>)) {
    if (provider === 'selfhosted' || provider === 'fal' || provider === 'demo') {
      out[model] = provider
    }
  }
  return out
}

/** The configured hosted tiers in cost-control order (selfhosted first). */
export function configuredChain(): HostedVideoProvider[] {
  const chain: HostedVideoProvider[] = []
  if (selfHostedProvider.configured) chain.push(selfHostedProvider)
  if (falProvider.configured) chain.push(falProvider)
  return chain
}

function byId(id: ProviderId): HostedVideoProvider | null {
  if (id === 'selfhosted') return selfHostedProvider.configured ? selfHostedProvider : null
  if (id === 'fal') return falProvider.configured ? falProvider : null
  return null // 'demo' is the local pipeline, not a hosted adapter
}

/**
 * The provider that should serve this model: the pinned route when it is
 * configured, else the head of the cost-control chain, else null (local
 * demo pipeline — the pre-T12 behavior byte-for-byte when no routes are
 * set and a single tier is configured).
 */
export function resolveVideoProviderForJob(model: string): HostedVideoProvider | null {
  const route = modelRoutes()[model]
  if (route) {
    const pinned = byId(route)
    if (pinned) return pinned
  }
  return configuredChain()[0] ?? null
}

/**
 * The render order for this job's model: the resolved provider first, then
 * the remaining configured tiers as failover candidates. Empty when no
 * hosted tier is configured (the local composite path).
 */
export function failoverOrder(model: string): HostedVideoProvider[] {
  const primary = resolveVideoProviderForJob(model)
  if (!primary) return []
  const rest = configuredChain().filter((p) => p.name !== primary.name)
  return [primary, ...rest]
}

/**
 * Effective routing for every shippable video model — the health surface:
 * which tier serves each model right now ('demo' = the local pipeline).
 * Pinned-but-unconfigured routes resolve to the chain fallback, matching
 * what the pipeline would actually do.
 */
export function effectiveRoutes(): Record<string, ProviderId> {
  const routes = modelRoutes()
  const chain = configuredChain()
  const out: Record<string, ProviderId> = {}
  for (const model of VIDEO_MODELS) {
    const pinned = routes[model] ? byId(routes[model]!) : null
    if (pinned) {
      out[model] = pinned.name
    } else if (chain.length > 0) {
      out[model] = chain[0]!.name
    } else {
      out[model] = 'demo'
    }
  }
  return out
}
