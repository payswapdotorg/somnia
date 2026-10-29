// src/components/somnia/agents-app.tsx — Somnia creative agents (T6b).
//
// Goal-to-clip on top of the /api/agents contract: describe the dream, the
// agent plans a deterministic multi-shot variation set (gated by the user's
// plan cap — trial 2, spark 2, studio 4, infinite 6), you review every
// planned prompt before a single credit moves, then dispatch dispatches one
// charged generation job per step and this surface polls the linked jobs to
// settlement. Honest numbers throughout: the budget line is steps × 100,
// the per-shot cost is the engine default (pulse-3 / 720p / 5s).
'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { SignInInvitation, StatusChip, MetaChip } from '@/components/somnia/bits'
import { mainAsset, TERMINAL_STATUSES, type AgentRunView, type JobView } from '@/components/somnia/dto'
import type { SessionUser } from '@/hooks/use-session'

const POLL_MS = 1600
const PER_SHOT_CREDITS = 100

export interface AgentsAppProps {
  user: SessionUser | null
  /** Fire once after dispatch so the shell's live balance refreshes. */
  onCreditsChanged?: () => void
}

export function AgentsApp({ user, onCreditsChanged }: AgentsAppProps) {
  const [goal, setGoal] = useState('')
  const [run, setRun] = useState<AgentRunView | null>(null)
  const [jobs, setJobs] = useState<JobView[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const variations = jobs
    .filter((j) => run && j.agentRunId === run.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const dispatched = run !== null && run.status !== 'planning'
  const settled = variations.length > 0 && variations.every((j) => TERMINAL_STATUSES.includes(j.status))

  async function planRun(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = goal.trim()
    if (trimmed.length < 3) {
      setError('Describe the dream first — at least a few words for the agent to plan against.')
      return
    }
    setBusy(true)
    setError(null)
    setRun(null)
    setJobs([])
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ goal: trimmed }),
      })
      const body = (await res.json().catch(() => null)) as { run?: AgentRunView; message?: string } | null
      if (!res.ok || !body?.run) {
        setError(body?.message ?? 'The run could not be planned.')
        return
      }
      setRun(body.run)
    } catch {
      setError('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function dispatchRun() {
    if (!run) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/agents/${run.id}/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({}),
      })
      const body = (await res.json().catch(() => null)) as { run?: AgentRunView; message?: string } | null
      if (!res.ok || !body?.run) {
        setError(body?.message ?? 'The plan could not be dispatched.')
        return
      }
      setRun(body.run)
      onCreditsChanged?.()
    } catch {
      setError('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  // ---------------------------------------------- live polling to settlement
  useEffect(() => {
    if (!run || !dispatched || settled) return
    let alive = true
    const tick = async () => {
      try {
        const [runRes, jobsRes] = await Promise.all([
          fetch(`/api/agents/${run.id}`, { credentials: 'same-origin' }),
          fetch('/api/jobs?limit=100', { credentials: 'same-origin' }),
        ])
        if (alive && runRes.ok) setRun((await runRes.json()) as AgentRunView)
        if (alive && jobsRes.ok) {
          const body = (await jobsRes.json()) as { jobs: JobView[] }
          setJobs(body.jobs)
        }
      } catch {
        // transient — the next interval retries
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, dispatched, settled])

  if (!user) {
    return (
      <div className="py-16">
        <SignInInvitation what="run creative agents" />
      </div>
    )
  }

  const plan = run?.plan ?? []
  const budget = plan.length * PER_SHOT_CREDITS

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* ------------------------------------------------------- goal form */}
      <div className="space-y-4">
        <form onSubmit={planRun} className="space-y-4 rounded-2xl border border-border/60 bg-card/70 p-5">
          <h2 className="font-semibold tracking-tight">Describe the dream</h2>
          <div className="space-y-2">
            <Label htmlFor="agent-goal">Goal</Label>
            <Textarea
              id="agent-goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="a slow drone shot over a foggy polder at dawn"
              rows={4}
            />
          </div>
          {error && (
            <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Planning…' : 'Plan the run'}
          </Button>
          <p className="text-xs text-muted-foreground">
            The agent plans a multi-shot variation set gated by your plan (trial 2 · spark 2 · studio 4 ·
            infinite 6). Nothing is charged until you dispatch.
          </p>
        </form>

        {run && (
          <div className="space-y-3 rounded-2xl border border-border/60 bg-card/70 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold tracking-tight">Run</h2>
              <StatusChip status={run.status === 'completed' ? 'completed' : run.status === 'failed' ? 'failed' : 'queued'} />
            </div>
            <p className="text-sm text-muted-foreground">{run.goal}</p>
            <div className="flex flex-wrap gap-2 text-xs">
              <MetaChip>{run.variations > 0 ? `${run.variations} variations` : `${plan.length} variations planned`}</MetaChip>
              <MetaChip>{run.creditsBudget > 0 ? `${run.creditsBudget} credits` : `${budget} credits`}</MetaChip>
            </div>
            {!dispatched ? (
              <Button className="w-full" onClick={() => void dispatchRun()} disabled={busy}>
                {busy ? 'Dispatching…' : `Dispatch ${plan.length} variations`}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                {settled
                  ? 'Every variation settled — watch the clips, remix the keepers.'
                  : 'Rendering — this surface polls until every variation settles.'}
              </p>
            )}
          </div>
        )}
      </div>

      {/* --------------------------------------------------------- results */}
      <div className="space-y-3">
        {plan.length > 0 && !dispatched && (
          <>
            <h2 className="text-sm font-medium text-muted-foreground">
              The plan — {plan.length} steps, review before dispatch
            </h2>
            {plan.map((step) => (
              <article key={step.shot} className="rounded-xl border border-border/60 bg-card/60 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-medium tracking-tight">Shot {step.shot}</h3>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {step.note}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{step.prompt}</p>
              </article>
            ))}
          </>
        )}

        {dispatched && variations.length === 0 && (
          <div className="rounded-xl border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
            Dispatching the plan — variations will appear as the jobs land.
          </div>
        )}

        {dispatched &&
          variations.map((j) => {
            const render = mainAsset(j)
            return (
              <article key={j.id} className="rounded-xl border border-border/60 bg-card/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium tracking-tight">{j.prompt}</h3>
                  <div className="flex items-center gap-2">
                    {j.status !== 'completed' && j.progress > 0 && (
                      <span className="text-xs text-muted-foreground">{j.progress}%</span>
                    )}
                    <StatusChip status={j.status} />
                  </div>
                </div>
                {j.status === 'completed' && render && (
                  <a
                    href={render.path}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  >
                    Watch clip
                  </a>
                )}
                {j.status === 'failed' && j.errorMessage && (
                  <p className="mt-2 text-xs text-red-500">{j.errorMessage} — the charge was refunded.</p>
                )}
              </article>
            )
          })}
      </div>
    </div>
  )
}
