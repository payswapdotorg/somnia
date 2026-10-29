'use client'

import { excerpt } from '@/components/reelforge/bits'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { Download, ExternalLink, Film, Images, Link2, Link2Off, Play, Share2, Shuffle } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/utils'
import type { JobDto } from '@/lib/types'

/** Clipboard with a legacy fallback so the share link always copies if possible. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(area)
    return copied
  } catch {
    return false
  }
}

type GalleryItem =
  | {
      kind: 'video'
      key: string
      videoPath: string
      poster: string | null
      prompt: string
      aspectRatio: string
      board: string | null
      source: JobDto
    }
  | {
      kind: 'image'
      key: string
      frame: string
      index: number
      prompt: string
      aspectRatio: string
      board: string | null
      source: JobDto
    }

/** Responsive gallery: finished clips play on hover; older jobs show stills. */
export function GalleryTab({
  jobs,
  onOpenStudio,
  onRemix,
}: {
  jobs: JobDto[]
  onOpenStudio: () => void
  /** Phase 3: prefill the Studio with this job's recipe (no charge). */
  onRemix: (job: JobDto) => void
}) {
  const { toast } = useToast()
  const [boardFilter, setBoardFilter] = React.useState<string>('__all__')
  const [opened, setOpened] = React.useState<GalleryItem | null>(null)
  // Phase 5: local share-token overrides survive the 1.5s jobs polling that
  // wholesale-replaces the jobs prop (the API round-trip lags one poll tick).
  const [shareOverrides, setShareOverrides] = React.useState<Record<string, string | null>>({})
  const [shareBusyJobId, setShareBusyJobId] = React.useState<string | null>(null)

  const shareUrlOf = React.useCallback((token: string) => {
    const origin = typeof window === 'undefined' ? '' : window.location.origin
    return `${origin}/share/${token}`
  }, [])

  const jobsResolved = React.useMemo(
    () =>
      jobs.map((job) =>
        job.id in shareOverrides ? { ...job, shareToken: shareOverrides[job.id] ?? null } : job
      ),
    [jobs, shareOverrides]
  )

  /** Current token for the dialog, resolved from live state (not the snapshot). */
  const dialogShareToken = React.useMemo(() => {
    if (!opened) return null
    const live = jobsResolved.find((job) => job.id === opened.source.id)
    return live?.shareToken ?? null
  }, [opened, jobsResolved])

  const enableShare = React.useCallback(
    async (jobId: string) => {
      setShareBusyJobId(jobId)
      try {
        const response = await fetch(`/api/jobs/${jobId}/share`, { method: 'POST' })
        const data = (await response.json()) as { shareToken?: string; message?: string }
        if (!response.ok || !data.shareToken) {
          throw new Error(data.message || `Share failed (${response.status})`)
        }
        setShareOverrides((prev) => ({ ...prev, [jobId]: data.shareToken as string }))
        const copied = await copyText(shareUrlOf(data.shareToken))
        toast({
          title: 'Share link created',
          description: copied
            ? 'The unlisted link was copied to your clipboard.'
            : 'Copy it from the share panel below.',
        })
      } catch (error) {
        toast({
          title: 'Could not create the share link',
          description: error instanceof Error ? error.message : 'Unexpected error',
          variant: 'destructive',
        })
      } finally {
        setShareBusyJobId(null)
      }
    },
    [shareUrlOf, toast]
  )

  const disableShare = React.useCallback(
    async (jobId: string) => {
      setShareBusyJobId(jobId)
      try {
        const response = await fetch(`/api/jobs/${jobId}/share`, { method: 'DELETE' })
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { message?: string }
          throw new Error(data.message || `Revoke failed (${response.status})`)
        }
        setShareOverrides((prev) => ({ ...prev, [jobId]: null }))
        toast({
          title: 'Sharing stopped',
          description: 'The link no longer resolves for anyone who had it.',
        })
      } catch (error) {
        toast({
          title: 'Could not stop sharing',
          description: error instanceof Error ? error.message : 'Unexpected error',
          variant: 'destructive',
        })
      } finally {
        setShareBusyJobId(null)
      }
    },
    [toast]
  )

  const copyShareLink = React.useCallback(
    async (token: string) => {
      const copied = await copyText(shareUrlOf(token))
      toast({
        title: copied ? 'Link copied' : 'Copy failed',
        description: copied
          ? 'Paste it anywhere — anyone with the link can view this render.'
          : 'Select the link text and copy it manually.',
        variant: copied ? undefined : 'destructive',
      })
    },
    [shareUrlOf, toast]
  )

  const boards = React.useMemo(() => {
    const names = new Set<string>()
    for (const job of jobs) {
      if (job.board) names.add(job.board)
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }, [jobs])

  const completed = React.useMemo(
    () =>
      jobsResolved.filter(
        (job) =>
          job.status === 'completed' &&
          (boardFilter === '__all__' ||
            (boardFilter === '__none__' ? !job.board : job.board === boardFilter))
      ),
    [jobsResolved, boardFilter]
  )

  const items: GalleryItem[] = React.useMemo(() => {
    const out: GalleryItem[] = []
    for (const job of completed) {
      if (job.videoPath) {
        out.push({
          kind: 'video',
          key: `${job.id}-video`,
          videoPath: job.videoPath,
          poster: job.frames[0] ?? job.startFramePath ?? null,
          prompt: job.prompt,
          aspectRatio: job.aspectRatio,
          board: job.board,
          source: job,
        })
      } else {
        job.frames.forEach((frame, index) => {
          out.push({
            kind: 'image',
            key: `${job.id}-${index}`,
            frame,
            index,
            prompt: job.prompt,
            aspectRatio: job.aspectRatio,
            board: job.board,
            source: job,
          })
        })
      }
    }
    return out
  }, [completed])

  const hoverVideo = React.useCallback((element: HTMLVideoElement | null, play: boolean) => {
    if (!element) return
    if (play) {
      element.muted = true
      void element.play().catch(() => undefined)
    } else {
      element.pause()
      element.currentTime = 0
    }
  }, [])

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-card/40 px-6 py-16 text-center">
        <Images className="size-10 text-muted-foreground/50" aria-hidden="true" />
        <div>
          <p className="font-semibold">The gallery is empty</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Finished clips and keyframes from your renders will show up here.
          </p>
        </div>
        <Button onClick={onOpenStudio} className="h-11 min-w-11 rounded-xl px-5">
          Create your first render
        </Button>
      </div>
    )
  }

  const aspectClass = (ratio: string) =>
    ratio === '16:9' ? 'aspect-video' : ratio === '9:16' ? 'aspect-[9/16]' : 'aspect-square'

  return (
    <div>
      <h2 className="sr-only">Gallery</h2>

      {boards.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filter gallery by board">
          <span className="text-xs font-medium text-muted-foreground">Boards:</span>
          {[{ value: '__all__', label: 'All' }, { value: '__none__', label: 'No board' }].map(
            (chip) => (
              <button
                key={chip.value}
                type="button"
                aria-pressed={boardFilter === chip.value}
                onClick={() => setBoardFilter(chip.value)}
                className={cn(
                  'h-11 min-w-11 rounded-full border px-4 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  boardFilter === chip.value
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-border bg-background/40 text-muted-foreground hover:border-primary/40 hover:text-foreground'
                )}
              >
                {chip.label}
              </button>
            )
          )}
          {boards.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={boardFilter === name}
              onClick={() => setBoardFilter(name)}
              className={cn(
                'h-11 min-w-11 rounded-full border px-4 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                boardFilter === name
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-border bg-background/40 text-muted-foreground hover:border-primary/40 hover:text-foreground'
              )}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li key={item.key} className="list-none">
            <figure className="group relative overflow-hidden rounded-xl border border-border bg-card">
              {item.kind === 'video' ? (
                <button
                  type="button"
                  className={`relative block w-full ${aspectClass(item.aspectRatio)} overflow-hidden bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`}
                  onMouseEnter={(event) => hoverVideo(event.currentTarget.querySelector('video'), true)}
                  onMouseLeave={(event) => hoverVideo(event.currentTarget.querySelector('video'), false)}
                  onFocus={(event) => hoverVideo(event.currentTarget.querySelector('video'), true)}
                  onBlur={(event) => hoverVideo(event.currentTarget.querySelector('video'), false)}
                  onClick={() => setOpened(item)}
                  aria-label={`Play video: ${excerpt(item.prompt, 48)}`}
                  title="Click to open the clip"
                >
                  <video
                    src={item.videoPath}
                    poster={item.poster ?? undefined}
                    muted
                    loop
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-cover"
                  />
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25 opacity-100 transition-opacity duration-300 group-hover:opacity-0">
                    <Play className="size-8 fill-white/90 text-white/90 drop-shadow" aria-hidden="true" />
                  </span>
                  <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground/90">
                    MP4 clip
                  </span>
                </button>
              ) : (
                <div className={`${aspectClass(item.aspectRatio)} w-full overflow-hidden bg-muted/50`}>
                  <img
                    src={item.frame}
                    alt={`Keyframe ${item.index + 1} of: ${excerpt(item.prompt, 48)}`}
                    className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-105"
                    loading="lazy"
                  />
                </div>
              )}
              <figcaption className="flex items-center justify-between gap-2 border-t border-border bg-card/90 p-3">
                <span className="truncate text-xs text-muted-foreground" title={item.prompt}>
                  {excerpt(item.prompt, 40)}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onRemix(item.source)}
                    className="flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    aria-label={`Remix: ${excerpt(item.prompt, 40)}`}
                    title="Load this recipe into the Studio (free)"
                  >
                    <Shuffle className="size-4" aria-hidden="true" />
                  </button>
                  <a
                    href={item.kind === 'video' ? item.videoPath : item.frame}
                    download
                    className="flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    aria-label={
                      item.kind === 'video'
                        ? 'Download MP4 clip'
                        : `Download keyframe ${item.index + 1}`
                    }
                    title={item.kind === 'video' ? 'Download MP4' : 'Download'}
                  >
                    <Download className="size-4" aria-hidden="true" />
                  </a>
                </span>
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>

      <Dialog open={opened !== null} onOpenChange={(open) => !open && setOpened(null)}>
        <DialogContent className="sm:max-w-2xl">
          {opened && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 pr-6 text-left text-base">
                  <Film className="size-4 text-primary" aria-hidden="true" />
                  <span className="line-clamp-1">{excerpt(opened.prompt, 60)}</span>
                </DialogTitle>
                <DialogDescription className="text-left">{opened.prompt}</DialogDescription>
              </DialogHeader>
              {opened.kind === 'video' ? (
                <div className="space-y-3">
                  <div
                    className={`w-full overflow-hidden rounded-lg border border-primary/30 bg-black ${aspectClass(opened.aspectRatio)}`}
                  >
                    <video
                      src={opened.videoPath}
                      controls
                      autoPlay
                      loop
                      playsInline
                      preload="metadata"
                      poster={opened.poster ?? undefined}
                      className="h-full w-full object-contain"
                      aria-label={`Playable video for: ${opened.prompt}`}
                    />
                  </div>

                  {/* Phase 5: unlisted share link management for this render. */}
                  <div className="rounded-lg border border-border bg-card/60 p-3">
                    {dialogShareToken ? (
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-muted-foreground">
                            Public share link
                          </span>
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-500">
                            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
                            live
                          </span>
                        </div>
                        <a
                          href={shareUrlOf(dialogShareToken)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block truncate text-xs text-primary underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                          {shareUrlOf(dialogShareToken)}
                        </a>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            className="h-11 min-w-11 rounded-lg px-4 text-xs"
                            onClick={() => void copyShareLink(dialogShareToken)}
                          >
                            <Link2 className="size-4" aria-hidden="true" />
                            Copy link
                          </Button>
                          <a
                            href={shareUrlOf(dialogShareToken)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-card/60 px-4 text-xs font-medium transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                          >
                            <ExternalLink className="size-4" aria-hidden="true" />
                            Open
                          </a>
                          <Button
                            variant="outline"
                            className="h-11 min-w-11 rounded-lg border-destructive/40 px-4 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                            disabled={shareBusyJobId === opened.source.id}
                            onClick={() => void disableShare(opened.source.id)}
                          >
                            <Link2Off className="size-4" aria-hidden="true" />
                            Stop sharing
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          Create an unlisted link — anyone with it can view this render.
                        </p>
                        <Button
                          className="h-11 min-w-11 rounded-lg px-4 text-xs"
                          disabled={shareBusyJobId === opened.source.id}
                          onClick={() => void enableShare(opened.source.id)}
                        >
                          <Share2 className="size-4" aria-hidden="true" />
                          Create share link
                        </Button>
                      </div>
                    )}
                  </div>

                  <a
                    href={opened.videoPath}
                    download
                    className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-card/60 px-4 text-xs font-medium transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <Download className="size-4" aria-hidden="true" />
                    Download MP4
                  </a>
                </div>
              ) : (
                <img
                  src={opened.frame}
                  alt={`Keyframe ${opened.index + 1} of: ${opened.prompt}`}
                  className={`w-full rounded-lg border border-border object-cover ${aspectClass(opened.aspectRatio)}`}
                />
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
