'use client'

import { TierChip, VersionChip } from '@/components/reelforge/bits'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertCircle, Check, Download, Film, PenLine, Play } from 'lucide-react'
import { motion } from 'framer-motion'
import * as React from 'react'
import type { JobDto } from '@/lib/types'

const STEPS = [
  { key: 'queued', label: 'Queued' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'running', label: 'Generating frames' },
  { key: 'moderated', label: 'Rendering video' },
  { key: 'completed', label: 'Complete' },
] as const

function stepIndexFor(status: JobDto['status']): number {
  switch (status) {
    case 'queued':
      return 0
    case 'dispatched':
      return 1
    case 'running':
      return 2
    case 'moderated':
      return 3
    case 'completed':
      return 4
    case 'failed':
      return -1
  }
}

/** Live card for the in-flight (or just-finished) generation. */
export function ActiveJobCard({ job }: { job: JobDto }) {
  const current = stepIndexFor(job.status)
  const done = job.status === 'completed'
  const failed = job.status === 'failed'
  const aspectClass =
    job.aspectRatio === '16:9' ? 'aspect-video' : job.aspectRatio === '9:16' ? 'aspect-[9/16]' : 'aspect-square'

  // Ordered stills: pinned start frame → storyboard keyframes → pinned end frame.
  // While the job runs, pending keyframe slots pulse as placeholders.
  const keyframeSlots: Array<string | null> = done
    ? job.frames
    : [0, 1, 2].map((i) => job.frames[i] ?? null)
  const stills: Array<{ path: string; pinned?: 'start' | 'end' } | null> = []
  if (job.startFramePath) stills.push({ path: job.startFramePath, pinned: 'start' as const })
  for (const frame of keyframeSlots) stills.push(frame ? { path: frame } : null)
  if (job.endFramePath) stills.push({ path: job.endFramePath, pinned: 'end' as const })
  const poster = stills.find((s) => s)?.path ?? null

  return (
    <motion.section
      aria-label="Active generation"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    >
      <Card className="border-primary/25 bg-card/80 shadow-lg shadow-primary/5">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Film className="size-4 text-primary" aria-hidden="true" />
              <span className="line-clamp-1 max-w-[16rem] sm:max-w-md">{job.prompt}</span>
            </CardTitle>
            <div className="flex items-center gap-2">
              {job.editVersion > 1 && <VersionChip version={job.editVersion} />}
              <TierChip tier={job.tier} />
              <Badge
                variant={done ? 'secondary' : failed ? 'destructive' : 'outline'}
                className="capitalize"
              >
                {job.status}
              </Badge>
            </div>
          </div>
          {job.editInstruction && (
            <p className="flex min-w-0 items-center gap-1.5 text-xs text-primary/90">
              <PenLine className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate" title={job.editInstruction}>
                Editing: {job.editInstruction}
              </span>
            </p>
          )}
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Status stepper */}
          <ol className="flex items-center gap-1 sm:gap-2" aria-label="Generation stages">
            {STEPS.map((step, index) => {
              const state =
                current < 0 ? 'failed' : index < current || done ? 'done' : index === current ? 'active' : 'todo'
              return (
                <li key={step.key} className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div
                      className={`h-1.5 w-full rounded-full transition-colors duration-500 ${
                        state === 'done'
                          ? 'bg-primary'
                          : state === 'active'
                            ? 'bg-primary/60'
                            : state === 'failed'
                              ? 'bg-red-500/40'
                              : 'bg-muted'
                      }`}
                    />
                    <span
                      className={`truncate text-[9px] font-medium uppercase tracking-wide sm:text-[11px] ${
                        state === 'todo' ? 'text-muted-foreground/60' : 'text-foreground'
                      }`}
                    >
                      {state === 'done' && (
                        <Check className="mr-0.5 inline size-3 text-primary" aria-hidden="true" />
                      )}
                      {step.label}
                    </span>
                  </div>
                </li>
              )
            })}
          </ol>

          {/* Progress */}
          <div className="space-y-1.5">
            <div
              className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={job.progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Render progress"
            >
              <motion.div
                className={`h-full rounded-full ${
                  failed
                    ? 'bg-red-500'
                    : 'bg-gradient-to-r from-orange-500 via-orange-400 to-amber-400'
                }`}
                animate={{ width: `${job.progress}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
              />
            </div>
            <p className="text-right text-xs tabular-nums text-muted-foreground">
              {failed ? '—' : `${job.progress}%`}
              {done ? ' · complete' : failed ? '' : ' · rendering'}
            </p>
          </div>

          {failed && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{job.errorMessage || 'The render failed unexpectedly. Try re-running it.'}</span>
            </div>
          )}

          {/* Forged clip */}
          {done && job.videoPath && (
            <motion.div
              className="space-y-2"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            >
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Play className="size-3.5 text-primary" aria-hidden="true" />
                Forged clip
              </h3>
              <div className={`relative w-full overflow-hidden rounded-lg border border-primary/30 bg-black ${aspectClass}`}>
                <video
                  src={job.videoPath}
                  controls
                  preload="metadata"
                  playsInline
                  poster={poster ?? undefined}
                  className="h-full w-full object-contain"
                  aria-label={`Playable video for: ${job.prompt}`}
                />
              </div>
              <a
                href={job.videoPath}
                download
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-card/60 px-4 text-xs font-medium transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <Download className="size-4" aria-hidden="true" />
                Download MP4
              </a>
            </motion.div>
          )}

          {/* Frames landing live */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {job.startFramePath || job.endFramePath ? 'Storyboard stills' : 'Storyboard keyframes'}
            </h3>
            <div
              className={`grid gap-2 sm:gap-3 ${
                stills.length > 3 ? 'grid-cols-3 sm:grid-cols-5' : 'grid-cols-3'
              }`}
            >
              {stills.map((slot, index) => (
                <motion.div
                  key={slot?.path ?? `slot-${index}`}
                  initial={false}
                  animate={{ opacity: 1, scale: 1 }}
                  className={`group relative overflow-hidden rounded-lg border ${
                    slot ? 'border-primary/30' : 'border-border'
                  }`}
                >
                  <div className={`${aspectClass} w-full bg-muted/60`}>
                    {slot ? (
                      <motion.img
                        src={slot.path}
                        alt={`Storyboard still ${index + 1} for: ${job.prompt}`}
                        className="h-full w-full object-cover"
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.4 }}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <span className="animate-pulse text-[10px] text-muted-foreground">
                          rendering…
                        </span>
                      </div>
                    )}
                  </div>
                  {slot?.pinned && (
                    <span className="absolute left-1 top-1 rounded-full bg-background/85 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-foreground/90">
                      {slot.pinned}
                    </span>
                  )}
                  {slot && (
                    <a
                      href={slot.path}
                      download
                      className="absolute bottom-1 right-1 flex size-9 items-center justify-center rounded-md bg-background/80 text-foreground opacity-0 transition-opacity hover:bg-background focus-visible:opacity-100 group-hover:opacity-100"
                      aria-label={`Download still ${index + 1}`}
                      title={`Download still ${index + 1}`}
                    >
                      <Download className="size-4" aria-hidden="true" />
                    </a>
                  )}
                </motion.div>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {job.creditsCharged} credits · ≈${job.providerCostUsd.toFixed(2)} provider cost ·{' '}
            {job.kind === 'image' ? 'still' : `${job.durationSec}s`} · {job.aspectRatio}
          </p>
        </CardContent>
      </Card>
    </motion.section>
  )
}
