'use client'

import { ActiveJobCard } from '@/components/reelforge/active-job-card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Sparkles, Trash2, Upload, Wand2, Zap } from 'lucide-react'
import * as React from 'react'
import {
  ASPECT_RATIOS,
  DURATIONS,
  TIER_META,
  creditCost,
  providerCostUsd,
  type AspectRatio,
  type Tier,
} from '@/lib/pricing'
import type { JobDto } from '@/lib/types'
import { cn } from '@/lib/utils'

export interface SubmitParams {
  prompt: string
  tier: Tier
  durationSec: number
  aspectRatio: AspectRatio
  startFrame: string | null
  endFrame: string | null
  board: string | null
}

export type SubmitOutcome =
  | { ok: true; jobId: string }
  | { ok: false; status: number; error: string; message: string }

/** Phase 3 remix: a job's recipe handed to the Studio for re-forging. */
export interface RemixRecipe {
  prompt: string
  tier: Tier
  durationSec: number
  aspectRatio: AspectRatio
  board: string | null
  startFrame: string | null
}

const MAX_PROMPT = 800
const MAX_BOARD = 48

const ASPECT_MINIS: Record<AspectRatio, { className: string; label: string }> = {
  '16:9': { className: 'aspect-video w-14', label: 'Widescreen' },
  '9:16': { className: 'aspect-[9/16] h-14 w-8', label: 'Vertical' },
  '1:1': { className: 'aspect-square w-11', label: 'Square' },
}

/** Optional pinned-frame upload: file input, thumbnail preview, remove button. */
function PinnedFrameInput({
  id,
  title,
  hint,
  previewAlt,
  uploadLabel,
  uploadAriaLabel,
  removeAriaLabel,
  value,
  onChange,
}: {
  id: string
  title: string
  hint: string
  previewAlt: string
  uploadLabel: string
  uploadAriaLabel: string
  removeAriaLabel: string
  value: string | null
  onChange: (next: string | null) => void
}) {
  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return
    if (file.size > 6 * 1024 * 1024) return
    const reader = new FileReader()
    reader.onload = () => onChange(typeof reader.result === 'string' ? reader.result : null)
    reader.readAsDataURL(file)
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm font-semibold">
        {title} <span className="font-normal text-muted-foreground">(optional)</span>
      </Label>
      {value ? (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-background/40 p-3">
          <img src={value} alt={previewAlt} className="h-16 w-24 rounded-md border border-border object-cover" />
          <div className="flex-1">
            <p className="text-xs text-muted-foreground">{hint}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 rounded-lg text-muted-foreground hover:text-destructive"
            onClick={() => onChange(null)}
            aria-label={removeAriaLabel}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-background/30 p-4 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground">
          <Upload className="size-4" aria-hidden="true" />
          {uploadLabel}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={handleFile}
            aria-label={uploadAriaLabel}
          />
        </label>
      )}
    </div>
  )
}

export function StudioTab({
  credits,
  boards = [],
  activeJob,
  submitting,
  onSubmit,
  remix = null,
  onRemixApplied,
}: {
  credits: number | null
  boards: string[]
  activeJob: JobDto | null
  submitting: boolean
  onSubmit: (params: SubmitParams) => Promise<SubmitOutcome>
  /** Phase 3: when set, the composer is prefilled with this recipe (remix). */
  remix?: RemixRecipe | null
  /** Called once a remix recipe has been applied so the parent can clear it. */
  onRemixApplied?: () => void
}) {
  const [prompt, setPrompt] = React.useState('')
  const [tier, setTier] = React.useState<Tier>('draft')
  const [durationSec, setDurationSec] = React.useState<number>(5)
  const [aspectRatio, setAspectRatio] = React.useState<AspectRatio>('16:9')
  const [startFrame, setStartFrame] = React.useState<string | null>(null)
  const [endFrame, setEndFrame] = React.useState<string | null>(null)
  const [board, setBoard] = React.useState('')

  // Phase 3 remix handoff: load the recipe into the composer once, then let
  // the parent clear it (no charge until the user hits "Forge video").
  React.useEffect(() => {
    if (!remix) return
    setPrompt(remix.prompt.slice(0, MAX_PROMPT))
    setTier(remix.tier)
    setDurationSec((DURATIONS as readonly number[]).includes(remix.durationSec) ? remix.durationSec : 5)
    setAspectRatio(remix.aspectRatio)
    setBoard(remix.board ?? '')
    setStartFrame(remix.startFrame)
    setEndFrame(null)
    onRemixApplied?.()
  }, [remix])

  const cost = creditCost(tier, durationSec)
  const dollarCost = providerCostUsd(tier, durationSec)
  const balance = credits ?? 0
  const insufficient = balance < cost
  const trimmedPrompt = prompt.trim()
  const canSubmit = trimmedPrompt.length >= 3 && !submitting && !insufficient

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    const trimmedBoard = board.trim().slice(0, MAX_BOARD)
    const outcome = await onSubmit({
      prompt: trimmedPrompt,
      tier,
      durationSec,
      aspectRatio,
      startFrame,
      endFrame,
      board: trimmedBoard.length > 0 ? trimmedBoard : null,
    })
    if (outcome.ok) {
      setStartFrame(null)
      setEndFrame(null)
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} aria-label="Generation composer" noValidate>
        <Card className="border-border/70 bg-card/70 ember-glow">
          <CardContent className="space-y-6 p-4 sm:p-6">
            {/* Prompt */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="rf-prompt" className="text-sm font-semibold">
                  Describe your shot
                </Label>
                <span
                  className={`text-xs tabular-nums ${
                    trimmedPrompt.length > MAX_PROMPT ? 'text-destructive' : 'text-muted-foreground'
                  }`}
                  aria-live="polite"
                >
                  {prompt.length}/{MAX_PROMPT}
                </span>
              </div>
              <Textarea
                id="rf-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value.slice(0, MAX_PROMPT))}
                onKeyDown={(event) => {
                  // R9: Ctrl/Cmd+Enter submits the composer from the textarea.
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }
                }}
                placeholder="A lantern festival over a night river, reflections shimmering, slow camera drift…"
                className="min-h-28 resize-y border-border bg-background/60 text-base leading-relaxed placeholder:text-muted-foreground/60"
                aria-describedby="rf-prompt-hint"
              />
              <p id="rf-prompt-hint" className="text-xs text-muted-foreground">
                Prompts pass a safety filter before any credits are reserved.
                Press <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">Ctrl</kbd>
                {' + '}
                <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">Enter</kbd>
                {' '}to forge.
              </p>
            </div>

            {/* Tier */}
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">Render tier</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Render tier">
                {(Object.keys(TIER_META) as Tier[]).map((key) => {
                  const meta = TIER_META[key]
                  const selected = tier === key
                  return (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setTier(key)}
                      className={cn(
                        'flex min-h-11 flex-col items-start gap-1 rounded-xl border p-4 text-left transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                        selected
                          ? 'border-primary bg-primary/10 shadow-sm shadow-primary/10'
                          : 'border-border bg-background/40 hover:border-primary/40 hover:bg-accent/40'
                      )}
                    >
                      <span className="flex w-full items-center justify-between">
                        <span className="flex items-center gap-2 text-sm font-semibold">
                          {key === 'quality' ? (
                            <Sparkles className="size-4 text-amber-500" aria-hidden="true" />
                          ) : (
                            <Zap className="size-4 text-orange-500" aria-hidden="true" />
                          )}
                          {meta.label}
                        </span>
                        {selected && (
                          <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                            selected
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">{meta.blurb}</span>
                      <span className="mt-1 text-xs font-medium text-primary/90">
                        {meta.rate} credits/sec · {meta.cost} provider cost
                      </span>
                    </button>
                  )
                })}
              </div>
            </fieldset>

            {/* Duration + aspect */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold">Duration</legend>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Duration in seconds">
                  {DURATIONS.map((seconds) => {
                    const selected = durationSec === seconds
                    return (
                      <button
                        key={seconds}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setDurationSec(seconds)}
                        className={cn(
                          'h-11 min-w-11 rounded-lg border px-3 text-sm font-medium tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                          selected
                            ? 'border-primary bg-primary/15 text-primary'
                            : 'border-border bg-background/40 text-muted-foreground hover:border-primary/40 hover:text-foreground'
                        )}
                      >
                        {seconds}s
                      </button>
                    )
                  })}
                </div>
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold">Aspect ratio</legend>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Aspect ratio">
                  {ASPECT_RATIOS.map((ratio) => {
                    const mini = ASPECT_MINIS[ratio]
                    const selected = aspectRatio === ratio
                    return (
                      <button
                        key={ratio}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setAspectRatio(ratio)}
                        className={cn(
                          'flex h-[70px] min-w-11 flex-1 flex-col items-center justify-center gap-1.5 rounded-lg border px-3 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                          selected
                            ? 'border-primary bg-primary/15 text-primary'
                            : 'border-border bg-background/40 text-muted-foreground hover:border-primary/40 hover:text-foreground'
                        )}
                      >
                        <span
                          className={cn(
                            mini.className,
                            'rounded-sm border-2',
                            selected ? 'border-primary' : 'border-muted-foreground/40'
                          )}
                          aria-hidden="true"
                        />
                        <span className="text-xs font-medium">{ratio}</span>
                      </button>
                    )
                  })}
                </div>
              </fieldset>
            </div>

            {/* Pinned frames */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <PinnedFrameInput
                id="rf-start-frame"
                title="Start frame"
                hint="Your render will open from this frame."
                previewAlt="Uploaded start frame preview"
                uploadLabel="Upload an opening still"
                uploadAriaLabel="Upload start frame image"
                removeAriaLabel="Remove start frame"
                value={startFrame}
                onChange={setStartFrame}
              />
              <PinnedFrameInput
                id="rf-end-frame"
                title="End frame"
                hint="Your render will land on this frame."
                previewAlt="Uploaded end frame preview"
                uploadLabel="Upload a closing still"
                uploadAriaLabel="Upload end frame image"
                removeAriaLabel="Remove end frame"
                value={endFrame}
                onChange={setEndFrame}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Pinned stills must be PNG, JPG or WebP, up to 6MB each. The clip runs start → storyboard → end.
            </p>

            {/* Board */}
            <div className="space-y-2">
              <Label htmlFor="rf-board" className="text-sm font-semibold">
                Board <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <input
                id="rf-board"
                list="rf-board-options"
                value={board}
                onChange={(event) => setBoard(event.target.value.slice(0, MAX_BOARD))}
                placeholder="e.g. Night Market"
                maxLength={MAX_BOARD}
                className="h-11 w-full rounded-lg border border-border bg-background/60 px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                aria-describedby="rf-board-hint"
              />
              <datalist id="rf-board-options">
                {boards.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <p id="rf-board-hint" className="text-xs text-muted-foreground">
                Group this generation onto a board — type a new name or pick an existing one.
              </p>
            </div>

            {/* Cost preview + submit */}
            <div className="flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm" aria-live="polite">
                <p className="font-semibold text-foreground">
                  Cost: <span className="text-primary tabular-nums">{cost} credits</span>
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    ≈ ${dollarCost.toFixed(2)} provider · {durationSec}s clip
                  </span>
                </p>
                <p className={`text-xs ${insufficient ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {insufficient
                    ? `Not enough credits — you have ${balance}, this render needs ${cost}.`
                    : `Balance after render: ${(balance - cost).toLocaleString()} credits`}
                </p>
              </div>
              <Button
                type="submit"
                size="lg"
                disabled={!canSubmit}
                className="h-12 min-w-11 gap-2 rounded-xl px-6 text-base font-semibold"
              >
                {submitting ? (
                  <>
                    <span
                      className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                      aria-hidden="true"
                    />
                    Forging…
                  </>
                ) : (
                  <>
                    <Wand2 className="size-4" aria-hidden="true" />
                    Forge video
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      {activeJob && <ActiveJobCard job={activeJob} />}
    </div>
  )
}
