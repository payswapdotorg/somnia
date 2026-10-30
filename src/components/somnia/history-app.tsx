// src/components/somnia/history-app.tsx — my dreams, replayed (T4b).
//
// The owner's workspace: GET /api/jobs with live polling while anything is
// in flight, a detail panel mounting the render with its keyframe strip,
// and every downstream action speaking the exact job route contract —
// extend (+5s), modify (instruction), reframe (aspect), upscale (4K),
// unlisted share/unshare, and the free remix prefill hand-off to the
// composer (sessionStorage + route home).
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { SignInInvitation, StatusChip, MetaChip } from '@/components/somnia/bits'
import {
  mainAsset,
  variantAssets,
  aspectClass,
  TERMINAL_STATUSES,
  type JobView,
  type RemixPrefill,
} from '@/components/somnia/dto'
import { ASPECT_RATIOS } from '@/lib/plans'
import type { SessionUser } from '@/hooks/use-session'

const REMIX_STORAGE_KEY = 'somnia:remix'

export interface HistoryAppProps {
  user: SessionUser | null
}

export function HistoryApp({ user }: HistoryAppProps) {
  const router = useRouter()
  const [jobs, setJobs] = useState<JobView[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [instruction, setInstruction] = useState('')
  const [reframeAspect, setReframeAspect] = useState('9:16')
  const [lineageNote, setLineageNote] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selected = jobs.find((j) => j.id === selectedId) ?? null
  const hasPending = jobs.some((j) => !TERMINAL_STATUSES.includes(j.status))

  async function refresh(): Promise<void> {
    try {
      const res = await fetch('/api/jobs', { credentials: 'same-origin' })
      if (!res.ok) return
      const body = (await res.json()) as { jobs: JobView[] }
      setJobs(body.jobs)
    } catch {
      // transient — polling retries
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!user) {
      setLoading(false)
      return
    }
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  useEffect(() => {
    if (!user || !hasPending) return
    const timer = setInterval(() => void refresh(), 2500)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, hasPending])

  function patchJob(id: string, patch: Partial<JobView>) {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)))
  }

  async function jobAction(
    label: string,
    path: string,
    init: RequestInit,
    onDone: (body: Record<string, unknown>) => void
  ): Promise<void> {
    setBusyAction(label)
    setError(null)
    try {
      const res = await fetch(path, { credentials: 'same-origin', ...init })
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        setError(String(body.message ?? `${label} failed — please try again.`))
        return
      }
      onDone(body)
    } catch {
      setError(`Network error during ${label.toLowerCase()} — please try again.`)
    } finally {
      setBusyAction(null)
    }
  }

  async function share(): Promise<void> {
    if (!selected || selected.shareToken) return
    await jobAction('Share', `/api/jobs/${selected.id}/share`, { method: 'POST' }, (body) => {
      const token = body.shareToken
      if (typeof token === 'string') patchJob(selected.id, { shareToken: token, sharedAt: new Date().toISOString() })
    })
  }

  async function unshare(): Promise<void> {
    if (!selected || !selected.shareToken) return
    await jobAction('Stop sharing', `/api/jobs/${selected.id}/share`, { method: 'DELETE' }, () => {
      patchJob(selected.id, { shareToken: null, sharedAt: null })
    })
  }

  async function extend(): Promise<void> {
    if (!selected) return
    await jobAction('Extend', `/api/jobs/${selected.id}/extend`, { method: 'POST' }, (body) => {
      const child = body.job as JobView | undefined
      if (child) {
        setLineageNote(`Extension queued — ${child.prompt}`)
        void refresh()
      }
    })
  }

  async function modify(): Promise<void> {
    if (!selected || instruction.trim().length < 3) {
      setError('Describe the change in at least 3 characters.')
      return
    }
    await jobAction(
      'Modify',
      `/api/jobs/${selected.id}/modify`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction: instruction.trim() }),
      },
      (body) => {
        const child = body.job as JobView | undefined
        if (child) {
          setLineageNote(`Modify queued — ${child.prompt}`)
          void refresh()
        }
      }
    )
  }

  async function reframe(): Promise<void> {
    if (!selected) return
    await jobAction(
      'Reframe',
      `/api/jobs/${selected.id}/reframe`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ aspect: reframeAspect }),
      },
      (body) => {
        const asset = body.asset as { path: string; label: string | null } | undefined
        if (asset) {
          setLineageNote(`Reframed to ${asset.label ?? reframeAspect} — ${asset.path}`)
          void refresh()
        }
      }
    )
  }

  async function upscale(): Promise<void> {
    if (!selected) return
    await jobAction('Upscale', `/api/jobs/${selected.id}/upscale`, { method: 'POST' }, (body) => {
      const asset = body.asset as { path: string } | undefined
      if (asset) {
        setLineageNote(`4K upscale ready — ${asset.path}`)
        void refresh()
      }
    })
  }

  async function remix(): Promise<void> {
    if (!selected) return
    await jobAction('Remix', `/api/jobs/${selected.id}/remix`, { method: 'POST' }, (body) => {
      const prefill = body as unknown as RemixPrefill
      window.sessionStorage.setItem(REMIX_STORAGE_KEY, JSON.stringify(prefill))
      router.push('/')
    })
  }

  // ------------------------------------------------------------- render
  if (!user) {
    return (
      <div className="py-16">
        <SignInInvitation what="see your history" />
      </div>
    )
  }

  if (loading) {
    return <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)}</div>
  }

  if (!jobs.length) {
    return (
      <div className="py-16 text-center">
        <h2 className="text-lg font-semibold tracking-tight">Nothing dreamed yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Your renders will live here — every clip, still and edit with its recipe.
        </p>
        <Button className="mt-6" onClick={() => router.push('/')}>
          Open the composer
        </Button>
      </div>
    )
  }

  const render = selected ? mainAsset(selected) : null

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* ------------------------------------------------------------ list */}
      <div className="space-y-3">
        {jobs.map((job) => (
          <button
            key={job.id}
            type="button"
            onClick={() => {
              setSelectedId(job.id)
              setLineageNote(null)
              setError(null)
            }}
            className={`w-full rounded-xl border p-4 text-left transition ${
              selectedId === job.id
                ? 'border-primary/50 bg-primary/5'
                : 'border-border/60 bg-card/50 hover:border-primary/30'
            }`}
          >
            <p className="line-clamp-2 text-sm">{job.prompt}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusChip status={job.status} />
              <MetaChip>{job.kind}</MetaChip>
              <MetaChip>{job.aspectRatio}</MetaChip>
              {job.kind === 'video' && <MetaChip>{job.durationSec}s</MetaChip>}
              <MetaChip>{job.creditsCharged} cr</MetaChip>
              {job.shareToken && <MetaChip>shared</MetaChip>}
              {job.placeholderRender && <MetaChip>simulated render</MetaChip>}
            </div>
          </button>
        ))}
      </div>

      {/* ---------------------------------------------------------- detail */}
      {selected && (
        <section className="space-y-4">
          <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/70">
            <div className={`relative ${aspectClass(selected.aspectRatio)} bg-black`}>
              {render && selected.kind === 'video' ? (
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
                <img src={render.path} alt={selected.prompt} className="size-full object-contain" />
              ) : (
                <div className="flex size-full items-center justify-center text-sm text-muted-foreground">
                  {selected.status === 'failed'
                    ? 'The render failed and the credits were refunded.'
                    : 'Rendering in the pipeline…'}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 p-4">
              <StatusChip status={selected.status} />
              <MetaChip>{selected.model}</MetaChip>
              <MetaChip>{selected.resolution}</MetaChip>
              <MetaChip>{selected.aspectRatio}</MetaChip>
              {selected.kind === 'video' && <MetaChip>{selected.durationSec}s</MetaChip>}
              {selected.hdr && <MetaChip>HDR</MetaChip>}
              {selected.loop && <MetaChip>loop</MetaChip>}
              <MetaChip>{selected.creditsCharged} credits</MetaChip>
              {selected.placeholderRender && <MetaChip>simulated render</MetaChip>}
            </div>
          </div>

          {selected.keyframes.length > 0 && (
            <div className="rounded-2xl border border-border/60 bg-card/50 p-4">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Keyframe timeline ({selected.keyframes.length})
              </p>
              <div data-testid="keyframe-strip" className="flex gap-2 overflow-x-auto pb-1">
                {selected.keyframes.map((kf) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={kf.id}
                    src={kf.path}
                    alt={`Keyframe ${kf.order}`}
                    className="h-16 w-auto rounded-lg border border-border/60 object-cover"
                  />
                ))}
              </div>
            </div>
          )}

          {variantAssets(selected).length > 0 && (
            <div className="space-y-3 rounded-2xl border border-border/60 bg-card/50 p-4">
              <p className="text-xs font-medium text-muted-foreground">Variants</p>
              {variantAssets(selected).map((asset) => (
                <div key={asset.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">
                    {asset.kind} {asset.label ? `· ${asset.label}` : ''}
                  </span>
                  <a href={asset.path} className="text-primary underline-offset-4 hover:underline" download>
                    download
                  </a>
                </div>
              ))}
            </div>
          )}

          {/* ------------------------------------------------------ actions */}
          <div className="space-y-4 rounded-2xl border border-border/60 bg-card/50 p-4">
            <p className="text-xs font-medium text-muted-foreground">Next steps — each is charged honestly</p>

            {error && (
              <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
            {lineageNote && (
              <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
                {lineageNote}
              </p>
            )}

            {selected.status === 'completed' && (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => void extend()} disabled={busyAction !== null}>
                    {busyAction === 'Extend' ? 'Extending…' : 'Extend +5s'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void upscale()} disabled={busyAction !== null}>
                    {busyAction === 'Upscale' ? 'Upscaling…' : 'Upscale to 4K'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void remix()} disabled={busyAction !== null}>
                    {busyAction === 'Remix' ? 'Prefilling…' : 'Remix'}
                  </Button>
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="reframe-aspect">Reframe to</Label>
                    <select
                      id="reframe-aspect"
                      value={reframeAspect}
                      onChange={(e) => setReframeAspect(e.target.value)}
                      className="h-9 rounded-lg border border-border bg-transparent px-3 text-sm"
                    >
                      {ASPECT_RATIOS.filter((a) => a !== selected.aspectRatio).map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => void reframe()} disabled={busyAction !== null}>
                    {busyAction === 'Reframe' ? 'Reframing…' : 'Reframe'}
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="modify-instruction">Instruction</Label>
                  <Textarea
                    id="modify-instruction"
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder="make the water glassy, warm the highlights…"
                    rows={2}
                    className="resize-none"
                  />
                  <Button variant="outline" size="sm" onClick={() => void modify()} disabled={busyAction !== null}>
                    {busyAction === 'Modify' ? 'Modifying…' : 'Modify clip'}
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-3">
                  {selected.shareToken ? (
                    <>
                      <a
                        href={`/share/${selected.shareToken}`}
                        className="max-w-full truncate text-sm text-primary underline-offset-4 hover:underline"
                      >
                        /share/{selected.shareToken}
                      </a>
                      <Button variant="ghost" size="sm" onClick={() => void unshare()} disabled={busyAction !== null}>
                        {busyAction === 'Stop sharing' ? 'Stopping…' : 'Stop sharing'}
                      </Button>
                    </>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => void share()} disabled={busyAction !== null}>
                      {busyAction === 'Share' ? 'Minting…' : 'Share unlisted'}
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
