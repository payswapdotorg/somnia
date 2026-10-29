'use client'

import { BoardChip, KindChip, StatusChip, TierChip, VariantChip, VersionChip, excerpt, formatTimestamp } from '@/components/reelforge/bits'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  ASPECT_RATIOS,
  CAMERA_CREDITS,
  REFRAME_CREDITS,
  RESTYLE_CREDITS,
  creditCost,
  type AspectRatio,
} from '@/lib/pricing'
import { CAMERA_PRESET_META, type CameraPresetId } from '@/lib/presets'
import { RESTYLE_STYLES, type RestyleStyleId } from '@/lib/styles'
import type { JobDto, JobVariantDto } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Camera, ChevronRight, Clapperboard, Crop, Download, FastForward, History, Palette, PenLine, Play, RotateCw, Shuffle } from 'lucide-react'
import * as React from 'react'

export type EditOutcome =
  | { ok: true; jobId: string; creditsCharged: number }
  | { ok: false; status: number; error: string; message: string }

export type TransformOutcome =
  | { ok: true; variant: JobVariantDto; creditsCharged: number; alreadyExisted: boolean }
  | { ok: false; status: number; error: string; message: string }

const MAX_INSTRUCTION = 240
const MIN_CAMERA_STILLS = 3

function aspectClassFor(ratio: string): string {
  return ratio === '16:9' ? 'aspect-video' : ratio === '9:16' ? 'aspect-[9/16]' : 'aspect-square'
}

const ASPECT_MINIS: Record<AspectRatio, string> = {
  '16:9': 'aspect-video w-10',
  '9:16': 'aspect-[9/16] h-10 w-6',
  '1:1': 'aspect-square w-8',
}

/** Ordered still count of a job: pinned start + keyframes + pinned end. */
function stillCount(job: JobDto): number {
  return job.frames.length + (job.startFramePath ? 1 : 0) + (job.endFramePath ? 1 : 0)
}

export function HistoryTab({
  jobs,
  busyRerunId,
  busyExtendId,
  onRerun,
  onExtend,
  onOpenStudio,
  onEdit,
  onReframe,
  onCamera,
  onRestyle,
  onRemix,
}: {
  jobs: JobDto[]
  busyRerunId: string | null
  busyExtendId: string | null
  onRerun: (job: JobDto) => void
  onExtend: (job: JobDto) => void
  onOpenStudio: () => void
  /** Phase 3: submit an instruction-based edit (child job, standard charge). */
  onEdit: (job: JobDto, instruction: string) => Promise<EditOutcome>
  /** Phase 3: re-crop the clip to a new aspect (flat 10 credits). */
  onReframe: (job: JobDto, aspect: AspectRatio) => Promise<TransformOutcome>
  /** Phase 3: re-shoot the stills with a camera move (flat 15 credits). */
  onCamera: (job: JobDto, preset: CameraPresetId) => Promise<TransformOutcome>
  /** Phase 11 (N5): re-render the clip through a style grade (flat 12 credits). */
  onRestyle: (job: JobDto, style: RestyleStyleId) => Promise<TransformOutcome>
  /** Phase 3: prefill the Studio with this job's recipe (no charge). */
  onRemix: (job: JobDto) => void
}) {
  const [selected, setSelected] = React.useState<JobDto | null>(null)
  const [boardFilter, setBoardFilter] = React.useState<string>('__all__')
  const [editingJob, setEditingJob] = React.useState<JobDto | null>(null)
  const [instruction, setInstruction] = React.useState('')
  const [reframingJob, setReframingJob] = React.useState<JobDto | null>(null)
  const [reframeAspect, setReframeAspect] = React.useState<AspectRatio | null>(null)
  const [reshootingJob, setReshootingJob] = React.useState<JobDto | null>(null)
  const [cameraPreset, setCameraPreset] = React.useState<CameraPresetId>('push-in')
  const [restylingJob, setRestylingJob] = React.useState<JobDto | null>(null)
  const [restyleStyle, setRestyleStyle] = React.useState<RestyleStyleId>('noir')
  const [busyEdit, setBusyEdit] = React.useState(false)
  const [busyTransform, setBusyTransform] = React.useState(false)

  const boards = React.useMemo(() => {
    const names = new Set<string>()
    for (const job of jobs) {
      if (job.board) names.add(job.board)
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }, [jobs])

  const visible = React.useMemo(() => {
    if (boardFilter === '__all__') return jobs
    if (boardFilter === '__none__') return jobs.filter((job) => !job.board)
    return jobs.filter((job) => job.board === boardFilter)
  }, [jobs, boardFilter])

  /** Full edit thread of a job (ancestors → self → descendants), from the
   *  loaded jobs window. Jobs outside the window simply end the walk. */
  const threadOf = React.useCallback(
    (job: JobDto): JobDto[] => {
      const byId = new Map(jobs.map((j) => [j.id, j]))
      const ancestors: JobDto[] = []
      let cursor = job.parentJobId ? byId.get(job.parentJobId) : undefined
      while (cursor && ancestors.length < 20) {
        ancestors.unshift(cursor)
        cursor = cursor.parentJobId ? byId.get(cursor.parentJobId) : undefined
      }
      const descendants: JobDto[] = []
      const queue: JobDto[] = [job]
      const seen = new Set<string>([job.id])
      while (queue.length > 0 && descendants.length < 20) {
        const current = queue.shift()
        if (!current) break
        for (const child of jobs) {
          if (child.parentJobId === current.id && !seen.has(child.id)) {
            seen.add(child.id)
            descendants.push(child)
            queue.push(child)
          }
        }
      }
      descendants.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      return [...ancestors, job, ...descendants]
    },
    [jobs]
  )

  /** Fold a freshly produced variant into a job DTO (deduped by path). */
  const withVariant = React.useCallback((job: JobDto, variant: JobVariantDto): JobDto => {
    return { ...job, variants: [...job.variants.filter((v) => v.path !== variant.path), variant] }
  }, [])

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-card/40 px-6 py-16 text-center">
        <History className="size-10 text-muted-foreground/50" aria-hidden="true" />
        <div>
          <p className="font-semibold">No generations yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Your rendered clips and storyboards will collect here.
          </p>
        </div>
        <Button onClick={onOpenStudio} className="h-11 min-w-11 rounded-xl px-5">
          <Clapperboard className="mr-2 size-4" aria-hidden="true" />
          Open the Studio
        </Button>
      </div>
    )
  }

  async function submitEdit(event: React.FormEvent) {
    event.preventDefault()
    if (!editingJob) return
    const trimmed = instruction.trim()
    if (trimmed.length < 3 || busyEdit) return
    setBusyEdit(true)
    try {
      const outcome = await onEdit(editingJob, trimmed)
      if (outcome.ok) {
        setEditingJob(null)
        setInstruction('')
        setSelected(null)
      }
    } finally {
      setBusyEdit(false)
    }
  }

  async function submitReframe(event: React.FormEvent) {
    event.preventDefault()
    if (!reframingJob || !reframeAspect || busyTransform) return
    setBusyTransform(true)
    try {
      const outcome = await onReframe(reframingJob, reframeAspect)
      if (outcome.ok) {
        // Re-open the detail dialog with the new variant folded in.
        setSelected(withVariant(reframingJob, outcome.variant))
        setReframingJob(null)
      }
    } finally {
      setBusyTransform(false)
    }
  }

  async function submitCamera(event: React.FormEvent) {
    event.preventDefault()
    if (!reshootingJob || busyTransform) return
    setBusyTransform(true)
    try {
      const outcome = await onCamera(reshootingJob, cameraPreset)
      if (outcome.ok) {
        // Re-open the detail dialog with the new variant folded in.
        setSelected(withVariant(reshootingJob, outcome.variant))
        setReshootingJob(null)
      }
    } finally {
      setBusyTransform(false)
    }
  }

  async function submitRestyle(event: React.FormEvent) {
    event.preventDefault()
    if (!restylingJob || busyTransform) return
    setBusyTransform(true)
    try {
      const outcome = await onRestyle(restylingJob, restyleStyle)
      if (outcome.ok) {
        setSelected(withVariant(restylingJob, outcome.variant))
        setRestylingJob(null)
      }
    } finally {
      setBusyTransform(false)
    }
  }

  function openEditDialog(job: JobDto) {
    setInstruction('')
    setEditingJob(job)
    setSelected(null)
  }

  function openReframeDialog(job: JobDto) {
    const alternatives = ASPECT_RATIOS.filter((ratio) => ratio !== job.aspectRatio)
    setReframeAspect(alternatives[0] ?? '9:16')
    setReframingJob(job)
    setSelected(null)
  }

  function openCameraDialog(job: JobDto) {
    setCameraPreset('push-in')
    setReshootingJob(job)
    setSelected(null)
  }

  function openRestyleDialog(job: JobDto) {
    setRestyleStyle('noir')
    setRestylingJob(job)
    setSelected(null)
  }

  return (
    <>
      <div className="space-y-3">
        <h2 className="sr-only">Generation history</h2>
        {boards.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="rf-history-board" className="text-xs font-medium text-muted-foreground">
              Board
            </label>
            <select
              id="rf-history-board"
              value={boardFilter}
              onChange={(event) => setBoardFilter(event.target.value)}
              className="h-11 min-w-11 rounded-lg border border-border bg-background/60 px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              aria-label="Filter history by board"
            >
              <option value="__all__">(all boards)</option>
              <option value="__none__">(no board)</option>
              {boards.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        )}
        <ul
          className="rf-scroll max-h-96 space-y-2 overflow-y-auto pr-2"
          aria-label="Recent generations"
        >
          {visible.map((job) => {
            const thumb = job.frames[0] ?? job.startFramePath ?? null
            const isEditChild = Boolean(job.parentJobId && job.editInstruction)
            return (
              <li key={job.id} className="list-none">
                <div className="flex items-stretch gap-3 rounded-xl border border-border bg-card/60 p-2.5 transition-colors hover:border-primary/40">
                  <button
                    type="button"
                    onClick={() => setSelected(job)}
                    className="flex min-h-11 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    aria-label={`Open details for: ${excerpt(job.editInstruction ?? job.prompt, 40)}`}
                  >
                    <span className="relative flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/60">
                      {thumb ? (
                        <>
                          <img src={thumb} alt="" className="h-full w-full object-cover" />
                          {job.videoPath && (
                            <span className="absolute inset-0 flex items-center justify-center bg-black/25">
                              <Play className="size-4 fill-white/90 text-white/90" aria-hidden="true" />
                            </span>
                          )}
                        </>
                      ) : (
                        <Clapperboard className="size-5 text-muted-foreground/60" aria-hidden="true" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {isEditChild && <VersionChip version={job.editVersion} />}
                        <TierChip tier={job.tier} />
                        <KindChip kind={job.kind} />
                        <StatusChip status={job.status} />
                        {job.board && <BoardChip board={job.board} />}
                      </span>
                      <span className="mt-1 block truncate text-sm">
                        {isEditChild ? (
                          <span title={job.editInstruction ?? undefined}>
                            <PenLine className="mr-1 inline size-3 text-primary/80" aria-hidden="true" />
                            {excerpt(job.editInstruction ?? job.prompt)}
                          </span>
                        ) : (
                          excerpt(job.prompt)
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">
                        −{job.creditsCharged} cr · ${job.providerCostUsd.toFixed(2)} ·{' '}
                        {formatTimestamp(job.createdAt)}
                      </span>
                    </span>
                  </button>
                  <div className="grid shrink-0 grid-cols-2 gap-1.5 sm:flex sm:items-center">
                    {job.status === 'completed' && job.kind === 'video' && (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-11 rounded-lg"
                        onClick={() => openEditDialog(job)}
                        aria-label={`Edit clip: ${excerpt(job.prompt, 40)}`}
                        title="Edit this clip with an instruction (charges tier rate × duration)"
                      >
                        <PenLine className="size-4" aria-hidden="true" />
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-11 rounded-lg"
                      onClick={() => onRemix(job)}
                      aria-label={`Remix: ${excerpt(job.prompt, 40)}`}
                      title="Load this recipe into the Studio (free)"
                    >
                      <Shuffle className="size-4" aria-hidden="true" />
                    </Button>
                    {job.status === 'completed' && job.kind === 'video' && (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-11 rounded-lg"
                        onClick={() => onExtend(job)}
                        disabled={busyExtendId === job.id}
                        aria-label={`Extend +5s: ${excerpt(job.prompt, 40)}`}
                        title="Extend this clip +5s (charges tier rate × 5)"
                      >
                        <FastForward className="size-4" aria-hidden="true" />
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-11 rounded-lg"
                      onClick={() => onRerun(job)}
                      disabled={busyRerunId === job.id}
                      aria-label={`Re-run: ${excerpt(job.prompt, 40)}`}
                      title="Re-run this generation (charges again)"
                    >
                      <RotateCw
                        className={`size-4 ${busyRerunId === job.id ? 'animate-spin' : ''}`}
                        aria-hidden="true"
                      />
                    </Button>
                  </div>
                </div>
              </li>
            )
          })}
          {visible.length === 0 && (
            <li className="list-none rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No generations on this board yet.
            </li>
          )}
        </ul>
      </div>

      {/* ── Job detail dialog ─────────────────────────────────────────── */}
      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="rf-scroll max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2 pr-6 text-left">
                  {selected.editVersion > 1 && <VersionChip version={selected.editVersion} />}
                  <TierChip tier={selected.tier} />
                  <KindChip kind={selected.kind} />
                  <StatusChip status={selected.status} />
                  {selected.board && <BoardChip board={selected.board} />}
                  <span className="text-xs font-normal text-muted-foreground tabular-nums">
                    {formatTimestamp(selected.createdAt)}
                  </span>
                </DialogTitle>
                <DialogDescription className="text-left leading-relaxed text-foreground/90">
                  “{selected.prompt}”
                </DialogDescription>
              </DialogHeader>

              {selected.editInstruction && (
                <p className="flex items-start gap-1.5 rounded-lg border border-primary/25 bg-primary/5 p-3 text-sm text-primary/90">
                  <PenLine className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    <span className="font-semibold">Edit instruction:</span> {selected.editInstruction}
                  </span>
                </p>
              )}

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border bg-muted/30 p-3 text-xs sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">Duration</dt>
                  <dd className="font-medium tabular-nums">
                    {selected.kind === 'image' ? 'Still' : `${selected.durationSec}s`}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Aspect</dt>
                  <dd className="font-medium">{selected.aspectRatio}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Provider</dt>
                  <dd className="font-medium capitalize">{selected.provider}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Credits charged</dt>
                  <dd className="font-medium tabular-nums">−{selected.creditsCharged}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Provider cost</dt>
                  <dd className="font-medium tabular-nums">
                    ${selected.providerCostUsd.toFixed(2)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Job ID</dt>
                  <dd className="truncate font-mono text-[10px]">{selected.id}</dd>
                </div>
              </dl>

              {selected.status === 'failed' && (
                <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                  {selected.errorMessage || 'This render failed.'}
                </p>
              )}

              {/* Edit thread chain (ancestors → self → descendants) */}
              {threadOf(selected).length > 1 && (
                <section aria-label="Edit thread" className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Edit thread
                  </h3>
                  <ul className="space-y-1">
                    {threadOf(selected).map((entry) => {
                      const isSelf = entry.id === selected.id
                      return (
                        <li key={entry.id}>
                          <button
                            type="button"
                            onClick={() => setSelected(entry)}
                            aria-current={isSelf ? 'true' : undefined}
                            className={cn(
                              'flex min-h-11 w-full items-center gap-2 rounded-lg border p-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                              isSelf
                                ? 'border-primary/40 bg-primary/10'
                                : 'border-border bg-background/40 hover:border-primary/40 hover:bg-accent/40'
                            )}
                            aria-label={`Open thread version: ${excerpt(entry.editInstruction ?? entry.prompt, 40)}`}
                          >
                            {entry.editInstruction ? (
                              <VersionChip version={entry.editVersion} />
                            ) : (
                              <span className="inline-flex shrink-0 items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
                                v{entry.editVersion}
                              </span>
                            )}
                            <StatusChip status={entry.status} />
                            <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">
                              {excerpt(entry.editInstruction ?? entry.prompt, 44)}
                            </span>
                            <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )}

              {selected.videoPath && (
                <figure className="space-y-2">
                  <figcaption className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Forged clip
                  </figcaption>
                  <div
                    className={`w-full overflow-hidden rounded-lg border border-primary/30 bg-black ${aspectClassFor(selected.aspectRatio)}`}
                  >
                    <video
                      src={selected.videoPath}
                      controls
                      preload="metadata"
                      playsInline
                      poster={selected.frames[0] ?? selected.startFramePath ?? undefined}
                      className="h-full w-full object-contain"
                      aria-label={`Playable video for: ${selected.prompt}`}
                    />
                  </div>
                  <a
                    href={selected.videoPath}
                    download
                    className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-card/60 px-4 text-xs font-medium transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <Download className="size-4" aria-hidden="true" />
                    Download MP4
                  </a>
                </figure>
              )}

              {/* Phase 3 derived clips: re-crops and camera moves */}
              {selected.variants.length > 0 && (
                <section aria-label="Clip variants" className="space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Clip variants
                  </h3>
                  {selected.variants.map((variant) => (
                    <figure key={variant.path} className="space-y-2">
                      <figcaption className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <VariantChip kind={variant.kind} />
                        <span className="font-semibold normal-case tracking-wide text-foreground/90">
                          {variant.label ?? variant.kind}
                        </span>
                      </figcaption>
                      <div
                        className={`w-full overflow-hidden rounded-lg border border-amber-500/30 bg-black ${aspectClassFor(variant.aspectRatio ?? selected.aspectRatio)}`}
                      >
                        <video
                          src={variant.path}
                          controls
                          preload="metadata"
                          playsInline
                          poster={selected.frames[0] ?? selected.startFramePath ?? undefined}
                          className="h-full w-full object-contain"
                          aria-label={`Playable variant (${variant.label ?? variant.kind}) for: ${selected.prompt}`}
                        />
                      </div>
                      <a
                        href={variant.path}
                        download
                        className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-card/60 px-4 text-xs font-medium transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        <Download className="size-4" aria-hidden="true" />
                        Download MP4
                      </a>
                    </figure>
                  ))}
                </section>
              )}

              {selected.startFramePath && (
                <figure className="space-y-1">
                  <figcaption className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Start frame
                  </figcaption>
                  <img
                    src={selected.startFramePath}
                    alt="Start frame for this generation"
                    className="max-h-48 rounded-lg border border-border object-contain"
                  />
                </figure>
              )}

              {selected.endFramePath && (
                <figure className="space-y-1">
                  <figcaption className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    End frame
                  </figcaption>
                  <img
                    src={selected.endFramePath}
                    alt="End frame for this generation"
                    className="max-h-48 rounded-lg border border-border object-contain"
                  />
                </figure>
              )}

              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Keyframes
                </h3>
                {selected.frames.length > 0 ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {selected.frames.map((frame, index) => (
                      <figure key={frame} className="space-y-1.5">
                        <img
                          src={frame}
                          alt={`Keyframe ${index + 1}`}
                          className={`w-full rounded-lg border border-border object-cover ${aspectClassFor(selected.aspectRatio)}`}
                        />
                        <a
                          href={frame}
                          download
                          className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-border text-xs font-medium transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                          Download frame {index + 1}
                        </a>
                      </figure>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                    No frames were produced{selected.status === 'failed' ? ' — the render failed.' : ' yet.'}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap justify-end gap-2 pt-1">
                {selected.status === 'completed' && selected.kind === 'video' && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 rounded-xl"
                      onClick={() => openEditDialog(selected)}
                    >
                      <PenLine className="mr-2 size-4" aria-hidden="true" />
                      Edit clip
                    </Button>
                    {selected.videoPath && (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 rounded-xl"
                        onClick={() => openReframeDialog(selected)}
                      >
                        <Crop className="mr-2 size-4" aria-hidden="true" />
                        Reframe
                      </Button>
                    )}
                    {selected.videoPath && (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 rounded-xl"
                        onClick={() => openRestyleDialog(selected)}
                      >
                        <Palette className="mr-2 size-4" aria-hidden="true" />
                        Restyle
                      </Button>
                    )}
                    {stillCount(selected) >= MIN_CAMERA_STILLS && (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 rounded-xl"
                        onClick={() => openCameraDialog(selected)}
                      >
                        <Camera className="mr-2 size-4" aria-hidden="true" />
                        Camera move
                      </Button>
                    )}
                  </>
                )}
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 rounded-xl"
                  onClick={() => {
                    onRemix(selected)
                    setSelected(null)
                  }}
                >
                  <Shuffle className="mr-2 size-4" aria-hidden="true" />
                  Remix
                </Button>
                {selected.status === 'completed' && (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 rounded-xl"
                    onClick={() => {
                      onExtend(selected)
                      setSelected(null)
                    }}
                    disabled={busyExtendId === selected.id}
                  >
                    <FastForward className="mr-2 size-4" aria-hidden="true" />
                    Extend +5s
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 rounded-xl"
                  onClick={() => {
                    onRerun(selected)
                    setSelected(null)
                  }}
                  disabled={busyRerunId === selected.id}
                >
                  <RotateCw className="mr-2 size-4" aria-hidden="true" />
                  Re-run
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Edit clip dialog ──────────────────────────────────────────── */}
      <Dialog open={editingJob !== null} onOpenChange={(open) => !open && setEditingJob(null)}>
        <DialogContent className="sm:max-w-lg">
          {editingJob && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-left">
                  <PenLine className="size-4 text-primary" aria-hidden="true" />
                  Edit clip — cut v{editingJob.editVersion + 1}
                </DialogTitle>
                <DialogDescription className="text-left">
                  Describe the change and a new version of “{excerpt(editingJob.prompt, 60)}” will be
                  forged from your instruction, with fresh keyframes.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={submitEdit} noValidate>
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <Label htmlFor="rf-edit-instruction" className="text-sm font-semibold">
                      Edit instruction
                    </Label>
                    <span
                      className={`text-xs tabular-nums ${
                        instruction.length > MAX_INSTRUCTION ? 'text-destructive' : 'text-muted-foreground'
                      }`}
                      aria-live="polite"
                    >
                      {instruction.length}/{MAX_INSTRUCTION}
                    </span>
                  </div>
                  <Textarea
                    id="rf-edit-instruction"
                    value={instruction}
                    onChange={(event) => setInstruction(event.target.value.slice(0, MAX_INSTRUCTION))}
                    placeholder="e.g. make it dusk with drifting snow and warmer lantern light"
                    className="min-h-24 resize-y border-border bg-background/60 text-base leading-relaxed placeholder:text-muted-foreground/60"
                    aria-describedby="rf-edit-hint"
                  />
                  <p id="rf-edit-hint" className="text-xs text-muted-foreground">
                    Instructions pass the same safety filter before any credits are reserved. The new
                    version keeps this clip’s tier, aspect, duration and board.
                  </p>
                </div>
                <div className="mt-4 flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm" aria-live="polite">
                    <span className="font-semibold text-foreground">
                      Cost:{' '}
                      <span className="text-primary tabular-nums">
                        {creditCost(editingJob.tier, editingJob.durationSec)} credits
                      </span>
                    </span>
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {editingJob.tier === 'quality' ? 40 : 10} cr/s × {editingJob.durationSec}s
                    </span>
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 rounded-xl"
                      onClick={() => setEditingJob(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      className="h-11 rounded-xl px-5"
                      disabled={instruction.trim().length < 3 || busyEdit}
                    >
                      {busyEdit ? (
                        <>
                          <span
                            className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                            aria-hidden="true"
                          />
                          Cutting…
                        </>
                      ) : (
                        <>
                          <PenLine className="size-4" aria-hidden="true" />
                          Cut edit v{editingJob.editVersion + 1}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Reframe dialog ────────────────────────────────────────────── */}
      <Dialog open={reframingJob !== null} onOpenChange={(open) => !open && setReframingJob(null)}>
        <DialogContent className="sm:max-w-lg">
          {reframingJob && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-left">
                  <Crop className="size-4 text-primary" aria-hidden="true" />
                  Reframe clip
                </DialogTitle>
                <DialogDescription className="text-left">
                  Re-crop “{excerpt(reframingJob.prompt, 60)}” onto a new aspect canvas — the frame is
                  preserved, only the crop changes.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={submitReframe} noValidate>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-semibold">Target aspect</legend>
                  <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Target aspect ratio">
                    {ASPECT_RATIOS.map((ratio) => {
                      const isSelected = reframeAspect === ratio
                      const isCurrent = ratio === reframingJob.aspectRatio
                      return (
                        <button
                          key={ratio}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          onClick={() => setReframeAspect(ratio)}
                          className={cn(
                            'flex min-h-11 flex-col items-center justify-center gap-1.5 rounded-lg border p-3 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                            isSelected
                              ? 'border-primary bg-primary/15 text-primary'
                              : 'border-border bg-background/40 text-muted-foreground hover:border-primary/40 hover:text-foreground'
                          )}
                        >
                          <span
                            className={cn(
                              ASPECT_MINIS[ratio],
                              'rounded-sm border-2',
                              isSelected ? 'border-primary' : 'border-muted-foreground/40'
                            )}
                            aria-hidden="true"
                          />
                          <span className="text-xs font-medium">{ratio}</span>
                          {isCurrent && (
                            <span className="text-[10px] font-normal text-muted-foreground/70">current</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </fieldset>
                <div className="mt-4 flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm" aria-live="polite">
                    <span className="font-semibold text-foreground">
                      Cost: <span className="text-primary tabular-nums">{REFRAME_CREDITS} credits</span>
                    </span>
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      flat · local re-encode
                    </span>
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 rounded-xl"
                      onClick={() => setReframingJob(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      className="h-11 rounded-xl px-5"
                      disabled={!reframeAspect || busyTransform}
                    >
                      {busyTransform ? (
                        <>
                          <span
                            className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                            aria-hidden="true"
                          />
                          Re-cropping…
                        </>
                      ) : (
                        <>
                          <Crop className="size-4" aria-hidden="true" />
                          Re-crop
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Camera move dialog ────────────────────────────────────────── */}
      <Dialog open={reshootingJob !== null} onOpenChange={(open) => !open && setReshootingJob(null)}>
        <DialogContent className="sm:max-w-lg">
          {reshootingJob && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-left">
                  <Camera className="size-4 text-primary" aria-hidden="true" />
                  Camera move
                </DialogTitle>
                <DialogDescription className="text-left">
                  Re-shoot “{excerpt(reshootingJob.prompt, 60)}” from its own stills with a virtual
                  camera move — same frames, new motion.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={submitCamera} noValidate>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-semibold">Motion preset</legend>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Camera motion preset">
                    {CAMERA_PRESET_META.map((preset) => {
                      const isSelected = cameraPreset === preset.id
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          onClick={() => setCameraPreset(preset.id)}
                          className={cn(
                            'flex min-h-11 flex-col items-start gap-0.5 rounded-lg border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                            isSelected
                              ? 'border-primary bg-primary/15'
                              : 'border-border bg-background/40 hover:border-primary/40'
                          )}
                        >
                          <span className="text-sm font-semibold">{preset.label}</span>
                          <span className="text-xs text-muted-foreground">{preset.blurb}</span>
                        </button>
                      )
                    })}
                  </div>
                </fieldset>
                <div className="mt-4 flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm" aria-live="polite">
                    <span className="font-semibold text-foreground">
                      Cost: <span className="text-primary tabular-nums">{CAMERA_CREDITS} credits</span>
                    </span>
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      flat · local re-render
                    </span>
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 rounded-xl"
                      onClick={() => setReshootingJob(null)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" className="h-11 rounded-xl px-5" disabled={busyTransform}>
                      {busyTransform ? (
                        <>
                          <span
                            className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                            aria-hidden="true"
                          />
                          Re-shooting…
                        </>
                      ) : (
                        <>
                          <Camera className="size-4" aria-hidden="true" />
                          Apply move
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Restyle dialog (Phase 11, N5 video-to-video) ─────────────────── */}
      <Dialog open={restylingJob !== null} onOpenChange={(open) => !open && setRestylingJob(null)}>
        <DialogContent className="sm:max-w-lg">
          {restylingJob && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-left">
                  <Palette className="size-4 text-primary" aria-hidden="true" />
                  Restyle clip
                </DialogTitle>
                <DialogDescription className="text-left">
                  Re-render “{excerpt(restylingJob.prompt, 60)}” through a colour grade — the forge
                  samples the clip’s own key moments and recomposites them in the new look.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={submitRestyle} noValidate>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-semibold">Style grade</legend>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Restyle grade">
                    {RESTYLE_STYLES.map((style) => {
                      const isSelected = restyleStyle === style.id
                      return (
                        <button
                          key={style.id}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          onClick={() => setRestyleStyle(style.id)}
                          className={cn(
                            'flex min-h-11 items-center gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                            isSelected
                              ? 'border-primary bg-primary/15'
                              : 'border-border bg-background/40 hover:border-primary/40'
                          )}
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
                </fieldset>
                <div className="mt-4 flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm" aria-live="polite">
                    <span className="font-semibold text-foreground">
                      Cost: <span className="text-primary tabular-nums">{RESTYLE_CREDITS} credits</span>
                    </span>
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      flat · local re-render
                    </span>
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 rounded-xl"
                      onClick={() => setRestylingJob(null)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" className="h-11 rounded-xl px-5" disabled={busyTransform}>
                      {busyTransform ? (
                        <>
                          <span
                            className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                            aria-hidden="true"
                          />
                          Restyling…
                        </>
                      ) : (
                        <>
                          <Palette className="size-4" aria-hidden="true" />
                          Apply grade
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
