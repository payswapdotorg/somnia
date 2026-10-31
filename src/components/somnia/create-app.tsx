// src/components/somnia/create-app.tsx — the home: feed + prompt dock (T4b, T17).
//
// The Dream-Machine layout: a full-bleed masonry feed of your generations
// (GET /api/jobs, live polling while anything is in flight, the just-sumitted
// job featured at the top) with the signature floating prompt dock at the
// bottom — a pill input carrying the full recipe (mode, model, resolution,
// aspect, duration, HDR, loop), up to 16 pinned keyframes, board filing,
// brainstorm variants, an honest cost preview computed with the same plans.ts
// math the server charges by, and live polling of the accepted job through
// the render pipeline. Talks the exact /api/{boards,brainstorm,generate,image,
// jobs,jobs/:id} contract.
'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowUp, Wand2, SlidersHorizontal, Paperclip } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { SignInInvitation, StatusChip, MetaChip, AvatarBlob } from '@/components/somnia/bits'
import {
  mainAsset,
  aspectClass,
  TERMINAL_STATUSES,
  type JobView,
  type RemixPrefill,
  type ProviderHealthSummaryView,
} from '@/components/somnia/dto'
import type { BrainstormVariant } from '@/lib/brainstorm'
import {
  ASPECT_RATIOS,
  DURATIONS,
  RESOLUTIONS,
  VIDEO_MODELS,
  MAX_KEYFRAMES,
  clipCost,
  imageCost,
} from '@/lib/plans'
import type { SessionUser } from '@/hooks/use-session'

const MODEL_LABELS: Record<string, string> = {
  'pulse-3': 'Pulse 3',
  'pulse-flash': 'Pulse Flash',
}

interface PinnedFrame {
  dataUrl: string
  name?: string
}

export interface CreateAppProps {
  user: SessionUser | null
  /** Remix prefill handed over from the history surface (free, uncharged). */
  prefill?: RemixPrefill | null
  onCreditsChanged?: () => void
}

export function CreateApp({ user, prefill, onCreditsChanged }: CreateAppProps) {
  const [mode, setMode] = useState<'video' | 'image'>('video')
  const [prompt, setPrompt] = useState(prefill?.prompt ?? '')
  const [enhancedPrompt, setEnhancedPrompt] = useState<string | null>(null)
  const [model, setModel] = useState(prefill?.model ?? 'pulse-3')
  const [resolution, setResolution] = useState(prefill?.resolution ?? '720p')
  const [aspectRatio, setAspectRatio] = useState(prefill?.aspectRatio ?? '16:9')
  const [durationSec, setDurationSec] = useState(prefill?.durationSec ?? 5)
  const [hdr, setHdr] = useState(prefill?.hdr ?? false)
  const [loop, setLoop] = useState(prefill?.loop ?? false)
  const [pins, setPins] = useState<PinnedFrame[]>([])
  const [boards, setBoards] = useState<{ id: string; name: string }[]>([])
  const [boardId, setBoardId] = useState('')
  // T18: /api/brainstorm returns variant OBJECTS ({style,label,text,blurb}) —
  // the earlier string[] typing silently shipped objects into React children
  // and crashed the whole app on Enhance. The shape now mirrors the server's
  // BrainstormVariant exactly.
  const [variants, setVariants] = useState<BrainstormVariant[]>([])
  const [enhancing, setEnhancing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeJob, setActiveJob] = useState<JobView | null>(null)
  // T14 render truth — the provider tier this deployment renders on, fetched
  // once so the composer can tell the user what a "dream" actually is here.
  const [health, setHealth] = useState<ProviderHealthSummaryView | null>(null)
  // T17 feed — my generations, live while anything is in flight.
  const [feed, setFeed] = useState<JobView[]>([])
  const [feedLoading, setFeedLoading] = useState(true)
  const fileInput = useRef<HTMLInputElement>(null)

  // Apply a remix prefill that arrives after mount (the history surface
  // parks it in sessionStorage and routes here; useState initializers alone
  // would miss it). Idempotent for a prefill present at first render.
  useEffect(() => {
    if (!prefill) return
    if (typeof prefill.prompt === 'string') setPrompt(prefill.prompt)
    if (typeof prefill.model === 'string') setModel(prefill.model)
    if (typeof prefill.resolution === 'string') setResolution(prefill.resolution)
    if (typeof prefill.aspectRatio === 'string') setAspectRatio(prefill.aspectRatio)
    if (typeof prefill.durationSec === 'number') setDurationSec(prefill.durationSec)
    setHdr(!!prefill.hdr)
    setLoop(!!prefill.loop)
  }, [prefill])

  // ------------------------------------------------------------- boards
  useEffect(() => {
    if (!user) return
    let alive = true
    void (async () => {
      try {
        const res = await fetch('/api/boards', { credentials: 'same-origin' })
        if (!res.ok) return
        const body = (await res.json()) as { boards?: { id: string; name: string }[] }
        if (alive && body.boards) setBoards(body.boards)
      } catch {
        // network hiccup — the picker simply stays empty
      }
    })()
    return () => {
      alive = false
    }
  }, [user])

  // --------------------------------------------------- provider tier (T14)
  useEffect(() => {
    if (!user) return
    let alive = true
    void (async () => {
      try {
        const res = await fetch('/api/providers/health', { credentials: 'same-origin' })
        if (!res.ok) return
        const body = (await res.json()) as Partial<ProviderHealthSummaryView>
        if (alive && typeof body.activeProvider === 'string') {
          setHealth({
            activeProvider: body.activeProvider,
            imageSdkAvailable: !!body.imageSdkAvailable,
            llmConfigured: !!body.llmConfigured,
            llmModel: body.llmModel ?? null,
            modelRoutes: body.modelRoutes ?? {},
            imageModelRoutes: body.imageModelRoutes ?? {},
          })
        }
      } catch {
        // network hiccup — the notice simply stays hidden
      }
    })()
    return () => {
      alive = false
    }
  }, [user])

  // --------------------------------------------------------------- feed
  async function refreshFeed(): Promise<void> {
    try {
      const res = await fetch('/api/jobs', { credentials: 'same-origin' })
      if (!res.ok) return
      const body = (await res.json()) as { jobs: JobView[] }
      setFeed(body.jobs)
    } catch {
      // transient — polling retries
    } finally {
      setFeedLoading(false)
    }
  }

  useEffect(() => {
    if (!user) {
      setFeedLoading(false)
      return
    }
    void refreshFeed()
  }, [user])

  const feedPending =
    feed.some((j) => !TERMINAL_STATUSES.includes(j.status)) ||
    (activeJob !== null && !TERMINAL_STATUSES.includes(activeJob.status))

  useEffect(() => {
    if (!user || !feedPending) return
    const timer = setInterval(() => void refreshFeed(), 2500)
    return () => clearInterval(timer)
  }, [user, feedPending])

  // Carry a remix prefill's closing frame forward as the opening pin. The
  // source path is public-only-if-guessable media; failure is non-fatal.
  useEffect(() => {
    if (!prefill?.startFramePath) return
    let alive = true
    void (async () => {
      try {
        const res = await fetch(prefill.startFramePath as string)
        if (!res.ok) return
        const blob = await res.blob()
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(blob)
        })
        if (alive) setPins((prev) => (prev.length ? prev : [{ dataUrl, name: 'remix source frame' }]))
      } catch {
        // skip the carry-over silently — the recipe still prefills
      }
    })()
    return () => {
      alive = false
    }
  }, [prefill])

  // ------------------------------------------------------------ costing
  const cost = mode === 'video' ? clipCost({ model, resolution, durationSec, hdr, loop }) : imageCost()

  // ---------------------------------------------------------- brainstorm
  async function enhance() {
    const source = prompt.trim()
    if (source.length < 3) {
      setError('Write a few words first — the enhancer needs something to dream with.')
      return
    }
    setError(null)
    setEnhancing(true)
    try {
      const res = await fetch('/api/brainstorm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ prompt: source }),
      })
      const body = (await res.json().catch(() => null)) as
        | { variants?: BrainstormVariant[] }
        | null
      // belt-and-suspenders: only adopt variants carrying a usable text — a
      // contract drift degrades to "no variants", never to a client crash.
      const safe = (body?.variants ?? []).filter(
        (v): v is BrainstormVariant =>
          !!v && typeof v.text === 'string' && v.text.trim().length > 0
      )
      if (res.ok && safe.length > 0) setVariants(safe)
      else setError('No variants came back — try rephrasing the idea.')
    } catch {
      setError('Network error while enhancing — please try again.')
    } finally {
      setEnhancing(false)
    }
  }

  function applyVariant(text: string) {
    setPrompt(text)
    setEnhancedPrompt(text)
    setVariants([])
  }

  // ------------------------------------------------------------ keyframes
  function onFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (!files.length) return
    const room = MAX_KEYFRAMES - pins.length
    const slice = files.slice(0, Math.max(room, 0))
    for (const file of slice) {
      const reader = new FileReader()
      reader.onload = () => {
        setPins((prev) =>
          prev.length >= MAX_KEYFRAMES
            ? prev
            : [...prev, { dataUrl: String(reader.result), name: file.name }]
        )
      }
      reader.readAsDataURL(file)
    }
    if (fileInput.current) fileInput.current.value = ''
    if (files.length > room) {
      setError(`A timeline holds at most ${MAX_KEYFRAMES} keyframes — the rest were skipped.`)
    }
  }

  function removePin(index: number) {
    setPins((prev) => prev.filter((_, i) => i !== index))
  }

  // -------------------------------------------------------------- submit
  async function submit(event?: React.FormEvent) {
    event?.preventDefault()
    setError(null)
    const trimmed = prompt.trim()
    if (trimmed.length < 3) {
      setError('Describe the dream in at least 3 characters.')
      return
    }
    setBusy(true)
    const idempotencyKey =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-rand`
    try {
      const body =
        mode === 'video'
          ? {
              prompt: trimmed,
              ...(enhancedPrompt ? { enhancedPrompt } : {}),
              model,
              resolution,
              aspectRatio,
              durationSec,
              hdr,
              loop,
              ...(pins.length ? { keyframes: pins } : {}),
              ...(boardId ? { boardId } : {}),
              idempotencyKey,
            }
          : {
              prompt: trimmed,
              aspectRatio,
              ...(boardId ? { boardId } : {}),
              idempotencyKey,
            }
      const res = await fetch(mode === 'video' ? '/api/generate' : '/api/image', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      })
      const payload = (await res.json().catch(() => null)) as
        | { job: JobView }
        | { error: string; message?: string }
        | null
      if (res.ok && payload && 'job' in payload) {
        setActiveJob(payload.job)
        setVariants([])
        void refreshFeed()
        onCreditsChanged?.()
        return
      }
      const message =
        payload && 'message' in payload && typeof payload.message === 'string'
          ? payload.message
          : null
      setError(message ?? 'Something went wrong — please try again.')
    } catch {
      setError('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  // -------------------------------------------------------------- polling
  useEffect(() => {
    if (!activeJob || TERMINAL_STATUSES.includes(activeJob.status)) return
    let alive = true
    const tick = async () => {
      try {
        const res = await fetch(`/api/jobs/${activeJob.id}`, { credentials: 'same-origin' })
        if (!res.ok) return
        const body = (await res.json()) as { job: JobView }
        if (alive) setActiveJob(body.job)
      } catch {
        // transient — the next interval retries
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), 1500)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [activeJob?.id, activeJob?.status])

  // A finished active job lands in the feed for good measure.
  useEffect(() => {
    if (activeJob && TERMINAL_STATUSES.includes(activeJob.status)) void refreshFeed()
  }, [activeJob?.status])

  // ------------------------------------------------------------- render
  if (!user) {
    return (
      <div className="px-4 py-16">
        <SignInInvitation what="start dreaming" />
      </div>
    )
  }

  const feedJobs = feed.filter((j) => j.id !== activeJob?.id)
  const empty = feedLoading === false && feedJobs.length === 0 && !activeJob

  return (
    <div className="relative min-h-screen">
      {/* --------------------------------------------------------- feed */}
      <div className="px-4 pt-4 pb-64 md:px-6">
        {prefill && (
          <p className="mb-4 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm text-primary">
            Remix loaded into the dock — adjust the recipe and dream it yourself. Nothing is charged until you submit.
          </p>
        )}

        {empty ? (
          <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
            <span className="size-12 rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 p-3 opacity-70" aria-hidden="true" />
            <h1 className="text-xl font-semibold tracking-tight">What will you dream today?</h1>
            <p className="max-w-sm text-sm text-muted-foreground">
              Your generations will appear here — prompt to clip with a 16-keyframe timeline, or a prism still.
              The dock below is the whole studio.
            </p>
          </div>
        ) : (
          <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 2xl:columns-4">
            {activeJob && <FeedCard job={activeJob} featured user={user} />}
            {feedLoading && !feedJobs.length && !activeJob
              ? Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="mb-4 h-64 break-inside-avoid animate-pulse rounded-2xl bg-muted/60"
                    aria-hidden="true"
                  />
                ))
              : feedJobs.map((job) => <FeedCard key={job.id} job={job} user={user} />)}
          </div>
        )}
      </div>

      {/* ---------------------------------------------------- prompt dock */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50">
        <div className="pointer-events-auto mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 pb-4">
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400"
            >
              {error}
            </p>
          )}

          {variants.length > 0 && (
            <div className="space-y-2 rounded-xl border border-border/60 bg-card/95 p-3 shadow-lg shadow-black/20 backdrop-blur">
              <p className="text-xs font-medium text-muted-foreground">Variants — tap one to adopt it</p>
              <div className="flex flex-col gap-2">
                {variants.map((variant) => (
                  <button
                    key={variant.style}
                    type="button"
                    onClick={() => applyVariant(variant.text)}
                    title={variant.blurb}
                    className="flex flex-col items-start gap-0.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-left transition hover:bg-primary/20"
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                      {variant.label}
                    </span>
                    <span className="text-xs text-foreground">{variant.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* T14 render truth — say what a "dream" actually is on this deployment. */}
          {health?.activeProvider === 'demo' && (
            <div
              data-testid="demo-tier-notice"
              role="note"
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400"
            >
              <span className="font-semibold">Demo tier</span> — this deployment has no
              generation provider wired: video renders are local storyboard composites
              {health.imageSdkAvailable
                ? ' of locally generated keyframes.'
                : ' of placeholder art, watermarked as simulated.'}{' '}
              Charges still apply and failed renders refund; wire a hosted provider key
              to render with a real model.
            </div>
          )}

          <form
            onSubmit={submit}
            className="overflow-hidden rounded-3xl border border-border/70 bg-card/95 shadow-2xl shadow-black/50 backdrop-blur"
          >
            {/* ------------------------------------------------ recipe tray */}
            <div className="space-y-3 border-b border-border/60 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="sr-only">Creation mode</span>
                {(['video', 'image'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    aria-pressed={mode === m}
                    className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition ${
                      mode === m
                        ? 'bg-primary text-primary-foreground'
                        : 'border border-border/60 text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {m}
                  </button>
                ))}

                <span className="mx-1 h-4 w-px bg-border/70" aria-hidden="true" />

                {mode === 'video' &&
                  VIDEO_MODELS.map((m) => (
                    <Chip key={m} active={model === m} onClick={() => setModel(m)}>
                      {MODEL_LABELS[m] ?? m}
                    </Chip>
                  ))}

                {mode === 'video' &&
                  RESOLUTIONS.map((r) => (
                    <Chip key={r} active={resolution === r} onClick={() => setResolution(r)}>
                      {r}
                    </Chip>
                  ))}

                {mode === 'video' &&
                  DURATIONS.map((d) => (
                    <Chip key={d} active={durationSec === d} onClick={() => setDurationSec(d)}>
                      {d}s
                    </Chip>
                  ))}

                <span className="mx-1 h-4 w-px bg-border/70" aria-hidden="true" />

                {ASPECT_RATIOS.map((a) => (
                  <Chip key={a} active={aspectRatio === a} onClick={() => setAspectRatio(a)}>
                    {a}
                  </Chip>
                ))}

                {mode === 'video' && (
                  <>
                    <label className="flex cursor-pointer items-center gap-1.5 rounded-full border border-border/60 px-3 py-1 text-xs text-muted-foreground transition hover:text-foreground">
                      <input
                        type="checkbox"
                        checked={hdr}
                        onChange={(e) => setHdr(e.target.checked)}
                        className="size-3.5 accent-primary"
                      />
                      HDR
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5 rounded-full border border-border/60 px-3 py-1 text-xs text-muted-foreground transition hover:text-foreground">
                      <input
                        type="checkbox"
                        checked={loop}
                        onChange={(e) => setLoop(e.target.checked)}
                        className="size-3.5 accent-primary"
                      />
                      Loop
                    </label>
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {mode === 'video' && (
                  <>
                    <Label htmlFor="dream-keyframes" className="sr-only">
                      Keyframe timeline ({pins.length}/{MAX_KEYFRAMES})
                    </Label>
                    <div className="flex flex-wrap gap-1.5">
                      {pins.map((pin, i) => (
                        <span
                          key={`${pin.name ?? 'pin'}-${i}`}
                          className="group relative overflow-hidden rounded-lg border border-border/60"
                        >
                          { }
                          <img src={pin.dataUrl} alt={`Keyframe ${i + 1}`} className="size-10 object-cover" />
                          <button
                            type="button"
                            onClick={() => removePin(i)}
                            aria-label={`Remove keyframe ${i + 1}`}
                            className="absolute inset-0 bg-black/70 text-[10px] text-white opacity-0 transition group-hover:opacity-100"
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                      <label className="flex size-10 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border text-[9px] leading-tight text-muted-foreground transition hover:border-primary/50 hover:text-foreground">
                        <Paperclip className="size-3.5" aria-hidden="true" />
                        <span className="sr-only">pin frames</span>
                        <span aria-hidden="true">pin</span>
                        <input
                          ref={fileInput}
                          id="dream-keyframes"
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={onFiles}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </>
                )}

                {boards.length > 0 && (
                  <select
                    aria-label="Board"
                    value={boardId}
                    onChange={(e) => setBoardId(e.target.value)}
                    className="h-8 rounded-full border border-border/60 bg-transparent px-3 text-xs text-muted-foreground"
                  >
                    <option value="">No board</option>
                    {boards.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                )}

                <span className="ml-auto text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{cost.toLocaleString()} credits</span>
                  {' · '}balance {user.credits.toLocaleString()} on {user.plan} — failures refund in full
                </span>
              </div>
            </div>

            {/* -------------------------------------------------- dock row */}
            <div className="flex items-end gap-2 p-2.5">
              <SlidersHorizontal className="mb-2.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <Label htmlFor="dream-prompt" className="sr-only">
                  Prompt
                </Label>
                <Textarea
                  id="dream-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void submit()
                    }
                  }}
                  placeholder={
                    mode === 'video'
                      ? 'What will you dream today?'
                      : 'Describe the still — chrome dunes under a violet dusk…'
                  }
                  rows={1}
                  className="max-h-36 min-h-10 resize-none border-0 bg-transparent p-2.5 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
                />
                <p className="sr-only">{prompt.trim().length} characters — at least 3 to submit</p>
              </div>
              <button
                type="button"
                onClick={() => void enhance()}
                disabled={enhancing}
                title="Enhance the prompt with brainstorm variants"
                className="flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground transition hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
              >
                <Wand2 className="size-4" aria-hidden="true" />
                {enhancing ? 'Dreaming…' : 'Enhance'}
              </button>
              <button
                type="submit"
                aria-label="Dream it"
                title={busy ? 'Rendering the request…' : 'Dream it'}
                disabled={busy}
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25 transition hover:bg-primary/90 disabled:opacity-50"
              >
                <ArrowUp className="size-5" aria-hidden="true" />
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------- feed card
function FeedCard({ job, featured, user }: { job: JobView; featured?: boolean; user: SessionUser }) {
  const render = mainAsset(job)
  const pending = !TERMINAL_STATUSES.includes(job.status)

  return (
    <article className="group relative mb-4 break-inside-avoid overflow-hidden rounded-2xl border border-border/60 bg-card/60">
      <div className={`relative ${aspectClass(job.aspectRatio)} bg-black`}>
        {render && job.kind === 'video' ? (
          <video
            data-testid={featured ? 'rendered-video' : undefined}
            src={render.path}
            controls={featured}
            autoPlay
            muted
            loop
            playsInline
            className="size-full object-cover"
          />
        ) : render ? (
          <img
            data-testid={featured ? 'rendered-still' : undefined}
            src={render.path}
            alt={job.prompt}
            className="size-full object-cover"
          />
        ) : pending ? (
          <div className="flex size-full flex-col items-center justify-center gap-2 bg-muted/40">
            <span className="size-8 animate-pulse rounded-full bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500" />
            <p className="text-xs text-muted-foreground">
              {job.progress > 0 ? `${job.progress}%` : 'in the pipeline'}
            </p>
          </div>
        ) : (
          <div className="flex size-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
            {job.status === 'failed'
              ? 'The render failed and the credits were refunded.'
              : 'No render for this dream.'}
          </div>
        )}

        {/* hover overlay — prompt on hover, the Dream-Machine way */}
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/70 via-black/10 to-transparent opacity-0 transition group-hover:opacity-100">
          <p className="line-clamp-2 px-3 pb-2 pt-10 text-xs text-white/90">{job.prompt}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 p-2.5">
        <StatusChip status={job.status} />
        <MetaChip>{job.model}</MetaChip>
        <MetaChip>{job.aspectRatio}</MetaChip>
        {job.kind === 'video' && <MetaChip>{job.durationSec}s</MetaChip>}
        <MetaChip>{job.creditsCharged} cr</MetaChip>
        {job.placeholderRender && <MetaChip>simulated render</MetaChip>}
        {featured && (
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <AvatarBlob seed={user.avatarSeed} name={user.name} size="sm" />
            {user.name}
          </span>
        )}
      </div>

      {featured && job.status === 'failed' && job.errorMessage && (
        <p role="alert" className="border-t border-border/60 p-3 text-xs text-red-500">
          {job.errorMessage} — the {job.creditsCharged} credits were refunded.
        </p>
      )}
      {featured && job.status === 'completed' && (
        <p className="border-t border-border/60 p-3 text-xs text-muted-foreground">
          Dream rendered —{' '}
          <Link href="/history" className="text-primary underline-offset-4 hover:underline">
            extend, remix or share it from your history
          </Link>
          .
        </p>
      )}
    </article>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-2.5 py-1 text-xs transition ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'border border-border/60 text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}
