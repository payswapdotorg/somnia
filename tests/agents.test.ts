// tests/agents.test.ts — TDD RED first.
// Creative agents: a goal becomes a deterministic plan (shot list), the plan
// gates how many variations may dispatch (plan multiplier), jobs are created
// and linked to the run, and the run reaches a terminal state.
import { describe, expect, it, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import {
  planAgentRun,
  startAgentRun,
  getAgentRun,
} from '@/lib/agents'

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
