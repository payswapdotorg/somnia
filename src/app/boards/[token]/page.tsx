import type { Metadata } from 'next'
import Link from 'next/link'
import { BRAND } from '@/lib/brand'

/**
 * Somnia — public, unlisted board share page.
 *
 * The board-level counterpart of /share/[token]: the opaque board token in
 * the URL is the capability, no auth, server-rendered with zero client JS
 * (plain <video> elements). Lists the board's completed, still-attached
 * dreams. Unlisted by design: noindex + robots.txt exclude /boards/ share
 * routes (the authenticated /boards manager page stays private).
 */

export const dynamic = 'force-dynamic'

interface SharedBoardPayload {
  board: {
    id: string
    name: string
    description: string | null
    sharedAt: string | null
  }
  jobs: Array<{
    id: string
    prompt: string
    model: string
    resolution: string
    aspectRatio: string
    loop: boolean
    createdAt: string
    videoPath: string | null
  }>
}

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, '')
}

async function fetchSharedBoard(token: string): Promise<SharedBoardPayload | null> {
  try {
    const response = await fetch(`${siteUrl()}/api/boards/shared/${token}`, { cache: 'no-store' })
    if (!response.ok) return null
    const data: unknown = await response.json()
    if (data && typeof data === 'object' && 'board' in data && 'jobs' in data) {
      return data as SharedBoardPayload
    }
    return null
  } catch {
    return null
  }
}

function excerpt(text: string, max: number): string {
  const clean = text.trim().replace(/\s+/g, ' ')
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

const ASPECT_STYLE: Record<string, string> = {
  '16:9': 'aspect-video',
  '9:16': 'aspect-[9/16]',
  '1:1': 'aspect-square',
  '4:3': 'aspect-[4/3]',
  '3:4': 'aspect-[3/4]',
  '21:9': 'aspect-[21/9]',
  '9:21': 'aspect-[9/21]',
}

function aspectStyle(ratio: string): string {
  return ASPECT_STYLE[ratio] ?? 'aspect-video'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const NOINDEX = { index: false, follow: false }

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>
}): Promise<Metadata> {
  const { token } = await params
  const payload = await fetchSharedBoard(token)
  if (!payload) {
    return { title: `${BRAND.name} — board not available`, robots: NOINDEX }
  }
  const title = `${BRAND.name} — board: ${payload.board.name}`
  const description =
    excerpt(payload.board.description ?? payload.board.name, 160) +
    ` · ${payload.jobs.length} shared dreams`
  return { title, description, robots: NOINDEX }
}

function BoardUnavailable(): React.ReactElement {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-zinc-100">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center">
        <h1 className="text-lg font-semibold tracking-tight">This board link is not available</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          The board&rsquo;s owner may have deleted it or the link never existed. Board links are
          unlisted — only someone holding the exact link can browse.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 px-5 text-sm font-semibold text-white transition hover:opacity-90"
        >
          Visit {BRAND.name}
        </Link>
      </div>
    </main>
  )
}

export default async function SharedBoardPage({
  params,
}: {
  params: Promise<{ token: string }>
}): Promise<React.ReactElement> {
  const { token } = await params
  const payload = await fetchSharedBoard(token)
  if (!payload) return <BoardUnavailable />

  const { board, jobs } = payload

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div
        className="pointer-events-none fixed inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_at_top,rgba(139,92,246,0.16),transparent_65%)]"
        aria-hidden="true"
      />

      <header className="relative border-b border-zinc-800/70">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-sm font-bold text-white"
            >
              S
            </span>
            <span className="text-base font-semibold tracking-tight">{BRAND.name}</span>
            <span className="ml-1 hidden rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-300 sm:inline">
              shared board
            </span>
          </div>
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900/60 px-4 text-xs font-semibold text-zinc-200 transition-colors hover:border-violet-500/50 hover:text-violet-300"
          >
            Dream your own
          </Link>
        </div>
      </header>

      <article className="relative mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">{board.name}</h1>
          {board.description && (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">{board.description}</p>
          )}
          <p className="mt-2 text-xs text-zinc-500">
            {jobs.length} {jobs.length === 1 ? 'dream' : 'dreams'}
            {board.sharedAt ? ` · shared ${formatDate(board.sharedAt)}` : ''}
          </p>
        </header>

        {jobs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-800 p-10 text-center text-sm text-zinc-500">
            Nothing on this board yet — the dreams are still being filed.
          </p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            {jobs.map((job) => (
              <figure
                key={job.id}
                className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40"
              >
                {job.videoPath ? (
                  <video
                    src={job.videoPath}
                    controls
                    muted
                    loop={job.loop}
                    playsInline
                    preload="metadata"
                    className={`w-full bg-black object-contain ${aspectStyle(job.aspectRatio)}`}
                  />
                ) : (
                  <div className="flex aspect-video items-center justify-center text-xs text-zinc-600">
                    render unavailable
                  </div>
                )}
                <figcaption className="space-y-2 p-4">
                  <p className="line-clamp-2 text-sm text-zinc-200">{job.prompt}</p>
                  <p className="text-[11px] text-zinc-500">
                    {job.model} · {job.resolution} · {job.aspectRatio} · {formatDate(job.createdAt)}
                  </p>
                </figcaption>
              </figure>
            ))}
          </div>
        )}

        <footer className="mt-10 border-t border-zinc-800/70 pt-6 text-center text-xs text-zinc-500">
          <p>
            {BRAND.name} — {BRAND.tagline}{' '}
            <Link href="/" className="text-violet-400 underline-offset-4 hover:underline">
              make your own
            </Link>
            .
          </p>
        </footer>
      </article>
    </main>
  )
}
