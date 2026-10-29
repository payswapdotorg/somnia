// tests/agents.test.ts — creative agents.
//
// Two planners sit behind planAgentRun: an LLM shot-decomposer (production;
// dynamic SDK import, JSON-parsed and strictly sanitized) and the
// deterministic angle builder as the always-available fallback. The planner
// used is recorded on the run row (`planner: 'llm' | 'heuristic'`) and
// surfaced in the run view. The plan gates how many variations may dispatch
// (plan multiplier), jobs are created and linked to the run, and the run
// reaches a terminal state.
import { describe, expect, it, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import {
  planAgentRun,
  startAgentRun,
  getAgentRun,
  type LlmPlanner,
} from '@/lib/agents'
import { parsePlannerShots } from '@/lib/planner'

const EMAIL = 'agent-test@somnia.test'

async function seedUser(plan = 'trial', credits = 10_000, email = EMAIL) {
  return db.user.create({ data: { email, name: 'Agent Tester', plan, credits } })
}

beforeEach(async () => {
  await db.user.deleteMany({ where: { email: EMAIL } })
})

describe('agents — planning', () => {
  it('turns a goal into a plan of 2..cap shots with prompts', async () => {
    const user = await seedUser('spark')
    const { run, plan } = await planAgentRun(user.id, 'a rainy cyberpunk chase scene')
    expect(run.goal).toBe('a rainy cyberpunk chase scene')
    expect(run.status).toBe('planning')
    expect(plan.length).toBe(2) // spark cap
    for (const step of plan) {
      expect(step.prompt.length).toBeGreaterThan(10)
      expect(step.shot).toBeGreaterThanOrEqual(1)
    }
    const prompts = plan.map((s: { prompt: string }) => s.prompt)
    expect(new Set(prompts).size).toBe(plan.length)
  })

  it('scales the variation cap with the plan (studio=4, infinite=6)', async () => {
    const studio = await seedUser('studio', 10_000, 'studio@somnia.test')
    const p1 = await planAgentRun(studio.id, 'goal one')
    expect(p1.plan.length).toBe(4)
    const infinite = await seedUser('infinite', 10_000, 'infinite@somnia.test')
    const p2 = await planAgentRun(infinite.id, 'goal two')
    expect(p2.plan.length).toBe(6)
  })

  it('rejects empty goals', async () => {
    const user = await seedUser()
    await expect(planAgentRun(user.id, '   ')).rejects.toThrow(/goal/i)
  })
})

describe('agents — execution', () => {
  it('dispatches plan jobs, charges each, links them to the run, completes', async () => {
    const user = await seedUser('spark', 10_000)
    const { run } = await planAgentRun(user.id, 'a rainy cyberpunk chase scene')
    const started = await startAgentRun(run.id)
    expect(started.status).toBe('completed')
    expect(started.variations).toBe(2)

    const jobs = await db.job.findMany({ where: { agentRunId: run.id } })
    expect(jobs).toHaveLength(2)
    for (const job of jobs) {
      expect(job.mode).toBe('agent')
      expect(job.status).toBe('queued')
    }
    // each variation charged the 720p 5s base (100) -> 200 total
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).credits
    ).toBe(9_800)
  })

  it('refuses to dispatch when the balance cannot cover the plan', async () => {
    const user = await seedUser('spark', 150) // plan needs 200
    const { run } = await planAgentRun(user.id, 'a rainy cyberpunk chase scene')
    await expect(startAgentRun(run.id)).rejects.toThrow(/insufficient/i)
    const still = await getAgentRun(user.id, run.id)
    expect(still!.status).toBe('planning')
    expect(await db.job.count({ where: { agentRunId: run.id } })).toBe(0)
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).credits
    ).toBe(150) // untouched
  })
})

// ------------------------------------------------------------ LLM planning

describe('agents — LLM planner with heuristic fallback', () => {
  it('uses the LLM plan verbatim when the planner returns valid shots', async () => {
    const user = await seedUser('spark', 10_000)
    const fake: LlmPlanner = async (goal, count) =>
      Array.from({ length: count }, (_, i) => ({
        prompt: `LLM shot ${i + 1} for ${goal}`,
        note: `llm-beat-${i + 1}`,
      }))
    const { run, plan } = await planAgentRun(user.id, 'a dream of flying whales', { planner: fake })
    expect(plan).toHaveLength(2)
    expect(plan[0].prompt).toBe('LLM shot 1 for a dream of flying whales')
    expect(plan[1].note).toBe('llm-beat-2')
    expect(run.planner).toBe('llm')
    expect((await getAgentRun(user.id, run.id))!.planner).toBe('llm')
  })

  it('falls back to the deterministic builder when the planner returns null', async () => {
    const user = await seedUser('spark', 10_000)
    const refusing: LlmPlanner = async () => null
    const { run, plan } = await planAgentRun(user.id, 'a dream of flying whales', { planner: refusing })
    expect(plan).toHaveLength(2)
    // deterministic angle-builder shape: "<goal> — <note>, coherent visual style"
    expect(plan[0].prompt).toContain('a dream of flying whales')
    expect(plan[0].prompt).toContain('coherent visual style')
    expect(run.planner).toBe('heuristic')
  })

  it('falls back when the planner throws (LLM outage must never block planning)', async () => {
    const user = await seedUser('spark', 10_000)
    const exploding: LlmPlanner = async () => {
      throw new Error('llm provider down')
    }
    const { run, plan } = await planAgentRun(user.id, 'a dream of flying whales', { planner: exploding })
    expect(plan).toHaveLength(2)
    expect(run.planner).toBe('heuristic')
  })

  it('clamps an over-long LLM plan to the variation cap', async () => {
    const user = await seedUser('spark', 10_000) // cap 2
    const chatty: LlmPlanner = async (_goal, _count) =>
      Array.from({ length: 9 }, (_, i) => ({
        prompt: `shot ${i + 1}`,
        note: 'beat',
      }))
    const { plan } = await planAgentRun(user.id, 'nine shots of rain', { planner: chatty })
    expect(plan).toHaveLength(2)
  })

  it('pads a short LLM plan up to the cap with heuristic shots', async () => {
    const user = await seedUser('studio', 10_000) // cap 4
    const terse: LlmPlanner = async () => [{ prompt: 'the only shot that matters here', note: 'single' }]
    const { plan, run } = await planAgentRun(user.id, 'four shots of dawn', { planner: terse })
    expect(plan).toHaveLength(4)
    expect(plan[0].prompt).toBe('the only shot that matters here')
    expect(plan[3].prompt).toContain('coherent visual style') // padded
    expect(run.planner).toBe('llm')
  })
})

describe('planner — JSON sanitizer', () => {
  it('parses clean JSON', () => {
    const shots = parsePlannerShots(
      '{"shots":[{"prompt":"wide shot of the lighthouse","note":"establishing"}]}',
      'goal',
      2
    )
    expect(shots).toEqual([{ shot: 1, prompt: 'wide shot of the lighthouse', note: 'establishing' }])
  })

  it('strips markdown code fences around the JSON', () => {
    const shots = parsePlannerShots(
      '```json\n{"shots":[{"prompt":"cat on a roof","note":"b"},{"prompt":"dog in fog","note":"d"}]}\n```',
      'goal',
      2
    )
    expect(shots).toHaveLength(2)
  })

  it('returns null for non-JSON, arrays, or wrong shapes', () => {
    expect(parsePlannerShots('just some prose about shots', 'goal', 2)).toBeNull()
    expect(parsePlannerShots('["not","objects"]', 'goal', 2)).toBeNull()
    expect(parsePlannerShots('{"shots":"nope"}', 'goal', 2)).toBeNull()
    expect(parsePlannerShots('{"shots":[{"note":"missing prompt"}]}', 'goal', 2)).toBeNull()
    expect(parsePlannerShots('{}', 'goal', 2)).toBeNull()
  })

  it('drops entries with empty or oversized prompts and renumbers shots', () => {
    const shots = parsePlannerShots(
      JSON.stringify({
        shots: [
          { prompt: '', note: 'empty prompt dropped' },
          { prompt: 'x'.repeat(600), note: 'oversized dropped' },
          { prompt: 'kept shot', note: 'final' },
        ],
      }),
      'goal',
      3
    )
    expect(shots).toEqual([{ shot: 1, prompt: 'kept shot', note: 'final' }])
  })
})
