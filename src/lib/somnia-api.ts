// src/lib/somnia-api.ts — Somnia HTTP dispatcher (T3).
//
// The single API surface for the app, served behind the catch-all
// /api/[[...path]] route so every endpoint shares one serverless function
// (and one writable /tmp). Web-standard Request/Response only — no
// next/server import — so Vitest can exercise the whole route table
// directly (tests/api.test.ts).
//
// Authentication, in order:
//   1. Authorization: Bearer sk_somnia_…  (developer API key)
//   2. Cookie: somnia_session=<token>     (browser session)
//
// Route table (method, segments → handler):
//   POST   auth/signup             → account + trial grant + session cookie
//   POST   auth/login              → session cookie
//   POST   auth/logout             → destroys the session, clears cookie
//   GET    auth/me                 → current user (401 without auth)
//   GET    auth/google             → OAuth scaffold (501 unless configured)
//   GET    plans                   → public plan catalogue
//   GET    credits                 → balance + ledger tail (auth)
//   POST   brainstorm              → prompt style variants (auth)
//   POST   generate                → video job (auth)
//   POST   image                   → prism still job (auth)
//   GET    jobs                    → my jobs with timeline + assets (auth)
//   GET    jobs/:id                → job detail (owner only)
//   POST   jobs/:id/extend         → +5s continuation (completed sources)
//   POST   jobs/:id/modify         → video-to-video instruction job
//   POST   jobs/:id/reframe        → aspect re-crop variant (idempotent)
//   POST   jobs/:id/upscale        → 4K upscale variant (idempotent)
//   POST   jobs/:id/remix          → free composer prefill
//   POST   jobs/:id/share          → mint unlisted token
//   DELETE jobs/:id/share          → revoke the token
//   POST   jobs/:id/like           → like
//   DELETE jobs/:id/like           → unlike
//   GET    jobs/shared/:token      → public share payload
//   GET    boards                  → my boards (auth)
//   POST   boards                  → create board (auth)
//   DELETE boards/:id              → delete board (jobs survive)
//   POST   boards/:id/share        → mint board token
//   GET    boards/shared/:token    → public board payload
//   GET    keys                    → my API key records (auth)
//   POST   keys                    → mint sk_somnia key (plaintext once)
//   DELETE keys/:id                → revoke
//   POST   agents                  → plan a goal run (auth)
//   POST   agents/:id/start        → dispatch the plan (pre-flight balance)
//   GET    agents/:id              → run view
//   GET    ideas                   → public ideas feed (viewer-optional)
//   GET    media/*                 → Range-aware media streaming
//   GET    providers/health        → provider health snapshot

import { db } from '@/lib/db'
import {
  SESSION_COOKIE,
  signup,
  login,
  createSession,
  getSessionUser,
  destroySession,
} from '@/lib/auth'
import {
  createJob,
  extendJob,
  modifyJob,
  reframeJob,
  upscaleJob,
  getJob,
} from '@/lib/engine'
import {
  createBoard,
  listBoards,
  deleteBoard,
  shareBoard,
  getSharedBoard,
  shareJob,
  revokeShareJob,
  getSharedJob,
  likeJob,
  unlikeJob,
  listIdeas,
  remixJob,
} from '@/lib/social'
import { createApiKey, revokeApiKey, listApiKeys, resolveApiKey } from '@/lib/apikeys'
import { planAgentRun, startAgentRun, getAgentRun } from '@/lib/agents'
import { suggestBrainstorms } from '@/lib/brainstorm'
import { ensureMonthlyPool } from '@/lib/ledger'
import { PLANS } from '@/lib/plans'
import { serveMedia } from '@/lib/media-handler'
import { getProviderHealth } from '@/lib/health'
import { randomBytes } from 'node:crypto'
import type { User } from '@prisma/client'

// ---------------------------------------------------------------- helpers

const SESSION_MAX_AGE = 60 * 60 * 24 * 30 // 30 days, mirrors auth SESSION_TTL_MS

function json(data: unknown, status = 200, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...extra },
  })
}

function notFound(): Response {
  return json({ error: 'not_found', message: 'Unknown API route' }, 404)
}

function unauthorized(): Response {
  return json({ error: 'unauthorized', message: 'Sign in or provide an API key' }, 401)
}

function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`
}

function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarSeed: user.avatarSeed,
    plan: user.plan,
    credits: user.credits,
    createdAt: user.createdAt,
  }
}

function sessionTokenFrom(request: Request): string | null {
  const cookie = request.headers.get('cookie')
  if (!cookie) return null
  for (const part of cookie.split(';')) {
    const trimmed = part.trim()
    if (trimmed.startsWith(`${SESSION_COOKIE}=`)) {
      return trimmed.slice(SESSION_COOKIE.length + 1) || null
    }
  }
  return null
}

/** Resolve the caller: Bearer API key first, then the session cookie. */
async function resolveUser(request: Request): Promise<User | null> {
  const authz = request.headers.get('authorization')
  if (authz && authz.toLowerCase().startsWith('bearer ')) {
    const key = authz.slice(7).trim()
    if (key) {
      const resolved = await resolveApiKey(key)
      if (!resolved) return null
      return db.user.findUnique({ where: { id: resolved.user.id } })
    }
  }
  const token = sessionTokenFrom(request)
  if (token) return getSessionUser(token)
  return null
}

/** Domain errors → HTTP. Message patterns are pinned by tests/api.test.ts. */
function toErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error)
  if (/^insufficient credits/i.test(message)) {
    return json({ error: 'insufficient_credits', message }, 402)
  }
  if (/^invalid email or password/i.test(message)) {
    return json({ error: 'invalid_credentials', message }, 401)
  }
  if (/account already exists/i.test(message)) {
    return json({ error: 'email_taken', message }, 409)
  }
  if (/not found|no such/i.test(message)) {
    return json({ error: 'not_found', message }, 404)
  }
  if (/only completed jobs|only completed clips/i.test(message)) {
    return json({ error: 'not_ready', message }, 409)
  }
  return json({ error: 'invalid_request', message }, 400)
}

async function requireUser(request: Request): Promise<{ user: User } | { response: Response }> {
  const user = await resolveUser(request)
  if (!user) return { response: unauthorized() }
  return { user }
}

// ------------------------------------------------------------ auth routes

async function postSignup(request: Request): Promise<Response> {
  try {
    const body = await readBody(request)
    if (!body) {
      return json({ error: 'invalid_request', message: 'Request body must be JSON' }, 400)
    }
    const { user } = await signup({
      email: String(body.email ?? ''),
      password: String(body.password ?? ''),
      name: str(body.name),
    })
    const session = await createSession(user.id)
    return json({ user: publicUser(user) }, 201, { 'set-cookie': sessionCookieHeader(session.token) })
  } catch (error) {
    return toErrorResponse(error)
  }
}

async function postLogin(request: Request): Promise<Response> {
  try {
    const body = await readBody(request)
    if (!body) {
      return json({ error: 'invalid_request', message: 'Request body must be JSON' }, 400)
    }
    const { user } = await login({
      email: String(body.email ?? ''),
      password: String(body.password ?? ''),
    })
    const session = await createSession(user.id)
    return json({ user: publicUser(user) }, 200, { 'set-cookie': sessionCookieHeader(session.token) })
  } catch (error) {
    return toErrorResponse(error)
  }
}

async function postLogout(request: Request): Promise<Response> {
  const token = sessionTokenFrom(request)
  if (token) await destroySession(token)
  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookieHeader() })
}

/** Google OAuth scaffold: ready to wire once GOOGLE_CLIENT_ID is configured. */
async function getGoogleAuth(request: Request): Promise<Response> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) {
    return json(
      { error: 'oauth_not_configured', message: 'Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET to enable Google sign-in' },
      501
    )
  }
  const origin = new URL(request.url).origin
  const redirectUri = `${origin}/api/auth/google/callback`
  const state = randomBytes(16).toString('hex')
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
  })
  return new Response(null, {
    status: 302,
    headers: { location: `https://accounts.google.com/o/oauth2/v2/auth?${params}` },
  })
}

// --------------------------------------------------------- credits/brainstorm

async function getCredits(user: User): Promise<Response> {
  try {
    // Paid plans refill their monthly pool on the first read of a cycle
    // (idempotent; trial has no pool so this is a no-op).
    await ensureMonthlyPool(user.id)
    const [fresh, transactions] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { id: user.id } }),
      db.creditTransaction.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ])
    return json({
      user: publicUser(fresh),
      balance: fresh.credits,
      plan: fresh.plan,
      transactions: transactions.map((tx) => ({
        id: tx.id,
        amount: tx.amount,
        kind: tx.kind,
        note: tx.note,
        balanceAfter: tx.balanceAfter,
        jobId: tx.jobId,
        createdAt: tx.createdAt,
      })),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

async function postBrainstorm(request: Request): Promise<Response> {
  try {
    const body = await readBody(request)
    const prompt = String(body?.prompt ?? '').trim()
    if (prompt.length < 3) {
      return json({ error: 'invalid_request', message: 'prompt must be at least 3 characters' }, 400)
    }
    return json({ variants: suggestBrainstorms(prompt) })
  } catch (error) {
    return toErrorResponse(error)
  }
}

// -------------------------------------------------------- generation routes

async function postGenerate(request: Request, user: User): Promise<Response> {
  try {
    const body = await readBody(request)
    if (!body) {
      return json({ error: 'invalid_request', message: 'Request body must be JSON' }, 400)
    }
    const keyframes = Array.isArray(body.keyframes)
      ? (body.keyframes as unknown[]).map((raw) => {
          const kf = (raw ?? {}) as { dataUrl?: unknown; name?: unknown }
          return {
            dataUrl: String(kf.dataUrl ?? ''),
            name: typeof kf.name === 'string' ? kf.name : undefined,
          }
        })
      : undefined
    const job = await createJob({
      userId: user.id,
      prompt: String(body.prompt ?? ''),
      enhancedPrompt: str(body.enhancedPrompt),
      model: str(body.model),
      resolution: str(body.resolution),
      aspectRatio: str(body.aspectRatio),
      durationSec:
        body.durationSec === undefined || body.durationSec === null
          ? undefined
          : Number(body.durationSec),
      hdr: body.hdr === true,
      loop: body.loop === true,
      keyframes,
      startFrame: str(body.startFrame),
      endFrame: str(body.endFrame),
      boardId: str(body.boardId),
      idempotencyKey: str(body.idempotencyKey),
    })
    const detail = await getJob(user.id, job.id)
    return json({ job: detail }, 201)
  } catch (error) {
    return toErrorResponse(error)
  }
}

async function postImage(request: Request, user: User): Promise<Response> {
  try {
    const body = await readBody(request)
    if (!body) {
      return json({ error: 'invalid_request', message: 'Request body must be JSON' }, 400)
    }
    const job = await createJob({
      userId: user.id,
      kind: 'image',
      prompt: String(body.prompt ?? ''),
      enhancedPrompt: str(body.enhancedPrompt),
      aspectRatio: str(body.aspectRatio),
      boardId: str(body.boardId),
      idempotencyKey: str(body.idempotencyKey),
    })
    const detail = await getJob(user.id, job.id)
    return json({ job: detail }, 201)
  } catch (error) {
    return toErrorResponse(error)
  }
}

async function getJobs(user: User, request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 100)
    const jobs = await db.job.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        keyframes: { orderBy: { order: 'asc' } },
        assets: true,
      },
    })
    return json({ jobs })
  } catch (error) {
    return toErrorResponse(error)
  }
}

async function getJobDetail(user: User, jobId: string): Promise<Response> {
  try {
    const job = await getJob(user.id, jobId)
    if (!job) {
      return json({ error: 'not_found', message: 'No such job' }, 404)
    }
    return json({ job })
  } catch (error) {
    return toErrorResponse(error)
  }
}

async function postJobExtend(request: Request, user: User, jobId: string): Promise<Response> {
  try {
    const job = await extendJob(user.id, jobId)
    const detail = await getJob(user.id, job.id)
    return json({ job: detail }, 201)
  } catch (error) {
    return toErrorResponse(error)
  }
}

async function postJobModify(request: Request, user: User, jobId: string): Promise<Response> {
  try {
    const body = await readBody(request)
    if (!body) {
      return json({ error: 'invalid_request', message: 'Request body must be JSON' }, 400)
    }
    const job = await modifyJob(user.id, jobId, {
      instruction: String(body.instruction ?? ''),
      model: str(body.model),
      resolution: str(body.resolution),
    })
    const detail = await getJob(user.id, job.id)
    return json({ job: detail }, 201)
  } catch (error) {
    return toErrorResponse(error)
  }
}

async function postJobReframe(request: Request, user: User, jobId: string): Promise<Response> {
  try {
    const body = await readBody(request)
    const asset = await reframeJob(user.id, jobId, String(body?.aspect ?? ''))
    return json({ asset }, 200)
  } catch (error) {
    return toErrorResponse(error)
  }
}

async function postJobUpscale(user: User, jobId: string): Promise<Response> {
  try {
    const asset = await upscaleJob(user.id, jobId)
    return json({ asset }, 200)
  } catch (error) {
    return toErrorResponse(error)
  }
}

// ------------------------------------------------------------------ agents

async function postAgents(request: Request, user: User): Promise<Response> {
  try {
    const body = await readBody(request)
    if (!body) {
      return json({ error: 'invalid_request', message: 'Request body must be JSON' }, 400)
    }
    const { run } = await planAgentRun(user.id, String(body.goal ?? ''))
    const view = await getAgentRun(user.id, run.id)
    return json({ run: view, plan: view?.plan ?? [] }, 201)
  } catch (error) {
    return toErrorResponse(error)
  }
}

async function postAgentStart(user: User, runId: string): Promise<Response> {
  try {
    await startAgentRun(runId)
    const view = await getAgentRun(user.id, runId)
    if (!view) return json({ error: 'not_found', message: 'No such agent run' }, 404)
    return json({ run: view })
  } catch (error) {
    return toErrorResponse(error)
  }
}

async function getAgentDetail(user: User, runId: string): Promise<Response> {
  const view = await getAgentRun(user.id, runId)
  if (!view) return json({ error: 'not_found', message: 'No such agent run' }, 404)
  return json(view)
}

// ---------------------------------------------------------------- dispatch

export async function dispatchSomnia(request: Request, segments: string[]): Promise<Response> {
  const [first, second, third, ...rest] = segments
  const method = request.method.toUpperCase()

  // ---------------------------------------------------------------- public

  if (first === 'plans' && !second && method === 'GET') {
    return json({ plans: [PLANS.trial, PLANS.spark, PLANS.studio, PLANS.infinite] })
  }

  if (first === 'auth') {
    if (second === 'signup' && !third && method === 'POST') return postSignup(request)
    if (second === 'login' && !third && method === 'POST') return postLogin(request)
    if (second === 'logout' && !third && method === 'POST') return postLogout(request)
    if (second === 'me' && !third && method === 'GET') {
      const user = await resolveUser(request)
      return user ? json({ user: publicUser(user) }) : unauthorized()
    }
    if (second === 'google' && !third && method === 'GET') return getGoogleAuth(request)
    return notFound()
  }

  if (first === 'jobs' && second === 'shared' && third && !rest.length && method === 'GET') {
    try {
      const payload = await getSharedJob(third)
      if (!payload) return json({ error: 'not_found', message: 'Share link not available' }, 404)
      return json(payload)
    } catch (error) {
      return toErrorResponse(error)
    }
  }

  if (first === 'boards' && second === 'shared' && third && !rest.length && method === 'GET') {
    try {
      const payload = await getSharedBoard(third)
      if (!payload) return json({ error: 'not_found', message: 'Share link not available' }, 404)
      return json(payload)
    } catch (error) {
      return toErrorResponse(error)
    }
  }

  if (first === 'ideas' && !second && method === 'GET') {
    try {
      const url = new URL(request.url)
      const viewer = await resolveUser(request) // optional — enriches likedByMe
      const result = await listIdeas({
        viewerId: viewer?.id,
        limit: Number(url.searchParams.get('limit') ?? 24) || 24,
        offset: Number(url.searchParams.get('offset') ?? 0) || 0,
      })
      return json(result)
    } catch (error) {
      return toErrorResponse(error)
    }
  }

  if (first === 'media' && segments.length > 1 && method === 'GET') {
    return serveMedia(request, segments.slice(1).join('/'))
  }

  if (first === 'providers' && second === 'health' && !third && method === 'GET') {
    try {
      return json(await getProviderHealth())
    } catch (error) {
      return toErrorResponse(error)
    }
  }

  // ------------------------------------------------------- authenticated

  if (
    ['credits', 'brainstorm', 'generate', 'image', 'jobs', 'boards', 'keys', 'agents'].includes(
      first ?? ''
    )
  ) {
    // Singleton routes: a wrong method/shape is a routing miss (404) — it
    // must not leak whether the caller is authenticated.
    if (first === 'credits' && (second || method !== 'GET')) return notFound()
    if (
      (first === 'brainstorm' || first === 'generate' || first === 'image') &&
      (second || method !== 'POST')
    ) {
      return notFound()
    }
    if (first === 'agents' && !second && method !== 'POST') return notFound()

    const auth = await requireUser(request)
    if ('response' in auth) return auth.response
    const { user } = auth

    if (first === 'credits' && !second && method === 'GET') return getCredits(user)

    if (first === 'brainstorm' && !second && method === 'POST') return postBrainstorm(request)

    if (first === 'generate' && !second && method === 'POST') return postGenerate(request, user)

    if (first === 'image' && !second && method === 'POST') return postImage(request, user)

    if (first === 'jobs') {
      if (!second && method === 'GET') return getJobs(user, request)

      if (second && !third && method === 'GET') return getJobDetail(user, second)

      if (second && third && !rest.length && method === 'POST') {
        if (third === 'extend') return postJobExtend(request, user, second)
        if (third === 'modify') return postJobModify(request, user, second)
        if (third === 'reframe') return postJobReframe(request, user, second)
        if (third === 'upscale') return postJobUpscale(user, second)
        if (third === 'share') {
          try {
            const { token } = await shareJob(user.id, second)
            return json({ shareToken: token }, 201)
          } catch (error) {
            return toErrorResponse(error)
          }
        }
        if (third === 'remix') {
          try {
            return json(await remixJob(user.id, second))
          } catch (error) {
            return toErrorResponse(error)
          }
        }
        if (third === 'like') {
          try {
            return json(await likeJob(user.id, second))
          } catch (error) {
            return toErrorResponse(error)
          }
        }
      }

      if (second && third && !rest.length && method === 'DELETE') {
        if (third === 'share') {
          try {
            await revokeShareJob(user.id, second)
            return json({ ok: true })
          } catch (error) {
            return toErrorResponse(error)
          }
        }
        if (third === 'like') {
          try {
            return json(await unlikeJob(user.id, second))
          } catch (error) {
            return toErrorResponse(error)
          }
        }
      }
      return notFound()
    }

    if (first === 'boards') {
      if (!second && method === 'GET') {
        try {
          return json({ boards: await listBoards(user.id) })
        } catch (error) {
          return toErrorResponse(error)
        }
      }
      if (!second && method === 'POST') {
        try {
          const body = await readBody(request)
          if (!body) {
            return json({ error: 'invalid_request', message: 'Request body must be JSON' }, 400)
          }
          const board = await createBoard(user.id, {
            name: String(body.name ?? ''),
            description: str(body.description),
          })
          return json({ board }, 201)
        } catch (error) {
          return toErrorResponse(error)
        }
      }
      if (second && !third && method === 'DELETE') {
        try {
          await deleteBoard(user.id, second)
          return json({ ok: true })
        } catch (error) {
          return toErrorResponse(error)
        }
      }
      if (second && third === 'share' && !rest.length && method === 'POST') {
        try {
          const { token } = await shareBoard(user.id, second)
          return json({ shareToken: token }, 201)
        } catch (error) {
          return toErrorResponse(error)
        }
      }
      return notFound()
    }

    if (first === 'keys') {
      if (!second && method === 'GET') {
        try {
          return json({ keys: await listApiKeys(user.id) })
        } catch (error) {
          return toErrorResponse(error)
        }
      }
      if (!second && method === 'POST') {
        try {
          const body = await readBody(request)
          if (!body) {
            return json({ error: 'invalid_request', message: 'Request body must be JSON' }, 400)
          }
          const minted = await createApiKey(user.id, { name: String(body.name ?? '') })
          return json(
            {
              key: minted.key,
              id: minted.record.id,
              name: minted.record.name,
              prefix: minted.record.prefix,
              createdAt: minted.record.createdAt,
            },
            201
          )
        } catch (error) {
          return toErrorResponse(error)
        }
      }
      if (second && !third && method === 'DELETE') {
        try {
          await revokeApiKey(user.id, second)
          return json({ ok: true })
        } catch (error) {
          return toErrorResponse(error)
        }
      }
      return notFound()
    }

    if (first === 'agents') {
      if (!second && method === 'POST') return postAgents(request, user)
      if (second && third === 'start' && !rest.length && method === 'POST') {
        return postAgentStart(user, second)
      }
      if (second && !third && method === 'GET') return getAgentDetail(user, second)
      return notFound()
    }
  }

  return notFound()
}
