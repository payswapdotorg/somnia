'use client'

import { AgentPanel } from '@/components/reelforge/create/agent-panel'
import { CHALLENGE_RECIPE, ToolCards } from '@/components/reelforge/create/tool-cards'
import { AppShellNav } from '@/components/reelforge/app-nav'
import { KindChip, StatusChip, TierChip, excerpt, formatTimestamp } from '@/components/reelforge/bits'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Clapperboard,
  Flame,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  Bot,
  X,
} from 'lucide-react'
import Link from 'next/link'
import * as React from 'react'
import {
  ASPECT_RATIOS,
  DURATIONS,
  IMAGE_CREDITS,
  creditCost,
  providerCostUsd,
  type AspectRatio,
  type Tier,
} from '@/lib/pricing'
import type { AgentSuggestionDto, JobDto } from '@/lib/types'

/**
 * Phase 8: creation-first home — the "creation cockpit" paradigm.
 *
 * The generator IS the landing page: a promo strip, a studio header, a big
 * WHAT-WILL-YOU-FORGE headline, Video / Image / Agent mode tabs over a large
 * prompt composer with in-box parameter toolbar, a live active-job card, a
 * recent-forges rail, and a tool-card grid that opens real shipped features.
 * The cinematic marketing surface moved to /showcase.
 */

type Mode = 'video' | 'image' | 'agent'

/** A pinned start/end frame held as a data URL until submit (Phase 10: image-to-video). */
type FrameValue = { dataUrl: string; name: string }

const PROMO_STORAGE_KEY = 'rf-promo-dismissed'

// Mirrors the server-side contract in lib/jobs.ts (START_FRAME_DATA_URL + MAX_IMAGE_BYTES).
const FRAME_ACCEPT = 'image/png,image/jpeg,image/webp'
const FRAME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_FRAME_BYTES = 6 * 1024 * 1024

/** Optional start/end frame pin — empty state is an upload chip, filled state is a thumbnail chip with remove. */
function FrameSlot({
  label,
  value,
  onFile,
  onClear,
}: {
  label: string
  value: FrameValue | null
  onFile: (file: File) => void
  onClear: () => void
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  if (value) {
    return (
      <button
        type="button"
        onClick={onClear}
        title={`${label}: ${value.name} — click to remove`}
        aria-label={`${label} pinned: ${value.name}. Activate to remove.`}
        className="group flex min-h-9 items-center gap-2 overflow-hidden rounded-full border border-primary/50 bg-primary/15 pl-1 pr-3 text-xs font-semibold text-primary transition-colors hover:border-primary/70"
      >
        {/* data URL preview — safe: generated in-browser, never remote */}
        <img src={value.dataUrl} alt="" className="size-7 shrink-0 rounded-full object-cover" />
        <span className="max-w-40 truncate">
          {label.split(' ')[0]} · {value.name}
        </span>
        <X className="size-3.5 shrink-0 opacity-70 group-hover:opacity-100" aria-hidden="true" />
      </button>
    )
  }
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={FRAME_ACCEPT}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          // Reset so picking the same file twice re-fires onChange.
          event.target.value = ''
          if (file) onFile(file)
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        aria-label={`Add ${label.toLowerCase()} — optional image-to-video anchor`}
        title={`Optional ${label.toLowerCase()} — the video opens on this image`}
        className="flex min-h-9 items-center gap-1.5 rounded-full border border-dashed border-border px-3 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        <ImagePlus className="size-3.5" aria-hidden="true" />
        {label}
      </button>
    </>
  )
}

const MODES: Array<{ id: Mode; label: string; icon: React.ReactNode }> = [
  { id: 'video', label: 'Video', icon: <Clapperboard className="size-4" aria-hidden="true" /> },
  { id: 'image', label: 'Image', icon: <ImageIcon className="size-4" aria-hidden="true" /> },
  { id: 'agent', label: 'Agent', icon: <Bot className="size-4" aria-hidden="true" /> },
]

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  dispatched: 'Dispatched',
  running: 'Forging',
  moderated: 'Moderating',
  completed: 'Done',
  failed: 'Failed',
}

function newKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `key-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function CreateApp() {
  const { toast } = useToast()
  const [mode, setMode] = React.useState<Mode>('video')
  const [promoVisible, setPromoVisible] = React.useState(true)

  // Composer state (kept per-mode so switching tabs never loses text).
  const [videoPrompt, setVideoPrompt] = React.useState('')
  const [videoTier, setVideoTier] = React.useState<Tier>('draft')
  const [videoAspect, setVideoAspect] = React.useState<AspectRatio>('16:9')
  const [videoDuration, setVideoDuration] = React.useState<number>(5)
  const [videoBoard, setVideoBoard] = React.useState<string | null>(null)
  // Phase 10 N4: image-to-video — optional pinned frames, uploaded as data URLs.
  const [videoStartFrame, setVideoStartFrame] = React.useState<FrameValue | null>(null)
  const [videoEndFrame, setVideoEndFrame] = React.useState<FrameValue | null>(null)
  const [imagePrompt, setImagePrompt] = React.useState('')
  const [imageTier, setImageTier] = React.useState<Tier>('draft')
  const [imageAspect, setImageAspect] = React.useState<AspectRatio>('1:1')

  // Balance display lives in the shared AppShellNav chip; the composer only
  // pokes `creditsTick` after charges so the nav re-reads the ledger.
  const [creditsTick, setCreditsTick] = React.useState(0)
  const [jobs, setJobs] = React.useState<JobDto[]>([])
  const [activeJobId, setActiveJobId] = React.useState<string | null>(null)
  const [activeJob, setActiveJob] = React.useState<JobDto | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [launchingSuggestion, setLaunchingSuggestion] = React.useState(false)
  const composerRef = React.useRef<HTMLDivElement | null>(null)

  // Promo dismissal is persisted locally.
  React.useEffect(() => {
    try {
      if (window.localStorage.getItem(PROMO_STORAGE_KEY) === '1') setPromoVisible(false)
    } catch {
      /* private mode — banner simply stays */
    }
  }, [])

  // Phase 9: remix plumbing — deep links (from /models, /explore, /history)
  // land with ?mode=&tier=&aspect=&duration=&prompt= and preload the composer.
  // Read once on mount from window.location.search so the page stays fully
  // statically prerenderable (no useSearchParams suspense boundary needed).
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const mode = params.get('mode')
    const tier = params.get('tier')
    const aspect = params.get('aspect')
    const duration = Number(params.get('duration'))
    const prompt = params.get('prompt')?.slice(0, 800) ?? ''
    const from = params.get('from') ?? 'remix'

    let touched = false
    if (mode === 'video' || mode === 'image' || mode === 'agent') {
      setMode(mode)
      touched = true
    }
    const safeTier = tier === 'quality' ? 'quality' : tier === 'draft' ? 'draft' : null
    const safeAspect =
      aspect === '16:9' || aspect === '9:16' || aspect === '1:1' ? aspect : null

    if (mode === 'image') {
      if (prompt) setImagePrompt(prompt)
      if (safeTier) setImageTier(safeTier)
      if (safeAspect) setImageAspect(safeAspect)
      touched = touched || Boolean(prompt || safeTier || safeAspect)
    } else {
      // video or agent handoff — preload the video composer recipe
      if (prompt) setVideoPrompt(prompt)
      if (safeTier) setVideoTier(safeTier)
      if (safeAspect) setVideoAspect(safeAspect)
      if ([5, 8, 10, 15].includes(duration)) setVideoDuration(duration)
      touched = touched || Boolean(prompt || safeTier || safeAspect)
    }

    if (!touched) return
    const source =
      from === 'models' ? 'model catalogue' : from === 'models-agent' ? 'model catalogue' : from === 'history' ? 'your history' : 'the gallery'
    const timer = window.setTimeout(() => {
      toast({
        title: 'Recipe loaded',
        description: `Settings from ${source} are in the composer — tweak and forge your take.`,
      })
    }, 350)
    const node = composerRef.current
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return () => window.clearTimeout(timer)
  }, [])

  const dismissPromo = () => {
    setPromoVisible(false)
    try {
      window.localStorage.setItem(PROMO_STORAGE_KEY, '1')
    } catch {
      /* ignore */
    }
  }

  const refreshCredits = React.useCallback(async () => {
    // Poke the shared nav chip (its own useCredits re-reads) so the header
    // balance stays honest right after a charge. The daily refill rides the
    // same read server-side.
    setCreditsTick((tick) => tick + 1)
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
    // Initial balance read happens inside AppShellNav's useCredits; here we
    // only need the job list on mount.
    void refreshJobs()
  }, [refreshJobs])

  // Poll the active job ~1.5s until terminal (same contract as the Studio).
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
            toast({
              title: data.job.kind === 'image' ? 'Image ready' : 'Video ready',
              description:
                data.job.kind === 'image'
                  ? 'Your still is forged — see it below or in the Studio gallery.'
                  : 'Your MP4 clip is forged — play it below or open the Studio.',
            })
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

  // Keep the recent rail fresh while anything is in flight.
  const hasInFlight = React.useMemo(
    () => jobs.some((job) => job.status !== 'completed' && job.status !== 'failed') || activeJobId !== null,
    [jobs, activeJobId]
  )
  React.useEffect(() => {
    if (!hasInFlight) return
    const timer = setInterval(() => void refreshJobs(), 4000)
    return () => clearInterval(timer)
  }, [hasInFlight, refreshJobs])

  // ── Launch plumbing (shared by all three modes) ───────────────────────
  const launch = React.useCallback(
    async (endpoint: '/api/generate' | '/api/image', params: Record<string, unknown>, label: string) => {
      setSubmitting(true)
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...params, idempotencyKey: newKey() }),
        })
        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
        if (response.ok && typeof data.jobId === 'string') {
          toast({
            title: `${label} submitted`,
            description: `${data.creditsCharged ?? '—'} credits reserved — forging below.`,
          })
          setActiveJobId(data.jobId)
          void refreshCredits()
          void refreshJobs()
          return true
        }
        if (response.status === 402) {
          toast({
            variant: 'destructive',
            title: 'Not enough credits',
            description: (data.message as string) ?? 'This forge costs more credits than you have.',
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
        return false
      } catch {
        toast({
          variant: 'destructive',
          title: 'Network error',
          description: 'Could not reach the studio server. Please try again.',
        })
        return false
      } finally {
        setSubmitting(false)
      }
    },
    [refreshCredits, refreshJobs, toast]
  )

  // Validate + read an uploaded frame into a data URL (client-side mirror of the server guard).
  const readFrameFile = (file: File, slot: 'start' | 'end') => {
    if (!FRAME_TYPES.has(file.type)) {
      toast({
        variant: 'destructive',
        title: 'Unsupported image',
        description: 'Frames must be PNG, JPEG or WebP.',
      })
      return
    }
    if (file.size > MAX_FRAME_BYTES) {
      toast({
        variant: 'destructive',
        title: 'Image too large',
        description: 'Frames must be under 6 MB — try a smaller export.',
      })
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : null
      if (!dataUrl || !dataUrl.startsWith('data:image/')) return
      const value: FrameValue = { dataUrl, name: file.name }
      if (slot === 'start') setVideoStartFrame(value)
      else setVideoEndFrame(value)
      toast({
        title: `${slot === 'start' ? 'Start' : 'End'} frame pinned`,
        description: 'The forge will open (or close) on your image — describe the motion around it.',
      })
    }
    reader.onerror = () => {
      toast({
        variant: 'destructive',
        title: 'Could not read image',
        description: 'Please try a different file.',
      })
    }
    reader.readAsDataURL(file)
  }

  const submitVideo = () => {
    if (videoPrompt.trim().length < 3 || submitting) return
    void launch(
      '/api/generate',
      {
        prompt: videoPrompt,
        tier: videoTier,
        durationSec: videoDuration,
        aspectRatio: videoAspect,
        board: videoBoard,
        ...(videoStartFrame ? { startFrame: videoStartFrame.dataUrl } : {}),
        ...(videoEndFrame ? { endFrame: videoEndFrame.dataUrl } : {}),
      },
      'Video'
    )
  }

  const submitImage = () => {
    if (imagePrompt.trim().length < 3 || submitting) return
    void launch(
      '/api/image',
      { prompt: imagePrompt, tier: imageTier, aspectRatio: imageAspect },
      'Image'
    )
  }

  const launchSuggestion = async (suggestion: AgentSuggestionDto) => {
    setLaunchingSuggestion(true)
    try {
      if (suggestion.mode === 'video') {
        await launch(
          '/api/generate',
          {
            prompt: suggestion.prompt,
            tier: suggestion.tier,
            durationSec: suggestion.durationSec ?? 5,
            aspectRatio: suggestion.aspectRatio,
          },
          "Agent's video"
        )
      } else {
        await launch(
          '/api/image',
          { prompt: suggestion.prompt, tier: suggestion.tier, aspectRatio: suggestion.aspectRatio },
          "Agent's image"
        )
      }
    } finally {
      setLaunchingSuggestion(false)
    }
  }

  const takeChallenge = () => {
    setMode('video')
    setVideoPrompt(CHALLENGE_RECIPE.prompt)
    setVideoBoard(CHALLENGE_RECIPE.board)
    composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    toast({
      title: 'Challenge loaded',
      description: 'The weekly recipe is in the composer — tweak it and forge your take.',
    })
  }

  const videoCost = creditCost(videoTier, videoDuration)
  const imageCost = IMAGE_CREDITS[imageTier]

  const composerOnKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      if (mode === 'video') submitVideo()
      else if (mode === 'image') submitImage()
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a
        href="#rf-create-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>

      {/* Promo strip */}
      <AnimatePresence initial={false}>
        {promoVisible && (
          <motion.div
            key="promo"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="rf-promo rf-safe-top relative z-50 overflow-hidden text-white"
          >
            <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-2 sm:px-6">
              <Flame className="size-4 shrink-0 opacity-90" aria-hidden="true" />
              <p className="min-w-0 flex-1 line-clamp-2 text-xs font-semibold sm:text-sm">
                Founding Forger perk — flat-rate transforms and 40% bonus credits on top-ups this
                month.
              </p>
              <a
                href="/showcase#pricing"
                className="shrink-0 rounded-full bg-zinc-950/85 px-3.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-zinc-950"
              >
                See plans
              </a>
              <button
                type="button"
                onClick={dismissPromo}
                aria-label="Dismiss announcement"
                className="flex size-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/15"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* App shell header — shared with /models, /explore, /history */}
      <AppShellNav current="/" refreshSignal={creditsTick} />

      <main id="rf-create-main" className="flex-1">
        {/* Headline + mode tabs + composer */}
        <div className="rf-composer-glow border-b border-border/40">
          <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
            <h1 className="rf-display-glow text-center text-3xl font-extrabold uppercase tracking-wide sm:text-5xl">
              What will you <span className="rf-gradient-text">forge</span> today?
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-center text-sm text-muted-foreground sm:text-base">
              Prompt to video, stills and agent-crafted shots — metered credits, honest economics,
              everything you forge is yours.
            </p>

            {/* Mode tabs */}
            <div role="tablist" aria-label="Creation mode" className="mt-8 flex justify-center">
              <div className="rf-glass flex gap-1 rounded-full border p-1">
                {MODES.map((item) => {
                  const active = mode === item.id
                  return (
                    <button
                      key={item.id}
                      role="tab"
                      aria-selected={active}
                      type="button"
                      onClick={() => setMode(item.id)}
                      className={`flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors sm:px-6 ${
                        active
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Composer / Agent */}
            <div ref={composerRef} className="mt-6 scroll-mt-24">
              {mode !== 'agent' ? (
                <section
                  aria-label={mode === 'video' ? 'Video composer' : 'Image composer'}
                  className="mx-auto w-full max-w-3xl"
                >
                  <div className="rf-composer rounded-3xl p-3 sm:p-4">
                    <label htmlFor="rf-prompt" className="sr-only">
                      {mode === 'video' ? 'Describe the video' : 'Describe the image'}
                    </label>
                    <textarea
                      id="rf-prompt"
                      value={mode === 'video' ? videoPrompt : imagePrompt}
                      onChange={(event) =>
                        mode === 'video'
                          ? setVideoPrompt(event.target.value)
                          : setImagePrompt(event.target.value)
                      }
                      onKeyDown={composerOnKeyDown}
                      placeholder={
                        mode === 'video'
                          ? 'Describe the shot you want to forge — subject, action, mood, light…'
                          : 'Describe the image — subject, composition, palette…'
                      }
                      rows={4}
                      maxLength={800}
                      className="min-h-28 w-full resize-none rounded-2xl bg-transparent px-3 py-3 text-base leading-relaxed outline-none placeholder:text-muted-foreground/60"
                    />

                    {/* Parameter toolbar */}
                    <div className="mt-2 flex flex-col gap-3 border-t border-border/60 pt-3">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                        {/* Model chips */}
                        <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Model">
                          {(['draft', 'quality'] as const).map((tier) => {
                            const selected = mode === 'video' ? videoTier === tier : imageTier === tier
                            return (
                              <button
                                key={tier}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                onClick={() =>
                                  mode === 'video'
                                    ? setVideoTier(tier)
                                    : setImageTier(tier)
                                }
                                className={`min-h-9 rounded-full border px-3 text-xs font-semibold transition-colors ${
                                  selected
                                    ? 'border-primary/50 bg-primary/15 text-primary'
                                    : 'border-border text-muted-foreground hover:text-foreground'
                                }`}
                              >
                                {tier === 'draft' ? 'Draft' : 'Quality'}
                              </button>
                            )
                          })}
                        </div>

                        {/* Aspect chips */}
                        <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Aspect ratio">
                          {ASPECT_RATIOS.map((aspect) => {
                            const selected = mode === 'video' ? videoAspect === aspect : imageAspect === aspect
                            return (
                              <button
                                key={aspect}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                onClick={() =>
                                  mode === 'video'
                                    ? setVideoAspect(aspect)
                                    : setImageAspect(aspect)
                                }
                                className={`min-h-9 rounded-full border px-3 text-xs font-semibold transition-colors ${
                                  selected
                                    ? 'border-primary/50 bg-primary/15 text-primary'
                                    : 'border-border text-muted-foreground hover:text-foreground'
                                }`}
                              >
                                {aspect}
                              </button>
                            )
                          })}
                        </div>

                        {/* Duration (video only) */}
                        {mode === 'video' && (
                          <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Duration in seconds">
                            {DURATIONS.map((seconds) => (
                              <button
                                key={seconds}
                                type="button"
                                role="radio"
                                aria-checked={videoDuration === seconds}
                                onClick={() => setVideoDuration(seconds)}
                                className={`min-h-9 rounded-full border px-3 text-xs font-semibold transition-colors ${
                                  videoDuration === seconds
                                    ? 'border-primary/50 bg-primary/15 text-primary'
                                    : 'border-border text-muted-foreground hover:text-foreground'
                                }`}
                              >
                                {seconds}s
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Pinned frames (video only) — image-to-video anchors */}
                        {mode === 'video' && (
                          <div className="flex items-center gap-1.5">
                            <FrameSlot
                              label="Start frame"
                              value={videoStartFrame}
                              onFile={(file) => readFrameFile(file, 'start')}
                              onClear={() => setVideoStartFrame(null)}
                            />
                            <FrameSlot
                              label="End frame"
                              value={videoEndFrame}
                              onFile={(file) => readFrameFile(file, 'end')}
                              onClear={() => setVideoEndFrame(null)}
                            />
                          </div>
                        )}
                      </div>

                      {/* Cost + submit */}
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[13px] leading-relaxed text-muted-foreground">
                          {mode === 'video' ? (
                            <>
                              <span className="font-semibold text-foreground">{videoCost} credits</span>{' '}
                              · {videoDuration}s
                              {(videoStartFrame || videoEndFrame) && ' · framed'} · ≈ $
                              {providerCostUsd(videoTier, videoDuration).toFixed(2)} provider
                              <span className="hidden sm:inline">
                                {' · '}
                                <kbd className="rounded border border-border px-1">Ctrl</kbd>
                                <span className="mx-0.5">+</span>
                                <kbd className="rounded border border-border px-1">Enter</kbd> to forge
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="font-semibold text-foreground">{imageCost} credits</span>{' '}
                              · single still · prompt boards live in the{' '}
                              <a href="/studio" className="underline underline-offset-2 hover:text-foreground">
                                full Studio
                              </a>
                            </>
                          )}
                        </p>
                        <Button
                          type="button"
                          size="lg"
                          className="h-12 gap-2 rounded-full px-6"
                          disabled={
                            submitting ||
                            (mode === 'video'
                              ? videoPrompt.trim().length < 3
                              : imagePrompt.trim().length < 3)
                          }
                          onClick={mode === 'video' ? submitVideo : submitImage}
                        >
                          {submitting ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Flame className="size-4" aria-hidden="true" />
                          )}
                          Forge
                        </Button>
                      </div>
                    </div>
                  </div>
                  {videoBoard && mode === 'video' && (
                    <p className="mt-2 text-center text-xs text-muted-foreground/70">
                      Board: <span className="font-semibold text-primary">{videoBoard}</span> — set by
                      the Forge Challenge.{' '}
                      <button
                        type="button"
                        className="underline underline-offset-2 hover:text-foreground"
                        onClick={() => setVideoBoard(null)}
                      >
                        clear
                      </button>
                    </p>
                  )}
                </section>
              ) : (
                <AgentPanel onLaunch={(suggestion) => void launchSuggestion(suggestion)} launching={launchingSuggestion} />
              )}
            </div>

            {/* Active job card */}
            <AnimatePresence initial={false}>
              {activeJob && (
                <motion.section
                  key="active-job"
                  aria-label="Active forge"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                  className="mx-auto mt-6 w-full max-w-3xl rounded-2xl border border-border bg-card p-4 sm:p-5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip status={activeJob.status} />
                    <TierChip tier={activeJob.tier} />
                    <KindChip kind={activeJob.kind} />
                    <span className="text-xs text-muted-foreground">
                      {STATUS_LABEL[activeJob.status] ?? activeJob.status} · {activeJob.creditsCharged} cr
                    </span>
                    <Link
                      href="/studio"
                      className="ml-auto text-xs font-semibold text-primary underline-offset-4 hover:underline"
                    >
                      Open in Studio →
                    </Link>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                    {excerpt(activeJob.prompt, 110)}
                  </p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-500"
                      style={{ width: `${activeJob.progress}%` }}
                    />
                  </div>
                  {activeJob.status === 'completed' && (
                    <div className="mt-4">
                      {activeJob.kind === 'image' && activeJob.frames[0] ? (
                         
                        <img
                          src={activeJob.frames[0]}
                          alt={excerpt(activeJob.prompt, 80)}
                          className="w-full rounded-xl border border-border object-cover"
                        />
                      ) : activeJob.videoPath ? (
                        <video
                          src={activeJob.videoPath}
                          poster={activeJob.frames[0] ?? undefined}
                          controls
                          muted
                          playsInline
                          preload="metadata"
                          className="w-full rounded-xl border border-border"
                        />
                      ) : (
                        <div className="flex gap-2">
                          {activeJob.frames.map((frame) => (
                             
                            <img
                              key={frame}
                              src={frame}
                              alt=""
                              className="w-1/3 rounded-lg border border-border object-cover"
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {activeJob.status === 'failed' && (
                    <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      {activeJob.errorMessage ?? 'The provider could not finish this render.'}
                    </p>
                  )}
                </motion.section>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Recent forges rail */}
        <section aria-labelledby="rf-recent-heading" className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 id="rf-recent-heading" className="text-xl font-bold tracking-tight sm:text-2xl">
                Recent forges
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Your latest work — click any tile to open it in the Studio.
              </p>
            </div>
            <Link
              href="/studio"
              className="shrink-0 text-sm font-semibold text-primary underline-offset-4 hover:underline"
            >
              All work →
            </Link>
          </div>
          {jobs.length === 0 ? (
            <p className="mt-6 rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Nothing forged yet — your first clip will land here.
            </p>
          ) : (
            <ul className="rf-no-scrollbar rf-scroll mt-5 flex snap-x gap-3 overflow-x-auto pb-2">
              {jobs.slice(0, 10).map((job) => {
                const thumb = job.frames[0] ?? job.startFramePath ?? null
                const inFlight = job.status !== 'completed' && job.status !== 'failed'
                return (
                  <li key={job.id} className="w-40 shrink-0 snap-start sm:w-44">
                    <Link
                      href="/studio"
                      className="group block overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/40"
                    >
                      <div className="relative aspect-[16/10] bg-secondary">
                        {thumb ? (
                           
                          <img
                            src={thumb}
                            alt={excerpt(job.prompt, 60)}
                            loading="lazy"
                            className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                        ) : (
                          <div className="flex size-full items-center justify-center">
                            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
                          </div>
                        )}
                        {inFlight && (
                          <span className="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-background/60">
                            <span
                              className="block h-full rounded-full bg-primary transition-[width] duration-500"
                              style={{ width: `${job.progress}%` }}
                            />
                          </span>
                        )}
                      </div>
                      <div className="space-y-1.5 p-2.5">
                        <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">
                          {excerpt(job.prompt, 64)}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {inFlight && <StatusChip status={job.status} />}
                          <TierChip tier={job.tier} />
                          <KindChip kind={job.kind} />
                        </div>
                        <p className="text-[11px] text-muted-foreground/70">
                          {formatTimestamp(job.createdAt)}
                        </p>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* Tool cards */}
        <div className="mx-auto w-full max-w-7xl px-4 pb-14 sm:px-6 sm:pb-20">
          <ToolCards
            onPickImage={() => setMode('image')}
            onPickAgent={() => setMode('agent')}
            onChallenge={takeChallenge}
          />
        </div>
      </main>

      <footer className="mt-auto border-t border-border/60 bg-card/30 pb-safe pt-4 text-center">
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">Reelforge</span> — an original clean-room
          build
        </p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Video · Stills · Agent · edit threads · transforms · share links — credits are play money
        </p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          <a href="/showcase" className="underline underline-offset-4 hover:underline">
            Showcase
          </a>
          <span className="mx-1.5">·</span>
          <a href="/studio" className="underline underline-offset-4 hover:underline">
            Studio
          </a>
          <span className="mx-1.5">·</span>
          <a href="/showcase#pricing" className="underline underline-offset-4 hover:underline">
            Pricing
          </a>
        </p>
      </footer>
    </div>
  )
}
