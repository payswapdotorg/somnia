'use client'

import { AppShellNav } from '@/components/reelforge/app-nav'
import { KindChip, StatusChip, TierChip, excerpt, formatTimestamp } from '@/components/reelforge/bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { RESTYLE_CREDITS } from '@/lib/pricing'
import { RESTYLE_STYLES, restyleStyle, type RestyleStyleId } from '@/lib/styles'
import type { JobDto } from '@/lib/types'
import type { JobStatus } from '@/lib/types'
import { ArrowRight, Clapperboard, History as HistoryIcon, Link2, Loader2, Palette } from 'lucide-react'
import Link from 'next/link'
import * as React from 'react'

/**
 * Phase 9 (N3): dedicated history surface — "My forges".
 *
 * The studio's job list surfaced at app level with the asset-library grammar:
 * kind/status filters, media thumbnails, remix actions that prefill the
 * composer, and share links. Non-terminal jobs live-poll so the grid heals
 * itself while forges run.
 */

type KindFilter = 'all' | 'video' | 'image'
type StatusFilter = 'all' | 'active' | 'completed' | 'failed'

const KIND_FILTERS: Array<{ id: KindFilter; label: string }> = [
  { id: 'all', label: 'All forges' },
  { id: 'video', label: 'Video' },
  { id: 'image', label: 'Stills' },
]

const STATUS_FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: 'all', label: 'Any status' },
  { id: 'active', label: 'In flight' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
]

const TERMINAL: JobStatus[] = ['completed', 'failed']

function isActive(job: JobDto): boolean {
  return !TERMINAL.includes(job.status)
}

function remixHref(job: JobDto): string {
  const params = new URLSearchParams({
    mode: job.kind,
    prompt: job.prompt,
    tier: job.tier,
    aspect: job.aspectRatio,
    from: 'history',
  })
  if (job.kind === 'video' && job.durationSec > 0) params.set('duration', String(job.durationSec))
  return `/?${params.toString()}`
}

function ForgeCard({ job, onRestyled }: { job: JobDto; onRestyled?: () => void }) {
  const { toast } = useToast()
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const thumb = job.frames[0] ?? job.startFramePath ?? null
  const [restyling, setRestyling] = React.useState(false)
  const [styleOpen, setStyleOpen] = React.useState(false)
  const [styleId, setStyleId] = React.useState<RestyleStyleId>('noir')

  const play = () => {
    if (job.kind !== 'video' || !job.videoPath) return
    const video = videoRef.current
    if (!video) return
    video.currentTime = 0
    void video.play().catch(() => {
      /* autoplay guard */
    })
  }
  const stop = () => videoRef.current?.pause()

  const canRestyle = job.kind === 'video' && job.status === 'completed' && Boolean(job.videoPath)

  const submitRestyle = async (event: React.FormEvent) => {
    event.preventDefault()
    if (restyling) return
    setRestyling(true)
    try {
      const response = await fetch(`/api/jobs/${job.id}/restyle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ style: styleId }),
      })
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
      if (response.ok && data.variant) {
        const label = (data.variant as { label?: string }).label ?? restyleStyle(styleId)?.label ?? styleId
        toast({
          title: data.alreadyExisted ? 'Restyle ready' : 'Restyle applied',
          description: data.alreadyExisted
            ? `The “${label}” variant is ready — no new charge.`
            : `${label} — ${data.creditsCharged ?? 0} credits. Open the Studio to watch it.`,
        })
        setStyleOpen(false)
        onRestyled?.()
      } else if (response.status === 402) {
        toast({
          variant: 'destructive',
          title: 'Not enough credits',
          description: (data.message as string) ?? 'This restyle costs more credits than you have.',
        })
      } else {
        toast({
          variant: 'destructive',
          title: 'Could not apply the restyle',
          description: (data.message as string) ?? 'Something went wrong. Please try again.',
        })
      }
    } catch {
      toast({
        variant: 'destructive',
        title: 'Network error',
        description: 'Could not reach the studio server. Please try again.',
      })
    } finally {
      setRestyling(false)
    }
  }

  return (
    <article
      className="group flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/60 transition-colors hover:border-primary/40"
      onMouseEnter={play}
      onMouseLeave={stop}
    >
      <Link href={remixHref(job)} className="relative block aspect-video overflow-hidden" aria-label={`Remix: ${job.prompt}`}>
        {job.kind === 'video' && job.videoPath && job.status === 'completed' ? (
          <video
            ref={videoRef}
            src={job.videoPath}
            poster={thumb ?? undefined}
            muted
            loop
            playsInline
            preload="none"
            className="size-full object-cover"
          />
        ) : thumb ? (
          <img src={thumb} alt={excerpt(job.prompt, 48)} loading="lazy" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center bg-muted/40 text-muted-foreground">
            {isActive(job) ? (
              <Loader2 className="size-8 animate-spin" aria-hidden="true" />
            ) : (
              <Clapperboard className="size-8" aria-hidden="true" />
            )}
          </div>
        )}

        {isActive(job) ? (
          <span className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-black/25">
            <span
              className="block h-full bg-primary transition-all"
              style={{ width: `${Math.min(100, Math.max(4, job.progress))}%` }}
            />
          </span>
        ) : null}

        <span className="absolute right-3 top-3">
          <StatusChip status={job.status} />
        </span>
      </Link>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <KindChip kind={job.kind} />
          <TierChip tier={job.tier} />
          {job.editVersion > 1 ? (
            <Badge variant="outline" className="rounded-full text-[11px]">
              v{job.editVersion}
            </Badge>
          ) : null}
          {job.board ? (
            <Badge variant="outline" className="rounded-full text-[11px]">
              {job.board}
            </Badge>
          ) : null}
        </div>

        <p className="text-sm leading-relaxed text-foreground/90">{excerpt(job.prompt, 110)}</p>

        <p className="mt-auto text-xs text-muted-foreground tabular-nums">
          {formatTimestamp(job.createdAt)} · {job.creditsCharged} cr
          {job.kind === 'video' ? ` · ${job.durationSec}s` : ''}
          {job.shareToken ? ' · shared' : ''}
        </p>

        <div className="flex items-center gap-2">
          <Button asChild size="sm" className="h-9 flex-1 rounded-xl">
            <Link href={remixHref(job)}>
              Remix
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </Button>
          {canRestyle ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 rounded-xl"
              title="Re-render this clip through a style grade"
              onClick={() => {
                setStyleId('noir')
                setStyleOpen(true)
              }}
            >
              <Palette className="size-3.5" aria-hidden="true" />
              Restyle
            </Button>
          ) : null}
          <Button asChild variant="outline" size="sm" className="h-9 rounded-xl">
            <Link href="/studio">Studio</Link>
          </Button>
          {job.shareToken ? (
            <Button asChild variant="outline" size="sm" className="h-9 rounded-xl px-3" title="Open share page">
              <Link href={`/share/${job.shareToken}`} aria-label="Open share page">
                <Link2 className="size-3.5" aria-hidden="true" />
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      {/* Restyle picker (Phase 11, N5) — same catalogue as the Studio. */}
      <Dialog open={styleOpen} onOpenChange={setStyleOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-left">
              <Palette className="size-4 text-primary" aria-hidden="true" />
              Restyle clip
            </DialogTitle>
            <DialogDescription className="text-left">
              Re-render “{excerpt(job.prompt, 48)}” through a colour grade — {RESTYLE_CREDITS} credits,
              flat.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitRestyle} noValidate>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Restyle grade">
              {RESTYLE_STYLES.map((style) => {
                const isSelected = styleId === style.id
                return (
                  <button
                    key={style.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setStyleId(style.id)}
                    className={`flex min-h-11 items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                      isSelected
                        ? 'border-primary bg-primary/15'
                        : 'border-border bg-background/40 hover:border-primary/40'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`size-8 shrink-0 rounded-full bg-gradient-to-br ${style.swatch}`}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{style.label}</span>
                      <span className="block text-xs text-muted-foreground">{style.blurb}</span>
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" className="h-9 rounded-xl" onClick={() => setStyleOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" className="h-9 rounded-xl px-4" disabled={restyling}>
                {restyling ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Palette className="size-3.5" aria-hidden="true" />}
                Apply grade
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </article>
  )
}

export function HistoryApp() {
  const [jobs, setJobs] = React.useState<JobDto[] | null>(null)
  const [kindFilter, setKindFilter] = React.useState<KindFilter>('all')
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all')

  const refresh = React.useCallback(async () => {
    try {
      const response = await fetch('/api/jobs')
      if (!response.ok) return
      const data = (await response.json()) as { jobs: JobDto[] }
      setJobs(data.jobs)
    } catch {
      /* transient — keep the last list */
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  // Live-poll while any forge is in flight.
  React.useEffect(() => {
    if (!jobs?.some(isActive)) return
    const timer = window.setInterval(() => void refresh(), 2500)
    return () => window.clearInterval(timer)
  }, [jobs, refresh])

  const visible = React.useMemo(() => {
    if (!jobs) return null
    return jobs.filter((job) => {
      if (kindFilter !== 'all' && job.kind !== kindFilter) return false
      if (statusFilter === 'active' && !isActive(job)) return false
      if (statusFilter === 'completed' && job.status !== 'completed') return false
      if (statusFilter === 'failed' && job.status !== 'failed') return false
      return true
    })
  }, [jobs, kindFilter, statusFilter])

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <AppShellNav current="/history" />

      <main className="flex-1">
        <div className="rf-composer-glow border-b border-border/40">
          <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 sm:py-14">
            <p className="text-center text-xs font-semibold uppercase tracking-[0.3em] text-primary">
              Asset library
            </p>
            <h1 className="rf-display-glow mt-3 text-center text-3xl font-extrabold uppercase tracking-wide sm:text-5xl">
              My Forges
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-center text-sm text-muted-foreground sm:text-base">
              Everything this studio has forged — clips, stills, edits and their recipes. Remix any
              entry to reload its exact settings in the composer.
            </p>
          </div>
        </div>

        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 pt-8" role="group" aria-label="Filter forges">
            {KIND_FILTERS.map((option) => {
              const active = kindFilter === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setKindFilter(option.id)}
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
            <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
            {STATUS_FILTERS.map((option) => {
              const active = statusFilter === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setStatusFilter(option.id)}
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
            {jobs ? (
              <Badge variant="outline" className="ml-auto rounded-full tabular-nums">
                {jobs.length} total
              </Badge>
            ) : null}
          </div>

          {/* Grid */}
          <div className="py-8">
            {visible === null ? (
              <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
                <Loader2 className="size-8 animate-spin" aria-hidden="true" />
                <p className="text-sm">Loading your forges…</p>
              </div>
            ) : visible.length === 0 ? (
              <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border/70 py-16 text-center">
                <HistoryIcon className="size-10 text-muted-foreground/60" aria-hidden="true" />
                <div>
                  <p className="text-lg font-semibold tracking-tight">Nothing here yet</p>
                  <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                    No forges match this filter. Clear it, or head to the composer and put the
                    studio to work.
                  </p>
                </div>
                <Button asChild size="lg" className="h-12 rounded-xl px-6">
                  <Link href="/">
                    Forge something
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {visible.map((job) => (
                  <ForgeCard key={job.id} job={job} onRestyled={() => void refresh()} />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="border-t border-border/40 py-8">
        <p className="text-center text-xs text-muted-foreground">
          Reelforge — an original clean-room studio. Remix keeps the recipe, you keep the credit
          ledger honest.
        </p>
      </footer>
    </div>
  )
}
