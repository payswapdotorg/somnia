import type { Metadata } from 'next'
import Link from 'next/link'
import { BRAND } from '@/lib/brand'
import { absoluteMediaUrl } from '@/lib/blob'

/**
 * Somnia — public, unlisted share page for a finished dream.
 *
 * No auth: the opaque token in the URL IS the capability. Server-rendered
 * with zero client JS (plain <video> + inline SVG logo) so it lands fast
 * and crawls cleanly. Unlisted by design: noindex meta and robots.txt
 * exclude /share/. Revoking the share nulls the token server-side and this
 * route immediately renders the unavailable state.
 *
 * Statelessly fetches GET /api/jobs/shared/:token so it reads exactly the
 * instance where the token was minted (single serverless function / tmp).
 */

export const dynamic = 'force-dynamic'

interface SharedJobPayload {
  job: {
    id: string
    prompt: string
    model: string
    resolution: string
    aspectRatio: string
    durationSec: number
    loop: boolean
    hdr: boolean
    createdAt: string
    /** T14 render truth — the imagery is placeholder art (demo tier). */
    placeholderRender?: boolean
  }
  author: { name: string; avatarSeed: string }
  likeCount: number
  videoPath: string | null
  /** The dream's still (poster / middle keyframe) — OG image + video poster. */
  posterPath: string | null
}

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, '')
}

async function fetchSharedJob(token: string): Promise<SharedJobPayload | null> {
  try {
    const response = await fetch(`${siteUrl()}/api/jobs/shared/${token}`, { cache: 'no-store' })
    if (!response.ok) return null
    const data: unknown = await response.json()
    if (
      data &&
      typeof data === 'object' &&
      'job' in data &&
      'author' in data &&
      typeof (data as { job: { prompt?: unknown } }).job.prompt === 'string'
    ) {
      return data as SharedJobPayload
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
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

const NOINDEX = { index: false, follow: false }

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>
}): Promise<Metadata> {
  const { token } = await params
  const payload = await fetchSharedJob(token)
  if (!payload) {
    return { title: `${BRAND.name} — share link not available`, robots: NOINDEX }
  }
  const title = `${BRAND.name} — ${excerpt(payload.job.prompt, 60)}`
  const description = excerpt(payload.job.prompt, 180)
  const base = siteUrl()
  // blob URLs pass through untouched; /generated paths join onto the site URL
  const ogVideo = absoluteMediaUrl(payload.videoPath, base)
  const ogImage = absoluteMediaUrl(payload.posterPath, base)
  return {
    title,
    description,
    robots: NOINDEX,
    metadataBase: new URL(base),
    openGraph: {
      title,
      description,
      type: 'video.other',
      ...(ogVideo ? { videos: [{ url: ogVideo, type: 'video/mp4' }] } : {}),
      ...(ogImage ? { images: [{ url: ogImage }] } : {}),
    },
    // a real still beats an incomplete player card: summary_large_image
    // renders everywhere; the text-only summary is the honest fallback
    twitter: ogImage
      ? { card: 'summary_large_image', title, description, images: [ogImage] }
      : ogVideo
        ? { card: 'player', title, description }
        : { card: 'summary', title, description },
  }
}

function SomniaMark(): React.ReactElement {
  return (
    <svg viewBox="0 0 48 48" className="size-8" role="img" aria-label={`${BRAND.name} logo`}>
      <defs>
        <linearGradient id="somnia-glow" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="55%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#d946ef" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="12" fill="#09090b" stroke="url(#somnia-glow)" strokeWidth="2.5" />
      <path
        d="M30 17.5c-1.6-2-4-3-6.8-3-3.9 0-6.7 2-6.7 4.8 0 2.6 2.2 3.9 6 4.7 4.4.9 7 2.4 7 6 0 3.2-3 5.5-7.3 5.5-3.3 0-6.1-1.2-7.7-3.3"
        fill="none"
        stroke="url(#somnia-glow)"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-zinc-700/80 bg-zinc-900/60 px-3 py-1 text-xs text-zinc-300">
      {children}
    </span>
  )
}

function ShareUnavailable(): React.ReactElement {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-zinc-100">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-800/60">
          <svg viewBox="0 0 24 24" className="size-7 text-zinc-400" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold tracking-tight">This share link is not available</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          The dream&rsquo;s owner may have revoked the link, or it never existed. Share links are
          unlisted — only someone holding the exact link can view a render.
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

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>
}): Promise<React.ReactElement> {
  const { token } = await params
  const payload = await fetchSharedJob(token)
  if (!payload) return <ShareUnavailable />

  const { job, author, likeCount, videoPath, posterPath } = payload

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Ambient indigo glow — the Somnia night sky. */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_at_top,rgba(139,92,246,0.16),transparent_65%)]"
        aria-hidden="true"
      />

      <header className="relative border-b border-zinc-800/70">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex items-center gap-2.5">
            <SomniaMark />
            <span className="text-base font-semibold tracking-tight">{BRAND.name}</span>
            <span className="ml-1 hidden rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-300 sm:inline">
              shared dream
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

      <article className="relative mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-10">
        <h1 className="sr-only">Shared dream: {excerpt(job.prompt, 80)}</h1>

        {videoPath ? (
          <div className={`overflow-hidden rounded-2xl border border-zinc-800 bg-black ${aspectStyle(job.aspectRatio)}`}>
            <video
              src={videoPath}
              poster={posterPath ?? undefined}
              controls
              muted
              loop={job.loop}
              playsInline
              preload="metadata"
              className="size-full object-contain"
            />
          </div>
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/60 text-sm text-zinc-500">
            The render is not available.
          </div>
        )}

        <section className="mt-6 space-y-4">
          <p className="text-base leading-relaxed text-zinc-200">{job.prompt}</p>

          <div className="flex flex-wrap items-center gap-2">
            <MetaChip>{job.model}</MetaChip>
            <MetaChip>{job.resolution}</MetaChip>
            <MetaChip>{job.aspectRatio}</MetaChip>
            {job.durationSec > 0 && <MetaChip>{job.durationSec}s</MetaChip>}
            {job.loop && <MetaChip>loop</MetaChip>}
            {job.hdr && <MetaChip>HDR</MetaChip>}
            {job.placeholderRender && <MetaChip>simulated render</MetaChip>}
            <MetaChip>{formatDate(job.createdAt)}</MetaChip>
          </div>

          <div className="flex items-center gap-3 border-t border-zinc-800/70 pt-4 text-sm text-zinc-400">
            <span
              aria-hidden="true"
              className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-fuchsia-400 text-xs font-semibold uppercase text-white"
            >
              {author.name.slice(0, 1)}
            </span>
            <span>
              dreamed by <span className="font-medium text-zinc-200">{author.name}</span>
            </span>
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-zinc-700/80 bg-zinc-900/60 px-3 py-1 text-xs text-zinc-300">
              <span aria-hidden="true" className="text-rose-400">
                ♥
              </span>
              {likeCount}
            </span>
          </div>
        </section>

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
