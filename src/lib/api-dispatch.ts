import { errorResponse } from '@/lib/api'
import { db } from '@/lib/db'
import { chatAgent } from '@/lib/agent'
import { getProviderHealth } from '@/lib/health'
import { getInsights } from '@/lib/insights'
import { createImageJob } from '@/lib/images'
import {
  createJob,
  disableJobShare,
  editJob,
  enableJobShare,
  extendJob,
  getJobDetail,
  getSharedJob,
  listJobs,
  rerunJob,
} from '@/lib/jobs'
import { handleFalWebhook, verifyWebhookSignature } from '@/lib/providers/fal-stub'
import { cameraJob, reframeJob, restyleJob } from '@/lib/transforms'
import type { CreditTransactionDto, CreditsDto } from '@/lib/types'
import { getOrCreateDemoUser, ensureDailyGrant } from '@/lib/user'
import { DAILY_GRANT_CREDITS } from '@/lib/pricing'
import { serveMedia } from '@/lib/media-handler'
import { NextResponse } from 'next/server'

/**
 * Consolidated API dispatcher (Phase 6).
 *
 * On Vercel, every App Router route file is its OWN serverless function with
 * an isolated /tmp — per-function SQLite meant a job created by POST
 * /api/generate was invisible to GET /api/jobs. All API endpoints therefore
 * live in this ONE dispatcher behind the optional catch-all route
 * (/api/[[...path]]), so they share a single function, a single writable
 * scratch dir, and a single coherent database. Handler bodies are the exact
 * route files that shipped through Phase 5, moved verbatim.
 *
 * Route table (method, segments):
 *   GET    credits                          → balance + recent ledger
 *   POST   generate                         → create + charge a VIDEO generation job
 *   POST   image                            → create + charge an IMAGE still job (Phase 8)
 *   POST   agent                            → Forge Agent chat-to-create (Phase 8)
 *   GET    insights                         → ops dashboard aggregates
 *   GET    jobs                             → job list (client polling)
 *   GET    jobs/:id                        → single job (active-job polling)
 *   POST   jobs/:id/camera                  → camera-motion variant (15 cr)
 *   POST   jobs/:id/edit                    → edit-thread child job
 *   POST   jobs/:id/extend                  → +5s continuation job
 *   POST   jobs/:id/reframe                 → aspect re-crop variant (10 cr)
 *   POST   jobs/:id/restyle                 → video-to-video style grade (12 cr)
 *   POST   jobs/:id/rerun                   → re-run as a fresh job
 *   POST   jobs/:id/share                   → mint the unlisted share token
 *   DELETE jobs/:id/share                   → revoke the share token
 *   GET    jobs/shared/:token               → public share payload (stateless
 *                                             share pages fetch this so they
 *                                             read the API function's state)
 *   GET    media/*                          → Range-aware media streaming
 *   GET    providers/health                 → provider health snapshot
 *   POST   providers/fal/webhook            → fal.ai-style webhook
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHARE_TOKEN = /^[0-9a-f]{32}$/i

function notFound(): NextResponse {
  return NextResponse.json({ error: 'not_found', message: 'Unknown API route' }, { status: 404 })
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null)
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : null
}

async function getCredits(): Promise<Response> {
  try {
    // Phase 9 (N6): the daily refill rides along every credits read — first
    // touch of a UTC day appends the grant and bumps the balance atomically.
    const daily = await ensureDailyGrant()
    const user = await getOrCreateDemoUser()
    const transactions = await db.creditTransaction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })
    const payload: CreditsDto = {
      balance: user.credits,
      transactions: transactions.map(
        (tx): CreditTransactionDto => ({
          id: tx.id,
          amount: tx.amount,
          kind: tx.kind as CreditTransactionDto['kind'],
          balanceAfter: tx.balanceAfter,
          jobId: tx.jobId,
          createdAt: tx.createdAt.toISOString(),
        })
      ),
      dailyGrant: {
        amount: DAILY_GRANT_CREDITS,
        nextRefillAt: daily.nextRefillAt.toISOString(),
        justGranted: daily.granted,
      },
    }
    return NextResponse.json(payload)
  } catch (error) {
    return errorResponse(error)
  }
}

async function postGenerate(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody(request)
    if (!body) {
      return NextResponse.json(
        { error: 'invalid_request', message: 'Request body must be JSON' },
        { status: 400 }
      )
    }
    const result = await createJob({
      prompt: body.prompt,
      tier: body.tier,
      durationSec: body.durationSec,
      aspectRatio: body.aspectRatio,
      startFrame: body.startFrame,
      endFrame: body.endFrame,
      board: body.board,
      idempotencyKey: body.idempotencyKey,
    })
    return NextResponse.json(result, { status: result.idempotentReplay ? 200 : 201 })
  } catch (error) {
    return errorResponse(error)
  }
}

async function postImage(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody(request)
    if (!body) {
      return NextResponse.json(
        { error: 'invalid_request', message: 'Request body must be JSON' },
        { status: 400 }
      )
    }
    const result = await createImageJob({
      prompt: body.prompt,
      tier: body.tier,
      aspectRatio: body.aspectRatio,
      board: body.board,
      idempotencyKey: body.idempotencyKey,
    })
    return NextResponse.json(result, { status: result.idempotentReplay ? 200 : 201 })
  } catch (error) {
    return errorResponse(error)
  }
}

async function postAgent(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody(request)
    if (!body || !Array.isArray(body.messages)) {
      return NextResponse.json(
        { error: 'invalid_request', message: 'Request body must be JSON with a messages array' },
        { status: 400 }
      )
    }
    const result = await chatAgent(body.messages)
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}

async function postJobAction(
  action: 'camera' | 'edit' | 'extend' | 'reframe' | 'rerun' | 'restyle',
  request: Request,
  jobId: string
): Promise<Response> {
  try {
    switch (action) {
      case 'camera': {
        const body = await readJsonBody(request)
        if (!body) {
          return NextResponse.json(
            { error: 'invalid_request', message: 'Request body must be JSON' },
            { status: 400 }
          )
        }
        const result = await cameraJob(jobId, body.preset)
        return NextResponse.json(result, { status: 200 })
      }
      case 'edit': {
        const body = await readJsonBody(request)
        if (!body) {
          return NextResponse.json(
            { error: 'invalid_request', message: 'Request body must be JSON' },
            { status: 400 }
          )
        }
        const result = await editJob(jobId, body.instruction)
        return NextResponse.json(result, { status: 201 })
      }
      case 'extend': {
        const result = await extendJob(jobId)
        return NextResponse.json(result, { status: 201 })
      }
      case 'reframe': {
        const body = await readJsonBody(request)
        if (!body) {
          return NextResponse.json(
            { error: 'invalid_request', message: 'Request body must be JSON' },
            { status: 400 }
          )
        }
        const result = await reframeJob(jobId, body.aspect)
        return NextResponse.json(result, { status: 200 })
      }
      case 'rerun': {
        const result = await rerunJob(jobId)
        return NextResponse.json(result, { status: 201 })
      }
      case 'restyle': {
        const body = await readJsonBody(request)
        if (!body) {
          return NextResponse.json(
            { error: 'invalid_request', message: 'Request body must be JSON' },
            { status: 400 }
          )
        }
        const result = await restyleJob(jobId, body.style)
        return NextResponse.json(result, { status: 200 })
      }
    }
  } catch (error) {
    return errorResponse(error)
  }
  return notFound()
}

async function postFalWebhook(request: Request): Promise<Response> {
  try {
    const payload = await request.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    }
    const signature =
      request.headers.get('x-reelforge-webhook-secret') ??
      request.headers.get('x-fal-webhook-secret')
    if (!verifyWebhookSignature(process.env.FAL_WEBHOOK_SECRET ?? null, signature)) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    const { handled } = await handleFalWebhook(payload)
    return NextResponse.json({ handled })
  } catch (error) {
    console.error('[fal-webhook] error:', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}

export async function dispatchApi(request: Request, segments: string[]): Promise<Response> {
  const method = request.method.toUpperCase()
  const [first, second, third, ...rest] = segments

  // GET /api — tiny human-readable index.
  if (!first) {
    return NextResponse.json({ app: 'reelforge', api: 'v1', ok: true })
  }

  if (first === 'credits' && !second && method === 'GET') {
    return getCredits()
  }

  if (first === 'generate' && !second && method === 'POST') {
    return postGenerate(request)
  }

  if (first === 'image' && !second && method === 'POST') {
    return postImage(request)
  }

  if (first === 'agent' && !second && method === 'POST') {
    return postAgent(request)
  }

  if (first === 'insights' && !second && method === 'GET') {
    try {
      return NextResponse.json(await getInsights())
    } catch (error) {
      return errorResponse(error)
    }
  }

  if (first === 'jobs') {
    if (!second && method === 'GET') {
      try {
        const jobs = await listJobs(50)
        return NextResponse.json({ jobs })
      } catch (error) {
        return errorResponse(error)
      }
    }

    // Single job detail — the studio's active-job poll hits this every 1.5s.
    if (second && UUID.test(second) && !third && method === 'GET') {
      try {
        const job = await getJobDetail(second)
        if (!job) {
          return NextResponse.json(
            { error: 'not_found', message: 'No such job' },
            { status: 404 }
          )
        }
        return NextResponse.json({ job })
      } catch (error) {
        return errorResponse(error)
      }
    }

    // Public share payload — no auth, the token is the capability.
    if (second === 'shared' && third && !rest.length && method === 'GET') {
      if (!SHARE_TOKEN.test(third)) return notFound()
      try {
        const job = await getSharedJob(third)
        if (!job) {
          return NextResponse.json(
            { error: 'not_found', message: 'Share link not available' },
            { status: 404 }
          )
        }
        return NextResponse.json(job)
      } catch (error) {
        return errorResponse(error)
      }
    }

    if (
      second &&
      UUID.test(second) &&
      third &&
      !rest.length &&
      ['camera', 'edit', 'extend', 'reframe', 'rerun', 'restyle'].includes(third) &&
      method === 'POST'
    ) {
      return postJobAction(
        third as 'camera' | 'edit' | 'extend' | 'reframe' | 'rerun' | 'restyle',
        request,
        second
      )
    }

    if (second && UUID.test(second) && third === 'share' && !rest.length) {
      if (method === 'POST') {
        try {
          const { shareToken, sharedAt } = await enableJobShare(second)
          return NextResponse.json({ shareToken, sharedAt: sharedAt.toISOString() })
        } catch (error) {
          return errorResponse(error)
        }
      }
      if (method === 'DELETE') {
        try {
          await disableJobShare(second)
          return NextResponse.json({ ok: true })
        } catch (error) {
          return errorResponse(error)
        }
      }
    }
    return notFound()
  }

  if (first === 'media' && segments.length > 1 && method === 'GET') {
    return serveMedia(request, segments.slice(1).join('/'))
  }

  if (first === 'providers' && second === 'health' && !third && method === 'GET') {
    try {
      return NextResponse.json(await getProviderHealth())
    } catch (error) {
      return errorResponse(error)
    }
  }

  if (first === 'providers' && second === 'fal' && third === 'webhook' && !rest.length && method === 'POST') {
    return postFalWebhook(request)
  }

  return notFound()
}
