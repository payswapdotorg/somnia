import { dispatchSomnia } from '@/lib/somnia-api'

/**
 * The consolidated API entrypoint.
 *
 * ONE optional catch-all route serves every /api/* path so all endpoints
 * share a single serverless function (and therefore a single writable /tmp:
 * database, media files, and share tokens stay coherent across requests on
 * Vercel). Route logic lives in @/lib/somnia-api — the Somnia multi-user
 * surface: session/API-key auth, per-user credits, generation, transforms,
 * boards, likes, ideas feed, agent runs and public share payloads.
 */

/** Generation pipelines and ffmpeg transforms must finish within the
 * function's budget on serverless. T15: the self-hosted render tier rides
 * behind this function (submit → poll → ingest, a hosted render can take
 * 60-90s wall) — request the full Fluid Compute 300s ceiling so a real
 * hosted render always settles inside the invocation (success, or failure +
 * refund); the gateway enforces its own 240s deadline underneath. */
export const maxDuration = 300

export const dynamic = 'force-dynamic'

type CatchAllContext = { params: Promise<{ path?: string[] }> }

export async function GET(request: Request, context: CatchAllContext): Promise<Response> {
  const { path } = await context.params
  return dispatchSomnia(request, path ?? [])
}

export async function POST(request: Request, context: CatchAllContext): Promise<Response> {
  const { path } = await context.params
  return dispatchSomnia(request, path ?? [])
}

export async function PUT(request: Request, context: CatchAllContext): Promise<Response> {
  const { path } = await context.params
  return dispatchSomnia(request, path ?? [])
}

export async function PATCH(request: Request, context: CatchAllContext): Promise<Response> {
  const { path } = await context.params
  return dispatchSomnia(request, path ?? [])
}

export async function DELETE(request: Request, context: CatchAllContext): Promise<Response> {
  const { path } = await context.params
  return dispatchSomnia(request, path ?? [])
}
