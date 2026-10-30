// src/lib/tier-gateway.ts — T16 live-tier durability: the gateway endpoint
// lives in the DATABASE, not the env.
//
// WHY: the T15 live tier rotates its E2B sandbox hourly (Hobby session cap),
// and every rotation used to re-write SELFHOSTED_URL on the Vercel project
// and re-deploy — runtime env is baked per deployment. With the endpoint in
// a DB row, SELFHOSTED_URL points FOREVER at this app's own stable relay
// route (/api/tier/relay/*) and a rotation is UPDATE one row (via the ops
// route, admin-key guarded). Zero env rewrites, zero redeploys — and because
// the relay re-reads the row on every forwarded request, in-flight render
// polls switch to the fresh sandbox on their next read.
//
// Auth is two boundaries, deliberately:
//
//   adapter → relay    Bearer SELFHOSTED_API_KEY (env, STABLE across
//                      rotations — the relay-side secret)
//   relay   → gateway  Bearer TierGateway.apiKey (DB row, rotates with the
//                      sandbox; null = forward unauthenticated)
//
// So a gateway-key rotation never touches the Vercel env either.
//
// Endpoints (served through dispatchSomnia, not user-session auth):
//
//   ANY  /api/tier/relay/{v1|healthz}/…   → forwarded verbatim (GET/POST)
//   GET  /api/ops/gateway                 → masked singleton state
//   POST /api/ops/gateway                 → upsert {url, apiKey?, model?,
//                                            sandboxId?, notes?}
//   DELETE /api/ops/gateway               → row removed (tier down; renders
//                                            fail and refund honestly)
//
// /api/ops/gateway is guarded by TIER_OPS_KEY (env, constant-time compare).

import { createHash, timingSafeEqual } from 'node:crypto'

import { db } from '@/lib/db'

const SINGLETON_ID = 'singleton'

/** Env holding the relay-side secret (adapter → relay bearer). */
export const RELAY_KEY_ENV = 'SELFHOSTED_API_KEY'
/** Env holding the ops-route admin key (rotator → ops upsert). */
export const OPS_KEY_ENV = 'TIER_OPS_KEY'

/** Relay forwarding timeouts — submissions 202 fast, polls faster still. */
const RELAY_TIMEOUT_MS = process.env.SOMNIA_TEST ? 1_000 : 20_000
/** Gateway liveness probe bound for the health surface. */
const GATEWAY_PROBE_TIMEOUT_MS = 2_500

/** Path prefixes the relay will forward. Least privilege: the queue
 *  contract (/v1/*) plus the gateway liveness endpoint (/healthz). */
const ALLOWED_PREFIXES = ['/v1/', '/healthz']

export interface TierGatewayState {
  url: string
  apiKey: string | null
  model: string | null
  sandboxId: string | null
  notes: string | null
  updatedAt: Date
}

/** The singleton row, or null when no live gateway is registered. */
export async function getTierGateway(): Promise<TierGatewayState | null> {
  const row = await db.tierGateway.findUnique({ where: { id: SINGLETON_ID } })
  if (!row) return null
  return {
    url: row.url,
    apiKey: row.apiKey,
    model: row.model,
    sandboxId: row.sandboxId,
    notes: row.notes,
    updatedAt: row.updatedAt,
  }
}

export interface TierGatewayUpsertInput {
  url: unknown
  apiKey?: unknown
  model?: unknown
  sandboxId?: unknown
  notes?: unknown
}

function trimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Validated gateway base URL (http/https, trailing slashes stripped). */
function normalizeUrl(value: unknown): { ok: true; url: string } | { ok: false } {
  const raw = trimmedString(value)
  if (!raw) return { ok: false }
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false }
  return { ok: true, url: raw.replace(/\/+$/, '') }
}

/**
 * Upsert the singleton gateway row. Validation is strict on the URL (the
 * relay must never be aimable at a non-HTTP target) and lenient elsewhere —
 * apiKey/model/sandboxId/notes are optional display/provenance strings.
 */
export async function upsertTierGateway(
  input: TierGatewayUpsertInput
): Promise<TierGatewayState> {
  const normalized = normalizeUrl(input.url)
  if (!normalized.ok) {
    throw new Error('gateway url must be an absolute http(s) URL')
  }
  const row = await db.tierGateway.upsert({
    where: { id: SINGLETON_ID },
    update: {
      url: normalized.url,
      apiKey: trimmedString(input.apiKey),
      model: trimmedString(input.model),
      sandboxId: trimmedString(input.sandboxId),
      notes: trimmedString(input.notes),
    },
    create: {
      id: SINGLETON_ID,
      url: normalized.url,
      apiKey: trimmedString(input.apiKey),
      model: trimmedString(input.model),
      sandboxId: trimmedString(input.sandboxId),
      notes: trimmedString(input.notes),
    },
  })
  return {
    url: row.url,
    apiKey: row.apiKey,
    model: row.model,
    sandboxId: row.sandboxId,
    notes: row.notes,
    updatedAt: row.updatedAt,
  }
}

/** Remove the row — the tier is down; renders fail and refund honestly. */
export async function clearTierGateway(): Promise<boolean> {
  const removed = await db.tierGateway.deleteMany({ where: { id: SINGLETON_ID } })
  return removed.count > 0
}

/** The masked ops view — the apiKey VALUE is never returned (presence only). */
export interface TierGatewayOpsDto {
  configured: boolean
  url: string | null
  hasApiKey: boolean
  model: string | null
  sandboxId: string | null
  notes: string | null
  updatedAt: string | null
}

export function tierGatewayOpsDto(state: TierGatewayState | null): TierGatewayOpsDto {
  return {
    configured: !!state,
    url: state?.url ?? null,
    hasApiKey: !!state?.apiKey,
    model: state?.model ?? null,
    sandboxId: state?.sandboxId ?? null,
    notes: state?.notes ?? null,
    updatedAt: state?.updatedAt.toISOString() ?? null,
  }
}

// ---------------------------------------------------------------- auth

/** Constant-time bearer check against an env secret (digest-compared so the
 *  key length is never leaked either). Empty/absent env = nothing matches. */
function bearerMatches(authorization: string | null, secret: string | undefined): boolean {
  if (!authorization || !secret || secret.trim().length === 0) return false
  const presented = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (presented.length === 0) return false
  const a = createHash('sha256').update(presented).digest()
  const b = createHash('sha256').update(secret.trim()).digest()
  return timingSafeEqual(a, b)
}

// ---------------------------------------------------------------- relay

function jsonBody(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Forward one request to the live gateway. `segments` are the path parts
 * after /api/tier/relay (e.g. ['v1','video','jobs']). Contract:
 *
 *   401  missing/wrong relay bearer (SELFHOSTED_API_KEY)
 *   405  method other than GET/POST (the queue contract's verbs)
 *   404  path outside /v1/* or /healthz (least privilege)
 *   503  no gateway row registered — the tier is DOWN, honestly
 *   502  gateway unreachable (rotation gap, dead sandbox)
 *   2xx/4xx otherwise — the gateway's own status, body and content-type
 *        passed through verbatim
 */
export async function relayGatewayRequest(request: Request, segments: string[]): Promise<Response> {
  const method = request.method.toUpperCase()
  if (method !== 'GET' && method !== 'POST') {
    return jsonBody({ error: 'method_not_allowed' }, 405)
  }
  if (!bearerMatches(request.headers.get('authorization'), process.env[RELAY_KEY_ENV])) {
    return jsonBody({ error: 'unauthorized' }, 401)
  }

  const path = `/${segments.map((s) => encodeURIComponent(s)).join('/')}`
  if (!ALLOWED_PREFIXES.some((prefix) => path === prefix.replace(/\/$/, '') || path.startsWith(prefix))) {
    return jsonBody({ error: 'not_found' }, 404)
  }

  const state = await getTierGateway()
  if (!state) {
    // Honest down-state: renders (and the health probe) see this instantly.
    return jsonBody({ error: 'tier_gateway_unconfigured' }, 503)
  }

  const incoming = new URL(request.url)
  const target = `${state.url}${path}${incoming.search}`

  const headers: Record<string, string> = {}
  const contentType = request.headers.get('content-type')
  if (contentType) headers['content-type'] = contentType
  if (state.apiKey) headers.authorization = `Bearer ${state.apiKey}`

  let body: ArrayBuffer | undefined
  if (method === 'POST') {
    body = await request.arrayBuffer()
    if (body.byteLength === 0) body = undefined
  }

  let upstream: Response
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body: body as ArrayBuffer | undefined,
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
      redirect: 'manual', // the gateway answers directly; redirects are a fault
    })
  } catch {
    return jsonBody({ error: 'tier_gateway_unreachable' }, 502)
  }

  const responseHeaders: Record<string, string> = {}
  const upstreamType = upstream.headers.get('content-type')
  if (upstreamType) responseHeaders['content-type'] = upstreamType
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
}

// ---------------------------------------------------------------- health

export interface TierGatewayHealth {
  /** A gateway row exists (an endpoint is registered). */
  configured: boolean
  /** Liveness probe of the registered endpoint; null = nothing to probe. */
  alive: boolean | null
  /** Last rotation time (row updatedAt), ISO string; null = no row. */
  rotatedAt: string | null
}

/**
 * The honest tier truth for the public health surface: a row can exist while
 * its sandbox is dead (hourly cap, failed rotation) — `alive` says which.
 * Never throws and never exposes the URL or key; booleans + a timestamp.
 */
export async function tierGatewayHealth(): Promise<TierGatewayHealth> {
  const state = await getTierGateway()
  if (!state) return { configured: false, alive: null, rotatedAt: null }
  let alive = false
  try {
    const probe = await fetch(`${state.url}/healthz`, {
      headers: state.apiKey ? { authorization: `Bearer ${state.apiKey}` } : {},
      signal: AbortSignal.timeout(GATEWAY_PROBE_TIMEOUT_MS),
    })
    alive = probe.ok
  } catch {
    alive = false
  }
  return { configured: true, alive, rotatedAt: state.updatedAt.toISOString() }
}

// ---------------------------------------------------------------- ops route

/** GET /api/ops/gateway — masked state (never the apiKey value). */
export async function getOpsGateway(request: Request): Promise<Response> {
  if (!opsKeyConfigured()) {
    return jsonBody({ error: 'ops_not_configured' }, 503)
  }
  if (!bearerMatches(request.headers.get('authorization'), process.env[OPS_KEY_ENV])) {
    return jsonBody({ error: 'unauthorized' }, 401)
  }
  const state = await getTierGateway()
  return jsonBody({ gateway: tierGatewayOpsDto(state) }, 200)
}

/** POST /api/ops/gateway — upsert. Body: {url, apiKey?, model?, sandboxId?, notes?}. */
export async function postOpsGateway(request: Request): Promise<Response> {
  if (!opsKeyConfigured()) {
    return jsonBody({ error: 'ops_not_configured' }, 503)
  }
  if (!bearerMatches(request.headers.get('authorization'), process.env[OPS_KEY_ENV])) {
    return jsonBody({ error: 'unauthorized' }, 401)
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonBody({ error: 'invalid_request', message: 'Request body must be JSON' }, 400)
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonBody({ error: 'invalid_request', message: 'Request body must be a JSON object' }, 400)
  }
  try {
    const state = await upsertTierGateway(body as TierGatewayUpsertInput)
    return jsonBody({ gateway: tierGatewayOpsDto(state) }, 201)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid gateway payload'
    return jsonBody({ error: 'invalid_request', message }, 400)
  }
}

/** DELETE /api/ops/gateway — row removed; the tier is down until re-registered. */
export async function deleteOpsGateway(request: Request): Promise<Response> {
  if (!opsKeyConfigured()) {
    return jsonBody({ error: 'ops_not_configured' }, 503)
  }
  if (!bearerMatches(request.headers.get('authorization'), process.env[OPS_KEY_ENV])) {
    return jsonBody({ error: 'unauthorized' }, 401)
  }
  const removed = await clearTierGateway()
  return jsonBody({ removed }, 200)
}

/** TIER_OPS_KEY present? (boolean only — the value is never exposed). */
export function opsKeyConfigured(): boolean {
  const key = process.env[OPS_KEY_ENV]
  return Boolean(key && key.trim().length > 0)
}
