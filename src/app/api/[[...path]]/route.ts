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
 * function's budget on serverless — request the full 60s ceiling. */
export const maxDuration = 60

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
