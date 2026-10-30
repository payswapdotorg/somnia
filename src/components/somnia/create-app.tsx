// src/components/somnia/create-app.tsx — the cockpit composer (T4b).
//
// The primary creation surface: video and prism image modes, brainstorm
// variants, the full recipe (model x resolution x aspect x duration x HDR x
// loop), up to 16 pinned keyframes, board filing, an honest cost preview
// computed with the same plans.ts math the server charges by, and live
// polling of the accepted job through the render pipeline to the finished
// clip. Talks the exact /api/{boards,brainstorm,generate,image,jobs/:id}
// contract.
'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
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
  const [variants, setVariants] = useState<string[]>([])
  const [enhancing, setEnhancing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeJob, setActiveJob] = useState<JobView | null>(null)
  // T14 render truth — the provider tier this deployment renders on, fetched
  // once so the composer can tell the user what a "dream" actually is here.
  const [health, setHealth] = useState<ProviderHealthSummaryView | null>(null)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const body = (await res.json().catch(() => null)) as { variants?: string[] } | null
      if (res.ok && body?.variants?.length) setVariants(body.variants)
      else setError('No variants came back — try rephrasing the idea.')
    } catch {
      setError('Network error while enhancing — please try again.')
    } finally {
      setEnhancing(false)
    }
  }

  function applyVariant(variant: string) {
    setPrompt(variant)
    setEnhancedPrompt(variant)
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
  async function submit(event: React.FormEvent) {
    event.preventDefault()
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

  // ------------------------------------------------------------- render
  if (!user) {
    return (
      <div className="py-16">
        <SignInInvitation what="start dreaming" />
      </div>
    )
  }

  const render = activeJob ? mainAsset(activeJob) : null

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
      {/* ---------------------------------------------------- composer */}
      <form onSubmit={submit} className="space-y-6">
        <div className="flex gap-2" role="group" aria-label="Creation mode">
          {(['video', 'image'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium capitalize transition ${
                mode === m
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border/60 text-muted-foreground hover:text-foreground'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <Label htmlFor="dream-prompt">Prompt</Label>
          <Textarea
            id="dream-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              mode === 'video'
                ? 'Describe the dream — a paper boat drifting through neon canals…'
                : 'Describe the still — chrome dunes under a violet dusk…'
            }
            rows={4}
            className="resize-none"
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {prompt.trim().length} characters — at least 3 to submit
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void enhance()}
              disabled={enhancing}
            >
              {enhancing ? 'Dreaming…' : 'Enhance'}
            </Button>
          </div>
        </div>

        {variants.length > 0 && (
          <div className="space-y-2 rounded-xl border border-border/60 bg-muted/30 p-4">
            <p className="text-xs font-medium text-muted-foreground">Variants — tap one to adopt it</p>
            <div className="flex flex-wrap gap-2">
              {variants.map((variant) => (
                <button
                  key={variant}
                  type="button"
                  onClick={() => applyVariant(variant)}
                  className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs text-foreground transition hover:bg-primary/20"
                >
                  {variant}
                </button>
              ))}
            </div>
          </div>
        )}

        {mode === 'video' && (
          <div className="space-y-2">
            <Label htmlFor="dream-keyframes">
              Keyframe timeline <span className="text-muted-foreground">({pins.length}/{MAX_KEYFRAMES})</span>
            </Label>
            <div className="flex flex-wrap gap-2">
              {pins.map((pin, i) => (
                <span
                  key={`${pin.name ?? 'pin'}-${i}`}
                  className="group relative overflow-hidden rounded-lg border border-border/60"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pin.dataUrl} alt={`Keyframe ${i + 1}`} className="size-16 object-cover" />
                  <button
                    type="button"
                    onClick={() => removePin(i)}
                    aria-label={`Remove keyframe ${i + 1}`}
                    className="absolute inset-x-0 bottom-0 bg-black/70 py-0.5 text-[10px] text-white opacity-0 transition group-hover:opacity-100"
                  >
                    remove
                  </button>
                </span>
              ))}
              <label className="flex size-16 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border text-[10px] text-muted-foreground transition hover:border-primary/50 hover:text-foreground">
                <span>pin</span>
                <span>frame</span>
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
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400"
          >
            {error}
          </p>
        )}

        {/* T14 render truth — say what a "dream" actually is on this deployment. */}
        {health?.activeProvider === 'demo' && (
          <div
            data-testid="demo-tier-notice"
            role="note"
            className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400"
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

        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? 'Rendering the request…' : 'Dream it'}
        </Button>
      </form>

      {/* ------------------------------------------------------- recipe */}
      <aside className="space-y-5 rounded-2xl border border-border/60 bg-card/70 p-5">
        {mode === 'video' && (
          <>
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-muted-foreground">Model</legend>
              <div className="flex flex-wrap gap-2">
                {VIDEO_MODELS.map((m) => (
                  <Chip key={m} active={model === m} onClick={() => setModel(m)}>
                    {MODEL_LABELS[m] ?? m}
                  </Chip>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-muted-foreground">Resolution</legend>
              <div className="flex flex-wrap gap-2">
                {RESOLUTIONS.map((r) => (
                  <Chip key={r} active={resolution === r} onClick={() => setResolution(r)}>
                    {r}
                  </Chip>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-muted-foreground">Duration</legend>
              <div className="flex flex-wrap gap-2">
                {DURATIONS.map((d) => (
                  <Chip key={d} active={durationSec === d} onClick={() => setDurationSec(d)}>
                    {d}s
                  </Chip>
                ))}
              </div>
            </fieldset>
          </>
        )}

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-muted-foreground">Aspect ratio</legend>
          <div className="flex flex-wrap gap-2">
            {ASPECT_RATIOS.map((a) => (
              <Chip key={a} active={aspectRatio === a} onClick={() => setAspectRatio(a)}>
                {a}
              </Chip>
            ))}
          </div>
        </fieldset>

        {mode === 'video' && (
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hdr}
                onChange={(e) => setHdr(e.target.checked)}
                className="size-4 accent-primary"
              />
              HDR <span className="text-xs text-muted-foreground">(2x)</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={loop}
                onChange={(e) => setLoop(e.target.checked)}
                className="size-4 accent-primary"
              />
              Loop <span className="text-xs text-muted-foreground">(free)</span>
            </label>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="dream-board">Board</Label>
          <select
            id="dream-board"
            aria-label="Board"
            value={boardId}
            onChange={(e) => setBoardId(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-transparent px-3 text-sm"
          >
            <option value="">No board</option>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-xl bg-muted/50 p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium text-muted-foreground">This dream costs</span>
            <span className="text-lg font-semibold tracking-tight">{cost.toLocaleString()} credits</span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Balance: {user.credits.toLocaleString()} credits on the {user.plan} plan — failed renders refund in full.
          </p>
        </div>
      </aside>

      {/* --------------------------------------------------- active job */}
      {activeJob && (
        <section className="lg:col-span-2">
          <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/70">
            <div className={`relative ${aspectClass(activeJob.aspectRatio)} bg-black`}>
              {render && activeJob.kind === 'video' ? (
                <video
                  data-testid="rendered-video"
                  src={render.path}
                  controls
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="size-full object-contain"
                />
              ) : render ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  data-testid="rendered-still"
                  src={render.path}
                  alt={activeJob.prompt}
                  className="size-full object-contain"
                />
              ) : (
                <div className="flex size-full flex-col items-center justify-center gap-3 text-muted-foreground">
                  <span className="size-10 animate-pulse rounded-full bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500" />
                  <p className="text-sm">{activeJob.progress > 0 ? `${activeJob.progress}%` : 'in the pipeline'}</p>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 p-4">
              <StatusChip status={activeJob.status} />
              <MetaChip>{activeJob.model}</MetaChip>
              <MetaChip>{activeJob.resolution}</MetaChip>
              <MetaChip>{activeJob.aspectRatio}</MetaChip>
              {activeJob.kind === 'video' && <MetaChip>{activeJob.durationSec}s</MetaChip>}
              <MetaChip>{activeJob.creditsCharged} credits</MetaChip>
              {activeJob.placeholderRender && <MetaChip>simulated render</MetaChip>}
              <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                <AvatarBlob seed={user.avatarSeed} name={user.name} size="sm" />
                {user.name}
              </span>
            </div>
            {activeJob.status === 'failed' && activeJob.errorMessage && (
              <p role="alert" className="border-t border-border/60 p-4 text-sm text-red-500">
                {activeJob.errorMessage} — the {activeJob.creditsCharged} credits were refunded.
              </p>
            )}
            {activeJob.status === 'completed' && (
              <p className="border-t border-border/60 p-4 text-sm text-muted-foreground">
                Dream rendered. File it to a board, share it unlisted, or keep dreaming —{' '}
                <Link href="/history" className="text-primary underline-offset-4 hover:underline">
                  it&rsquo;s in your history
                </Link>
                .
              </p>
            )}
          </div>
        </section>
      )}
    </div>
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
      className={`rounded-lg px-3 py-1 text-sm transition ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'border border-border/60 text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}
