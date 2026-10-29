// tests/insights.test.ts — the margin lens (T7).
//
// getInsights(userId) aggregates the caller's own economics into one
// read-only snapshot: job totals, ledger flow by kind, provider cost,
// revenue proxy (credits actually consumed priced at the user's plan
// rate) and gross margin — plus a per-(provider x model x resolution)
// tier table so hosted economics are visible per combination. All numbers
// come from grouped queries, and the domain spec pins exact arithmetic on
// a seeded fixture.
import { describe, it, expect } from 'vitest'
import { db } from '@/lib/db'
import { signup } from '@/lib/auth'
import { createJob, markJobCompleted, markJobFailed } from '@/lib/engine'
import { getInsights } from '@/lib/insights'
import { usdPerCredit } from '@/lib/economics'

let seq = 0
async function newUser(plan = 'trial') {
  const { user } = await signup({
    email: `insights${Date.now()}-${++seq}@somnia.test`,
    password: 'password123',
  })
  if (plan !== 'trial') {
    await db.user.update({ where: { id: user.id }, data: { plan } })
  }
  return user
}

describe('getInsights — totals and ledger flow', () => {
  it('counts jobs by status and reports the ledger by kind', async () => {
    const user = await newUser()
    const done = await createJob({ userId: user.id, prompt: 'a finished clip' })
    await markJobCompleted(done.id, { videoPath: `/generated/${done.id}.mp4` })
    const doomed = await createJob({ userId: user.id, prompt: 'a doomed clip' })
    await markJobFailed(doomed.id, 'boom')
    const moderated = await createJob({ userId: user.id, prompt: 'gore nsfw' })
    expect(moderated.status).toBe('moderated')

    const snap = await getInsights(user.id)

    expect(snap.jobs.total).toBe(3)
    expect(snap.jobs.completed).toBe(1)
    expect(snap.jobs.failed).toBe(1)
    expect(snap.jobs.moderated).toBe(1)

    // trial signup grant 1000, spend -200 (two pulse-3 720p 5s), refund +100
    expect(snap.ledger.granted).toBe(1000)
    expect(snap.ledger.spent).toBe(200)
    expect(snap.ledger.refunded).toBe(100)
    expect(snap.ledger.balance).toBe(900)
  })

  it('scopes every number to the caller (other users are invisible)', async () => {
    const mine = await newUser()
    const other = await newUser()
    await createJob({ userId: other.id, prompt: 'someone else clip' })
    await createJob({ userId: mine.id, prompt: 'my clip' })

    const snap = await getInsights(mine.id)
    expect(snap.jobs.total).toBe(1)
    expect(snap.ledger.granted).toBe(1000) // only my signup grant
  })
})

describe('getInsights — margin lens', () => {
  it('computes revenue proxy, provider cost and gross margin exactly', async () => {
    const user = await newUser('studio') // 90 USD / 40k credits
    const j1 = await createJob({ userId: user.id, prompt: 'hosted flagship clip' })
    await markJobCompleted(j1.id, { videoPath: `/generated/${j1.id}.mp4` })
    // simulate a hosted render having stamped the job row
    await db.job.update({ where: { id: j1.id }, data: { providerCostUsd: 0.12 } })

    const j2 = await createJob({
      userId: user.id,
      prompt: 'failed hosted clip',
      model: 'pulse-flash',
      resolution: '540p',
    })
    await markJobFailed(j2.id, 'gateway 500')
    await db.job.update({ where: { id: j2.id }, data: { providerCostUsd: 0.03 } })

    const snap = await getInsights(user.id)

    // credits: 1000 signup grant (the studio pool is granted lazily by the
    // API read path — pure-domain fixtures never trigger it) - 125 spend
    // (pulse-3 720p 5s = 100; pulse-flash 540p 5s = 25) + 25 refund
    expect(snap.ledger.spent).toBe(125)
    expect(snap.ledger.refunded).toBe(25)

    // revenue proxy prices CONSUMED credits (spend - refunds) at plan rate
    const consumed = snap.ledger.spent - snap.ledger.refunded
    const expectedRevenue = consumed * usdPerCredit('studio')
    expect(snap.economics.revenueUsd).toBeCloseTo(expectedRevenue, 6)
    expect(snap.economics.revenueUsd).toBeCloseTo(100 * usdPerCredit('studio'), 6)

    // provider cost sums across ALL jobs (failures still cost real money)
    expect(snap.economics.providerCostUsd).toBeCloseTo(0.15, 6)

    // gross margin = (revenue - cost) / revenue
    const expectedMargin = (expectedRevenue - 0.15) / expectedRevenue
    expect(snap.economics.grossMarginPct).toBeCloseTo(expectedMargin * 100, 4)
  })

  it('reports 100% margin and zero cost when every render is local demo', async () => {
    const user = await newUser()
    const job = await createJob({ userId: user.id, prompt: 'local demo clip' })
    await markJobCompleted(job.id, { videoPath: `/generated/${job.id}.mp4` })

    const snap = await getInsights(user.id)
    expect(snap.economics.providerCostUsd).toBe(0)
    // trial credits carry no revenue → margin is null-safe
    expect(snap.economics.revenueUsd).toBe(0)
    expect(snap.economics.grossMarginPct).toBe(0)
  })

  it('never divides by zero: zero revenue yields margin 0, not NaN', async () => {
    const user = await newUser('trial')
    const snap = await getInsights(user.id)
    expect(Number.isFinite(snap.economics.grossMarginPct)).toBe(true)
  })
})

describe('getInsights — tier table', () => {
  it('breaks credits and cost down per provider x model x resolution', async () => {
    const user = await newUser()
    const a = await createJob({ userId: user.id, prompt: 'flagship clip' })
    await markJobCompleted(a.id, { videoPath: `/generated/${a.id}.mp4` })
    await db.job.update({ where: { id: a.id }, data: { providerCostUsd: 0.12 } })

    const b = await createJob({
      userId: user.id,
      prompt: 'flash clip',
      model: 'pulse-flash',
      resolution: '540p',
    })
    await markJobCompleted(b.id, { videoPath: `/generated/${b.id}.mp4` })
    await db.job.update({ where: { id: b.id }, data: { providerCostUsd: 0.03 } })

    const snap = await getInsights(user.id)
    expect(snap.tiers).toHaveLength(2)

    const flagship = snap.tiers.find((t) => t.model === 'pulse-3' && t.resolution === '720p')
    expect(flagship).toMatchObject({ provider: 'demo', jobs: 1, credits: 100, costUsd: 0.12 })
    expect(flagship!.marginPct).toBe(0) // trial: no revenue on those credits

    const flash = snap.tiers.find((t) => t.model === 'pulse-flash' && t.resolution === '540p')
    expect(flash).toMatchObject({ jobs: 1, credits: 25, costUsd: 0.03 })
  })

  it('returns an empty (not undefined) snapshot for a fresh account', async () => {
    const user = await newUser()
    const snap = await getInsights(user.id)
    expect(snap.jobs.total).toBe(0)
    expect(snap.tiers).toEqual([])
    expect(snap.economics.providerCostUsd).toBe(0)
  })
})
