import type { JobDto } from '@/lib/types'
import type { Metadata } from 'next'
import Link from 'next/link'

/**
 * Phase 5 — public, unlisted share page for a finished render.
 *
 * No auth: the 32-hex token in the URL IS the capability. The page is
 * server-rendered with zero client JS (plain <video>/<img> + inline SVG logo)
 * so it lands fast and crawls cleanly. Unlisted by design: noindex meta and
 * robots.txt exclude /share/. Revoking the share in the app nulls the token
 * and this route immediately renders the unavailable state.
 *
 * Phase 6: the page is STATELESS — it fetches the share payload from the
 * consolidated API function (GET /api/jobs/shared/:token) instead of reading
 * the database directly, so on serverless it reads exactly the state where
 * the token was minted (single shared /tmp), and locally behaves identically.
 */

export const dynamic = 'force-dynamic'

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, '')
}

/** Fetch the public share payload from the consolidated API function. */
async function fetchSharedJob(token: string): Promise<JobDto | null> {
  try {
    const response = await fetch(`${siteUrl()}/api/jobs/shared/${token}`, {
      cache: 'no-store',
    })
    if (!response.ok) return null
    const data: unknown = await response.json()
    if (data && typeof data === 'object' && 'id' in data && 'prompt' in data) {
      return data as JobDto
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

const ASPECT_CLASS: Record<string, string> = {
  '16:9': 'aspect-video',
  '9:16': 'aspect-[9/16]',
  '1:1': 'aspect-square',
}

function aspectClass(ratio: string): string {
  return ASPECT_CLASS[ratio] ?? 'aspect-video'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function ShareLogoMark(): React.ReactElement {
  return (
    <svg viewBox="0 0 48 48" className="size-8" role="img" aria-label="Reelforge logo">
      <defs>
        <linearGradient id="rf-ember" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#fbbf24" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="12" fill="#18181b" stroke="url(#rf-ember)" strokeWidth="2.5" />
      <path
        d="M24 9c-6.6 0-12 5.4-12 12s5.4 12 12 12h9.5c1.4 0 2.5-1.1 2.5-2.5V21c0-6.6-5.4-12-12-12z"
        fill="url(#rf-ember)"
        opacity="0.92"
      />
      <circle cx="19.5" cy="21" r="2.4" fill="#18181b" />
      <circle cx="28.5" cy="17.5" r="2.4" fill="#18181b" />
      <circle cx="28.5" cy="24.5" r="2.4" fill="#18181b" />
      <path d="M14 39h20" stroke="url(#rf-ember)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700/80 bg-zinc-900/60 px-3 py-1 text-xs text-zinc-300">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
      <span className="font-medium text-zinc-200">{value}</span>
    </span>
  )
}

const NOINDEX = { index: false, follow: false }

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>
}): Promise<Metadata> {
  const { token } = await params
  const job = await fetchSharedJob(token)
  if (!job) {
    return {
      title: 'Reelforge — share link not available',
      robots: NOINDEX,
    }
  }
  const title = `Reelforge — ${excerpt(job.prompt, 60)}`
  const description = excerpt(job.prompt, 180)
  const base = siteUrl()
  const ogImage = job.frames[0] ? `${base}${job.frames[0]}` : undefined
  const ogVideo = job.videoPath ? `${base}${job.videoPath}` : undefined
  return {
    title,
    description,
    robots: NOINDEX,
    metadataBase: new URL(base),
    openGraph: {
      title,
      description,
      type: 'video.other',
      ...(ogImage ? { images: [{ url: ogImage, alt: excerpt(job.prompt, 80) }] } : {}),
      ...(ogVideo ? { videos: [{ url: ogVideo, type: 'video/mp4' }] } : {}),
    },
    twitter: {
      card: ogVideo ? 'player' : 'summary_large_image',
      title,
      description,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  }
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
        <h1 className="text-lg font-bold tracking-tight">This share link is not available</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          The link may have been revoked by its owner, or it never existed. Share links are
          unlisted — only someone with the exact link can view a render.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-orange-500 px-5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-orange-400"
        >
          Visit Reelforge
        </Link>
      </div>
    </main>
  )
}

function VariantClip({
  kind,
  label,
  path,
}: {
  kind: 'reframe' | 'camera' | 'restyle'
  label: string | null
  path: string
}) {
  const kindLabel = kind === 'reframe' ? 'Reframe' : kind === 'camera' ? 'Camera move' : 'Restyle'
  return (
    <figure className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
      <video
        src={path}
        controls
        muted
        loop
        playsInline
        preload="metadata"
        className="aspect-video w-full bg-black object-contain"
      />
      <figcaption className="flex items-center justify-between gap-2 border-t border-zinc-800 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-orange-400/90">
          {kindLabel}
        </span>
        <span className="truncate text-xs text-zinc-400">{label ?? 'variant'}</span>
      </figcaption>
    </figure>
  )
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>
}): Promise<React.ReactElement> {
  const { token } = await params
  const job: JobDto | null = await fetchSharedJob(token)
  if (!job) return <ShareUnavailable />

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Ambient ember glow — matches the studio's dark + orange brand. */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_at_top,rgba(249,115,22,0.14),transparent_65%)]"
        aria-hidden="true"
      />

      <header className="relative border-b border-zinc-800/70">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex items-center gap-2.5">
            <ShareLogoMark />
            <span className="text-base font-bold tracking-tight">Reelforge</span>
            <span className="ml-1 hidden rounded-full border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-orange-400 sm:inline">
              shared render
            </span>
          </div>
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900/60 px-4 text-xs font-semibold text-zinc-200 transition-colors hover:border-orange-500/50 hover:text-orange-400"
          >
            Open the studio
          </Link>
        </div>
      </header>

      <article className="relative mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-10">
        <h1 className="sr-only">Shared render: {excerpt(job.prompt, 80)}</h1>

        {job.videoPath ? (
          <div
            className={`w-full overflow-hidden rounded-2xl border border-orange-500/25 bg-black shadow-[0_0_60px_-15px_rgba(249,115,22,0.25)] ${aspectClass(job.aspectRatio)}`}
          >
            <video
              src={job.videoPath}
              controls
              autoPlay
              loop
              playsInline
              preload="metadata"
              poster={job.frames[0] ?? job.startFramePath ?? undefined}
              className="h-full w-full object-contain"
            />
          </div>
        ) : job.frames[0] ? (
          <img
            src={job.frames[0]}
            alt={`Keyframe of: ${excerpt(job.prompt, 80)}`}
            className={`w-full rounded-2xl border border-zinc-800 object-cover ${aspectClass(job.aspectRatio)}`}
          />
        ) : null}

        <section className="mt-6">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Prompt</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-zinc-200">{job.prompt}</p>
        </section>

        <section className="mt-5 flex flex-wrap gap-2" aria-label="Render details">
          <MetaChip label="tier" value={job.tier === 'quality' ? 'Quality' : 'Draft'} />
          <MetaChip label="length" value={`${job.durationSec}s`} />
          <MetaChip label="aspect" value={job.aspectRatio} />
          {job.board && <MetaChip label="board" value={job.board} />}
          <MetaChip label="engine" value={job.provider} />
          <MetaChip label="created" value={formatDate(job.createdAt)} />
          {job.editVersion > 1 && <MetaChip label="edit" value={`v${job.editVersion}`} />}
        </section>

        {job.frames.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Keyframes
            </h2>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {job.frames.slice(0, 6).map((frame, index) => (
                <li key={frame} className="list-none">
                  <figure className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
                    <img
                      src={frame}
                      alt={`Keyframe ${index + 1} of: ${excerpt(job.prompt, 48)}`}
                      loading="lazy"
                      className="aspect-video w-full object-cover"
                    />
                    <figcaption className="px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                      keyframe {index + 1}
                    </figcaption>
                  </figure>
                </li>
              ))}
            </ul>
          </section>
        )}

        {job.variants.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Variants
            </h2>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {job.variants.map((variant) => (
                <li key={`${variant.kind}-${variant.path}`} className="list-none">
                  <VariantClip kind={variant.kind} label={variant.label} path={variant.path} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>

      <footer className="relative border-t border-zinc-800/70">
        <div className="mx-auto flex max-w-4xl flex-col gap-2 px-5 py-6 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>
            Made with <span className="font-semibold text-zinc-400">Reelforge</span> — an original
            clean-room AI video studio. Unlisted link: anyone with it can view this render.
          </p>
          <Link href="/" className="font-semibold text-orange-400/90 hover:text-orange-400">
            reelforge →
          </Link>
        </div>
      </footer>
    </main>
  )
}
