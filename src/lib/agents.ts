// src/lib/agents.ts — Somnia creative agents.
//
// An agent run turns a goal into a multi-shot plan, then dispatches one
// generation job per plan step — all linked to the run and charged
// normally through the engine. Planning is LLM-first (src/lib/planner.ts:
// server-side chat completion, strictly sanitized) with the deterministic
// angle builder as an always-available fallback, so an LLM outage never
// blocks planning. Which planner produced the plan is recorded on the run
// (`planner: 'llm' | 'heuristic'`) and surfaced in the run view.

import { db } from '@/lib/db'
import { createJob } from '@/lib/engine'
import { agentVariationCap } from '@/lib/plans'
import { llmPlanner, type LlmPlanner, type PlannerShot } from '@/lib/planner'

export type { LlmPlanner, PlannerShot }

export interface PlanStep {
  shot: number
  prompt: string
  note: string
}

export interface AgentRunView {
  id: string
  goal: string
  status: string
  variations: number
  creditsBudget: number
  planner: string
  plan: PlanStep[]
  createdAt: Date
  completedAt: Date | null
}

const SHOT_ANGLES = [
  { key: 'establishing', note: 'wide establishing shot' },
  { key: 'medium', note: 'medium tracking shot' },
  { key: 'detail', note: 'close detail insert' },
  { key: 'motion', note: 'kinetic motion beat' },
  { key: 'reaction', note: 'reaction beat' },
  { key: 'payoff', note: 'closing payoff shot' },
]

function buildPlan(goal: string, count: number): PlanStep[] {
  const cleaned = goal.trim().replace(/\s+/g, ' ')
  return Array.from({ length: count }, (_, i) => {
    const angle = SHOT_ANGLES[i % SHOT_ANGLES.length]
    return {
      shot: i + 1,
      prompt: `${cleaned} — ${angle.note}, coherent visual style`,
      note: angle.key,
    }
  })
}

/** Clamp an accepted LLM plan to the cap and pad short plans heuristically. */
function fitPlan(shots: PlannerShot[], goal: string, cap: number): PlanStep[] {
  const kept = shots.slice(0, cap)
  const padding =
    kept.length < cap ? buildPlan(goal, cap).slice(kept.length) : []
  return [...kept, ...padding].map((step, i) => ({
    shot: i + 1,
    prompt: step.prompt,
    note: step.note,
  }))
}

export interface PlanAgentRunOptions {
  /** Planner override (tests inject fakes; production uses the LLM planner). */
  planner?: LlmPlanner
}

/** Plan a run from a goal. Creates the AgentRun row (status 'planning'). */
export async function planAgentRun(
  userId: string,
  goal: string,
  opts: PlanAgentRunOptions = {}
) {
  const cleaned = (goal ?? '').trim().replace(/\s+/g, ' ')
  if (cleaned.length < 3) throw new Error('goal must be at least 3 characters')

  const user = await db.user.findUniqueOrThrow({ where: { id: userId } })
  const cap = agentVariationCap(user.plan)

  // LLM-first; any decline/throw falls back to the deterministic builder.
  const planner = opts.planner ?? llmPlanner
  let plan: PlanStep[] | null = null
  let used: 'llm' | 'heuristic' = 'heuristic'
  try {
    const shots = await planner(cleaned, cap)
    if (shots && shots.length > 0) {
      plan = fitPlan(shots, cleaned, cap)
      used = 'llm'
    }
  } catch {
    plan = null
  }
  if (!plan) plan = buildPlan(cleaned, cap)

  const run = await db.agentRun.create({
    data: {
      userId,
      goal: cleaned,
      planJson: JSON.stringify(plan),
      status: 'planning',
      variations: 0,
      creditsBudget: 0,
      planner: used,
    },
  })
  return { run, plan }
}

/** Dispatch every plan step as a linked generation job, then complete. */
export async function startAgentRun(runId: string) {
  const run = await db.agentRun.findUnique({ where: { id: runId } })
  if (!run) throw new Error('agent run not found')
  if (run.status !== 'planning') return run // idempotent re-dispatch guard

  const plan: PlanStep[] = JSON.parse(run.planJson || '[]')
  // Pre-flight: refuse the whole run if the balance cannot cover the plan.
  const user = await db.user.findUniqueOrThrow({ where: { id: run.userId } })
  const perShot = 100 // engine default: pulse-3 / 720p / 5s
  if (user.credits < perShot * plan.length) {
    throw new Error(
      `insufficient credits for the planned ${plan.length} variations`
    )
  }

  await db.agentRun.update({
    where: { id: run.id },
    data: { status: 'running', creditsBudget: perShot * plan.length },
  })

  for (const step of plan) {
    await createJob({
      userId: run.userId,
      prompt: step.prompt,
      mode: 'agent',
      agentRunId: run.id,
    })
  }

  return db.agentRun.update({
    where: { id: run.id },
    data: { status: 'completed', variations: plan.length, completedAt: new Date() },
  })
}

export async function getAgentRun(userId: string, runId: string): Promise<AgentRunView | null> {
  const run = await db.agentRun.findFirst({ where: { id: runId, userId } })
  if (!run) return null
  return {
    id: run.id,
    goal: run.goal,
    status: run.status,
    variations: run.variations,
    creditsBudget: run.creditsBudget,
    planner: run.planner,
    plan: JSON.parse(run.planJson || '[]'),
    createdAt: run.createdAt,
    completedAt: run.completedAt,
  }
}
