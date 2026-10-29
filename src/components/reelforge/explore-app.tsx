'use client'

import { AppShellNav } from '@/components/reelforge/app-nav'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EXPLORE_ENTRIES, EXPLORE_FILTERS, remixHref, type ExploreEntry } from '@/lib/explore'
import { ArrowRight, Clapperboard, Image as ImageIcon, Play, Sparkles } from 'lucide-react'
import Link from 'next/link'
import * as React from 'react'

/**
 * Phase 9 (N2): community gallery + remix loop.
 *
 * Clean-room note: this follows the shared community-gallery LAYOUT grammar
 * (filter chips, media tiles with prompt captions and a one-tap remix) while
 * every tile is Reelforge's own output and every remix deep-links THIS
 * product's composer with the recipe prefilled.
 */

function GalleryTile({ entry }: { entry: ExploreEntry }) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null)

  const play = () => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = 0
    void video.play().catch(() => {
      /* autoplay guard — poster remains */
    })
  }

  const stop = () => {
    videoRef.current?.pause()
  }

  const isVideo = entry.kind === 'video'

  return (
    <article
      className={`group relative overflow-hidden rounded-2xl border border-border/70 bg-card/60 ${
        entry.featured ? 'sm:col-span-2 sm:row-span-2' : ''
      }`}
      onMouseEnter={play}
      onMouseLeave={stop}
    >
      <Link href={remixHref(entry)} className="block" aria-label={`Remix: ${entry.prompt}`}>
        <div className="relative aspect-video w-full overflow-hidden">
          {isVideo ? (
            <video
              ref={videoRef}
              src={entry.src}
              poster={entry.poster}
              muted
              loop
              playsInline
              preload="none"
              className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            />
          ) : (
            <img
              src={entry.src}
              alt={entry.prompt}
              loading="lazy"
              className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            />
          )}

          {/* Kind badge */}
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
            {isVideo ? (
              <>
                <Clapperboard className="size-3.5" aria-hidden="true" />
                {entry.seconds}s · {entry.tier === 'quality' ? 'Quality' : 'Draft'}
              </>
            ) : (
              <>
                <ImageIcon className="size-3.5" aria-hidden="true" />
                Still · {entry.tier === 'quality' ? 'Quality' : 'Draft'}
              </>
            )}
          </span>

          {/* Hover play affordance */}
          {isVideo ? (
            <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100">
              <span className="flex size-12 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
                <Play className="size-5 translate-x-0.5" aria-hidden="true" />
              </span>
            </span>
          ) : null}

          {/* Prompt caption */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent p-4 pt-10">
            <p className="line-clamp-2 text-sm font-medium text-white drop-shadow-sm">
              {entry.prompt}
            </p>
          </div>
        </div>
      </Link>

      <div className="flex items-center justify-between gap-3 p-4">
        <p className="min-w-0 truncate text-xs text-muted-foreground" title={entry.prompt}>
          {entry.aspectRatio}
        </p>
        <Button asChild size="sm" className="h-9 rounded-xl px-3">
          <Link href={remixHref(entry)}>
            Remix this
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </article>
  )
}

export function ExploreApp() {
  const [filter, setFilter] = React.useState<'all' | 'video' | 'image'>('all')

  const visible = React.useMemo(
    () => (filter === 'all' ? EXPLORE_ENTRIES : EXPLORE_ENTRIES.filter((e) => e.kind === filter)),
    [filter]
  )

  const videoCount = EXPLORE_ENTRIES.filter((e) => e.kind === 'video').length
  const imageCount = EXPLORE_ENTRIES.filter((e) => e.kind === 'image').length

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <AppShellNav current="/explore" />

      <main className="flex-1">
        {/* Headline */}
        <div className="rf-composer-glow border-b border-border/40">
          <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
            <p className="text-center text-xs font-semibold uppercase tracking-[0.3em] text-primary">
              Community gallery
            </p>
            <h1 className="rf-display-glow mt-3 text-center text-3xl font-extrabold uppercase tracking-wide sm:text-5xl">
              Forged by the Forge
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-center text-sm text-muted-foreground sm:text-base">
              {videoCount} clips and {imageCount} stills forged inside this studio. Hover to play,
              remix to load the exact recipe into your composer and make it yours.
            </p>
          </div>
        </div>

        {/* Filter chips */}
        <div className="mx-auto w-full max-w-7xl px-4 pt-8 sm:px-6">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter gallery">
            {EXPLORE_FILTERS.map((option) => {
              const active = filter === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setFilter(option.id)}
                  aria-pressed={active}
                  className={
                    active
                      ? 'h-10 rounded-full border border-primary/50 bg-primary/15 px-4 text-sm font-semibold text-primary'
                      : 'h-10 rounded-full border border-border/60 px-4 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground'
                  }
                >
                  {option.label}
                </button>
              )
            })}
            <Badge variant="outline" className="ml-auto hidden gap-1.5 rounded-full sm:inline-flex">
              <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
              Every tile is real studio output
            </Badge>
          </div>

          {/* Gallery grid */}
          <div className="grid grid-cols-1 gap-4 py-8 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((entry) => (
              <GalleryTile key={entry.slug} entry={entry} />
            ))}
          </div>

          {/* Remix CTA */}
          <div className="mb-14 rounded-2xl border border-primary/30 bg-primary/5 p-6 text-center sm:p-8">
            <h2 className="text-lg font-bold tracking-tight sm:text-xl">See one you like?</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
              Remix loads the prompt, engine tier, aspect ratio and duration straight into the
              composer — nudge a word or two and forge your own take.
            </p>
            <Button asChild size="lg" className="mt-5 h-12 rounded-xl px-6">
              <Link href="/">
                Open the composer
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </main>

      <footer className="border-t border-border/40 py-8">
        <p className="text-center text-xs text-muted-foreground">
          Reelforge — an original clean-room studio. Gallery media generated by this build.
        </p>
      </footer>
    </div>
  )
}
