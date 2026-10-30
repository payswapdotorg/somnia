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

/** The tier's still-render capability: imageCapable + a real renderStill. */
function isImageCapable(provider: HostedVideoProvider): boolean {
  return provider.imageCapable === true && typeof provider.renderStill === 'function'
}

/**
 * T16 — the configured tiers that can render IMAGE (prism) jobs, in
 * cost-control order. Hosted stills kill the last placeholder surface.
 */
export function configuredImageChain(): HostedVideoProvider[] {
  return configuredChain().filter(isImageCapable)
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
 * T16 — the render order for an IMAGE (prism) job: the image-capable tier
 * pinned by SOMNIA_MODEL_ROUTES when configured, else the head of the
 * image-capable chain. Empty → the local still path (placeholder-flagged on
 * serverless, exactly the pre-T16 behavior). Failover only crosses REAL
 * hosted image tiers; a routed-but-failing image job fails and refunds — it
 * never silently degrades to placeholder art.
 */
export function failoverImageOrder(): HostedVideoProvider[] {
  const pinned = modelRoutes()['prism']
  if (pinned) {
    const provider = byId(pinned)
    if (provider && isImageCapable(provider)) return [provider]
  }
  return configuredImageChain()
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

/**
 * T16 — effective routing for the IMAGE model (prism): 'selfhosted' when an
 * image-capable hosted tier is configured, else 'demo' (the local still
 * path). The pinned route wins only when its tier is BOTH configured and
 * image-capable — a prism→fal pin cannot serve stills and falls back.
 */
export function effectiveImageRoutes(): Record<string, ProviderId> {
  const chain = configuredImageChain()
  if (chain.length > 0) {
    return { prism: chain[0]!.name }
  }
  return { prism: 'demo' }
}
