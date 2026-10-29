'use client'

import { GalleryTab } from '@/components/reelforge/gallery-tab'
import { HistoryTab, type EditOutcome, type TransformOutcome } from '@/components/reelforge/history-tab'
import { InsightsTab } from '@/components/reelforge/insights-tab'
import { CreditsChip, LogoMark } from '@/components/reelforge/bits'
import { StudioTab, type RemixRecipe, type SubmitOutcome, type SubmitParams } from '@/components/reelforge/studio-tab'
import { ThemeToggle } from '@/components/reelforge/theme-toggle'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { AnimatePresence, motion } from 'framer-motion'
import { ChartColumn, Clapperboard, Compass, History as HistoryIcon, Home, Images } from 'lucide-react'
import Link from 'next/link'
import * as React from 'react'
import { cameraPresetLabel, type CameraPresetId } from '@/lib/presets'
import type { AspectRatio } from '@/lib/pricing'
import { restyleStyle, type RestyleStyleId } from '@/lib/styles'
import type { CreditsDto, JobDto, JobVariantDto } from '@/lib/types'

function newKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `key-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function StudioApp() {
  const { toast } = useToast()
  const [tab, setTab] = React.useState('studio')
  const [credits, setCredits] = React.useState<number | null>(null)
  const [jobs, setJobs] = React.useState<JobDto[]>([])
  const [activeJobId, setActiveJobId] = React.useState<string | null>(null)
  const [activeJob, setActiveJob] = React.useState<JobDto | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [busyRerunId, setBusyRerunId] = React.useState<string | null>(null)
  const [busyExtendId, setBusyExtendId] = React.useState<string | null>(null)
  /** Phase 3: a job's recipe waiting to be loaded into the Studio (remix). */
  const [remix, setRemix] = React.useState<RemixRecipe | null>(null)

  const boards = React.useMemo(() => {
    const names = new Set<string>()
    for (const job of jobs) {
      if (job.board) names.add(job.board)
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }, [jobs])

  const refreshCredits = React.useCallback(async () => {
    try {
      const response = await fetch('/api/credits')
      if (!response.ok) return
      const data = (await response.json()) as CreditsDto
      setCredits(data.balance)
    } catch {
      /* transient network hiccup — chip shows last known balance */
    }
  }, [])

  const refreshJobs = React.useCallback(async () => {
    try {
      const response = await fetch('/api/jobs')
      if (!response.ok) return
      const data = (await response.json()) as { jobs: JobDto[] }
      setJobs(data.jobs)
    } catch {
      /* ignore */
    }
  }, [])

  React.useEffect(() => {
    void refreshCredits()
    void refreshJobs()
  }, [refreshCredits, refreshJobs])

  // Poll the active job ~1.5s until it reaches a terminal state.
  React.useEffect(() => {
    if (!activeJobId) {
      setActiveJob(null)
      return
    }
    let cancelled = false
    let finished = false
    let timer: ReturnType<typeof setInterval> | null = null

    const stop = () => {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }

    const poll = async () => {
      if (finished) return stop()
      try {
        const response = await fetch(`/api/jobs/${activeJobId}`)
        if (!response.ok) return
        const data = (await response.json()) as { job: JobDto }
        if (cancelled) return
        setActiveJob(data.job)
        if (data.job.status === 'completed' || data.job.status === 'failed') {
          finished = true
          stop()
          if (data.job.status === 'completed') {
            if (data.job.videoPath) {
              toast({
                title: 'Video ready',
                description: 'Your MP4 clip is forged — play it in the Studio or the Gallery.',
              })
            } else {
              toast({
                title: 'Render complete',
                description: 'Your keyframes are ready — see them in the Gallery.',
              })
            }
          } else {
            toast({
              variant: 'destructive',
              title: 'Render failed',
              description: data.job.errorMessage || 'The provider could not finish this render.',
            })
          }
          void refreshCredits()
          void refreshJobs()
        }
      } catch {
        /* transient poll failure — next tick retries */
      }
    }

    void poll()
    timer = setInterval(() => void poll(), 1500)
    return () => {
      cancelled = true
      stop()
    }
  }, [activeJobId, refreshCredits, refreshJobs, toast])

  const handleSubmit = React.useCallback(
    async (params: SubmitParams): Promise<SubmitOutcome> => {
      setSubmitting(true)
      try {
        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...params, idempotencyKey: newKey() }),
        })
        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>

        if (response.ok && typeof data.jobId === 'string') {
          toast({
            title: 'Generation submitted',
            description: `${data.creditsCharged ?? '—'} credits reserved — watch it forge below.`,
          })
          setActiveJobId(data.jobId)
          void refreshCredits()
          void refreshJobs()
          return { ok: true, jobId: data.jobId }
        }

        if (response.status === 402) {
          toast({
            variant: 'destructive',
            title: 'Not enough credits',
            description:
              (data.message as string) ??
              'This render costs more credits than you have available.',
          })
          void refreshCredits()
        } else if (response.status === 400 && data.error === 'moderation_refused') {
          toast({
            title: 'Prompt refused',
            description: 'This prompt was refused by our safety filter. Try rewording it.',
          })
        } else {
          toast({
            variant: 'destructive',
            title: 'Could not submit',
            description: (data.message as string) ?? 'Something went wrong. Please try again.',
          })
        }
        return {
          ok: false,
          status: response.status,
          error: String(data.error ?? 'unknown'),
          message: String(data.message ?? 'Request failed'),
        }
      } catch {
        toast({
          variant: 'destructive',
          title: 'Network error',
          description: 'Could not reach the studio server. Please try again.',
        })
        return { ok: false, status: 0, error: 'network', message: 'Network error' }
      } finally {
        setSubmitting(false)
      }
    },
    [refreshCredits, refreshJobs, toast]
  )

  const handleRerun = React.useCallback(
    async (job: JobDto) => {
      setBusyRerunId(job.id)
      try {
        const response = await fetch(`/api/jobs/${job.id}/rerun`, { method: 'POST' })
        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>

        if (response.ok && typeof data.jobId === 'string') {
          toast({
            title: 'Re-run started',
            description: `${data.creditsCharged ?? '—'} credits charged again — same prompt, fresh render.`,
          })
          setActiveJobId(data.jobId)
          setTab('studio')
          void refreshCredits()
          void refreshJobs()
        } else if (response.status === 402) {
          toast({
            variant: 'destructive',
            title: 'Not enough credits',
            description:
              (data.message as string) ??
              'This re-run costs more credits than you have available.',
          })
        } else if (response.status === 400 && data.error === 'moderation_refused') {
          toast({
            title: 'Prompt refused',
            description: 'This prompt was refused by our safety filter. Try rewording it.',
          })
        } else {
          toast({
            variant: 'destructive',
            title: 'Could not re-run',
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
        setBusyRerunId(null)
      }
    },
    [refreshCredits, refreshJobs, toast]
  )

  const handleExtend = React.useCallback(
    async (job: JobDto) => {
      setBusyExtendId(job.id)
      try {
        const response = await fetch(`/api/jobs/${job.id}/extend`, { method: 'POST' })
        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>

        if (response.ok && typeof data.jobId === 'string') {
          toast({
            title: 'Extension started',
            description: `${data.creditsCharged ?? '—'} credits charged — pushing the clip forward +5s.`,
          })
          setActiveJobId(data.jobId)
          setTab('studio')
          void refreshCredits()
          void refreshJobs()
        } else if (response.status === 402) {
          toast({
            variant: 'destructive',
            title: 'Not enough credits',
            description:
              (data.message as string) ??
              'This extension costs more credits than you have available.',
          })
        } else if (response.status === 400 && data.error === 'moderation_refused') {
          toast({
            title: 'Prompt refused',
            description: 'This prompt was refused by our safety filter. Try rewording it.',
          })
        } else {
          toast({
            variant: 'destructive',
            title: 'Could not extend',
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
        setBusyExtendId(null)
      }
    },
    [refreshCredits, refreshJobs, toast]
  )

  // ── Phase 3: edit threads ────────────────────────────────────────────
  const handleEdit = React.useCallback(
    async (job: JobDto, instruction: string): Promise<EditOutcome> => {
      try {
        const response = await fetch(`/api/jobs/${job.id}/edit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instruction }),
        })
        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>

        if (response.ok && typeof data.jobId === 'string') {
          toast({
            title: 'Edit started',
            description: `Cutting edit v${job.editVersion + 1} — ${data.creditsCharged ?? '—'} credits charged. Watch it forge in the Studio.`,
          })
          setActiveJobId(data.jobId)
          setTab('studio')
          void refreshCredits()
          void refreshJobs()
          return { ok: true, jobId: data.jobId, creditsCharged: Number(data.creditsCharged ?? 0) }
        }
        if (response.status === 402) {
          toast({
            variant: 'destructive',
            title: 'Not enough credits',
            description:
              (data.message as string) ?? 'This edit costs more credits than you have available.',
          })
          void refreshCredits()
        } else if (response.status === 400 && data.error === 'moderation_refused') {
          toast({
            title: 'Instruction refused',
            description: 'This edit instruction was refused by our safety filter. Try rewording it.',
          })
        } else {
          toast({
            variant: 'destructive',
            title: 'Could not start the edit',
            description: (data.message as string) ?? 'Something went wrong. Please try again.',
          })
        }
        return {
          ok: false,
          status: response.status,
          error: String(data.error ?? 'unknown'),
          message: String(data.message ?? 'Request failed'),
        }
      } catch {
        toast({
          variant: 'destructive',
          title: 'Network error',
          description: 'Could not reach the studio server. Please try again.',
        })
        return { ok: false, status: 0, error: 'network', message: 'Network error' }
      }
    },
    [refreshCredits, refreshJobs, toast]
  )

  // ── Phase 3: reframe (re-crop) ───────────────────────────────────────
  const handleReframe = React.useCallback(
    async (job: JobDto, aspect: AspectRatio): Promise<TransformOutcome> => {
      try {
        const response = await fetch(`/api/jobs/${job.id}/reframe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ aspect }),
        })
        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>

        if (response.ok && data.variant && typeof data.variant === 'object') {
          const variant = data.variant as JobVariantDto
          if (data.alreadyExisted) {
            toast({
              title: 'Already reframed',
              description: `The ${variant.label ?? aspect} variant is ready — no new charge.`,
            })
          } else {
            toast({
              title: 'Reframed',
              description: `Reframed to ${aspect} — ${data.creditsCharged ?? 0} credits.`,
            })
          }
          void refreshCredits()
          void refreshJobs()
          return {
            ok: true,
            variant,
            creditsCharged: Number(data.creditsCharged ?? 0),
            alreadyExisted: Boolean(data.alreadyExisted),
          }
        }
        if (response.status === 402) {
          toast({
            variant: 'destructive',
            title: 'Not enough credits',
            description:
              (data.message as string) ?? 'This re-crop costs more credits than you have available.',
          })
          void refreshCredits()
        } else {
          toast({
            variant: 'destructive',
            title: 'Could not re-crop',
            description: (data.message as string) ?? 'Something went wrong. Please try again.',
          })
        }
        return {
          ok: false,
          status: response.status,
          error: String(data.error ?? 'unknown'),
          message: String(data.message ?? 'Request failed'),
        }
      } catch {
        toast({
          variant: 'destructive',
          title: 'Network error',
          description: 'Could not reach the studio server. Please try again.',
        })
        return { ok: false, status: 0, error: 'network', message: 'Network error' }
      }
    },
    [refreshCredits, refreshJobs, toast]
  )

  // ── Phase 3: camera moves ────────────────────────────────────────────
  const handleCamera = React.useCallback(
    async (job: JobDto, preset: CameraPresetId): Promise<TransformOutcome> => {
      try {
        const response = await fetch(`/api/jobs/${job.id}/camera`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preset }),
        })
        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>

        if (response.ok && data.variant && typeof data.variant === 'object') {
          const variant = data.variant as JobVariantDto
          const label = variant.label ?? cameraPresetLabel(preset)
          if (data.alreadyExisted) {
            toast({
              title: 'Camera move ready',
              description: `The “${label}” variant is ready — no new charge.`,
            })
          } else {
            toast({
              title: 'Camera move applied',
              description: `${label} — ${data.creditsCharged ?? 0} credits.`,
            })
          }
          void refreshCredits()
          void refreshJobs()
          return {
            ok: true,
            variant,
            creditsCharged: Number(data.creditsCharged ?? 0),
            alreadyExisted: Boolean(data.alreadyExisted),
          }
        }
        if (response.status === 402) {
          toast({
            variant: 'destructive',
            title: 'Not enough credits',
            description:
              (data.message as string) ?? 'This camera move costs more credits than you have available.',
          })
          void refreshCredits()
        } else {
          toast({
            variant: 'destructive',
            title: 'Could not apply the camera move',
            description: (data.message as string) ?? 'Something went wrong. Please try again.',
          })
        }
        return {
          ok: false,
          status: response.status,
          error: String(data.error ?? 'unknown'),
          message: String(data.message ?? 'Request failed'),
        }
      } catch {
        toast({
          variant: 'destructive',
          title: 'Network error',
          description: 'Could not reach the studio server. Please try again.',
        })
        return { ok: false, status: 0, error: 'network', message: 'Network error' }
      }
    },
    [refreshCredits, refreshJobs, toast]
  )

  // ── Phase 11 (N5): restyle — video-to-video style grade ─────────────
  const handleRestyle = React.useCallback(
    async (job: JobDto, style: RestyleStyleId): Promise<TransformOutcome> => {
      const meta = restyleStyle(style)
      try {
        const response = await fetch(`/api/jobs/${job.id}/restyle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ style }),
        })
        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>

        if (response.ok && data.variant && typeof data.variant === 'object') {
          const variant = data.variant as JobVariantDto
          const label = variant.label ?? meta?.label ?? style
          if (data.alreadyExisted) {
            toast({
              title: 'Restyle ready',
              description: `The “${label}” variant is ready — no new charge.`,
            })
          } else {
            toast({
              title: 'Restyle applied',
              description: `${label} — ${data.creditsCharged ?? 0} credits.`,
            })
          }
          void refreshCredits()
          void refreshJobs()
          return {
            ok: true,
            variant,
            creditsCharged: Number(data.creditsCharged ?? 0),
            alreadyExisted: Boolean(data.alreadyExisted),
          }
        }
        if (response.status === 402) {
          toast({
            variant: 'destructive',
            title: 'Not enough credits',
            description:
              (data.message as string) ?? 'This restyle costs more credits than you have available.',
          })
          void refreshCredits()
        } else {
          toast({
            variant: 'destructive',
            title: 'Could not apply the restyle',
            description: (data.message as string) ?? 'Something went wrong. Please try again.',
          })
        }
        return {
          ok: false,
          status: response.status,
          error: String(data.error ?? 'unknown'),
          message: String(data.message ?? 'Request failed'),
        }
      } catch {
        toast({
          variant: 'destructive',
          title: 'Network error',
          description: 'Could not reach the studio server. Please try again.',
        })
        return { ok: false, status: 0, error: 'network', message: 'Network error' }
      }
    },
    [refreshCredits, refreshJobs, toast]
  )

  // ── Phase 3: remix (recipe handoff into the Studio) ──────────────────
  const handleRemix = React.useCallback(
    async (job: JobDto) => {
      // Prefill the recipe; if the job has frames, also offer its first
      // keyframe as the pinned start frame (client-side data URL copy).
      let startFrame: string | null = null
      const framePath = job.frames[0] ?? job.startFramePath ?? null
      if (framePath) {
        try {
          const response = await fetch(framePath)
          if (response.ok) {
            const blob = await response.blob()
            startFrame = await new Promise<string | null>((resolve) => {
              const reader = new FileReader()
              reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
              reader.onerror = () => resolve(null)
              reader.readAsDataURL(blob)
            })
          }
        } catch {
          startFrame = null
        }
      }
      setRemix({
        prompt: job.prompt,
        tier: job.tier,
        durationSec: job.durationSec,
        aspectRatio: job.aspectRatio,
        board: job.board,
        startFrame,
      })
      setTab('studio')
      toast({
        title: 'Recipe loaded',
        description: startFrame
          ? 'Prompt, settings and the first keyframe are prefilled — tweak and forge.'
          : 'Prompt and settings are prefilled — tweak and forge.',
      })
    },
    [toast]
  )

  const handleRemixApplied = React.useCallback(() => setRemix(null), [])

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a
        href="#rf-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 rf-glass border-b">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="flex min-h-11 items-center gap-3 rounded-xl outline-ring focus-visible:outline-2 focus-visible:outline-offset-2"
            aria-label="Reelforge home"
          >
            <LogoMark className="size-10 shrink-0 rounded-xl" />
            <span className="hidden min-w-0 flex-1 sm:block">
              <span className="block truncate text-lg font-bold tracking-tight">Reelforge</span>
              <span className="block truncate text-xs text-muted-foreground">
                Prompt-to-video AI studio — forge, edit and remix clips
              </span>
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <Link
              href="/"
              className="inline-flex size-11 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              aria-label="Back to Create"
              title="Back to Create"
            >
              <Home className="size-4" aria-hidden="true" />
            </Link>
            <Link
              href="/explore"
              className="hidden size-11 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground sm:inline-flex"
              aria-label="Explore gallery"
              title="Explore gallery"
            >
              <Compass className="size-4" aria-hidden="true" />
            </Link>
            <Link
              href="/history"
              className="hidden size-11 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground sm:inline-flex"
              aria-label="My forges"
              title="My forges"
            >
              <HistoryIcon className="size-4" aria-hidden="true" />
            </Link>
            <CreditsChip balance={credits} />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main id="rf-main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Tabs value={tab} onValueChange={setTab} className="gap-6">
          <div className="flex justify-center sm:justify-start">
            <TabsList className="h-12 rounded-xl p-1">
              {/* Icons are hidden below sm so all four tabs fit on 375px screens. */}
              <TabsTrigger value="studio" className="min-h-11 gap-2 rounded-lg px-3 text-sm sm:px-4">
                <Clapperboard className="size-4 max-sm:hidden" aria-hidden="true" />
                Studio
              </TabsTrigger>
              <TabsTrigger value="history" className="min-h-11 gap-2 rounded-lg px-3 text-sm sm:px-4">
                <HistoryIcon className="size-4 max-sm:hidden" aria-hidden="true" />
                History
              </TabsTrigger>
              <TabsTrigger value="gallery" className="min-h-11 gap-2 rounded-lg px-3 text-sm sm:px-4">
                <Images className="size-4 max-sm:hidden" aria-hidden="true" />
                Gallery
              </TabsTrigger>
              <TabsTrigger value="insights" className="min-h-11 gap-2 rounded-lg px-3 text-sm sm:px-4">
                <ChartColumn className="size-4 max-sm:hidden" aria-hidden="true" />
                Insights
              </TabsTrigger>
            </TabsList>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            >
              <TabsContent value="studio" className="mt-0">
                <StudioTab
                  credits={credits}
                  boards={boards}
                  activeJob={activeJob}
                  submitting={submitting}
                  onSubmit={handleSubmit}
                  remix={remix}
                  onRemixApplied={handleRemixApplied}
                />
              </TabsContent>
              <TabsContent value="history" className="mt-0">
                <HistoryTab
                  jobs={jobs}
                  busyRerunId={busyRerunId}
                  busyExtendId={busyExtendId}
                  onRerun={handleRerun}
                  onExtend={handleExtend}
                  onOpenStudio={() => setTab('studio')}
                  onEdit={handleEdit}
                  onReframe={handleReframe}
                  onCamera={handleCamera}
                  onRestyle={handleRestyle}
                  onRemix={(job) => void handleRemix(job)}
                />
              </TabsContent>
              <TabsContent value="gallery" className="mt-0">
                <GalleryTab
                  jobs={jobs}
                  onOpenStudio={() => setTab('studio')}
                  onRemix={(job) => void handleRemix(job)}
                />
              </TabsContent>
              <TabsContent value="insights" className="mt-0">
                <InsightsTab />
              </TabsContent>
            </motion.div>
          </AnimatePresence>
        </Tabs>
      </main>

      <footer className="mt-auto border-t border-border/60 bg-card/30 pb-safe pt-4 text-center">
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">Reelforge</span> — an original clean-room
          build
        </p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Studio workspace · edit threads · transforms · cost insights · credits are play money
        </p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          <Link href="/" className="underline-offset-4 hover:underline">
            Back to Create
          </Link>
        </p>
      </footer>
    </div>
  )
}
