// src/lib/insights.ts — the margin lens (T7).
//
// One read-only, caller-scoped economics snapshot over the caller's own
// jobs and ledger: job totals, ledger flow by kind, provider cost, revenue
// proxy (credits actually consumed priced at the caller's plan rate) and
// gross margin — plus a per-(provider x model x resolution) tier table so
// hosted economics are visible per combination.
//
// Accounting choices, deliberately honest:
//   - provider cost sums across ALL jobs, including failures: a failed
//     hosted render still burns real GPU/API money (the customer is made
//     whole via the refund; the operator is not).
//   - revenue prices CONSUMED credits only (spend - refunds) at the
//     caller's plan rate; trial credits generate no revenue.
//   - gross margin is (revenue - cost) / revenue; zero revenue reports
//     margin 0 (never NaN).
//
// Two flat queries + an in-memory join (jobs x generations for the
// provider name) — no N+1.

import { db } from '@/lib/db'
import { usdPerCredit } from '@/lib/economics'

export interface InsightsJobTotals {
  total: number
  queued: number
  running: number
  moderated: number
  completed: number
  failed: number
}

export interface InsightsLedger {
  /** signup + monthly + topup inflows. */
  granted: number
  /** credits charged (positive number). */
  spent: number
  refunded: number
  balance: number
}

export interface InsightsEconomics {
  /** (spent - refunded) x usdPerCredit(plan). */
  revenueUsd: number
  /** Sum of Job.providerCostUsd across every job (failures included). */
  providerCostUsd: number
  /** (revenue - cost) / revenue x 100; 0 when revenue is 0. */
  grossMarginPct: number
}

export interface InsightsTier {
  provider: string
  model: string
  resolution: string
  jobs: number
  credits: number
  costUsd: number
  revenueUsd: number
  marginPct: number
  avgCostUsdPerJob: number
}

export interface InsightsSnapshot {
  plan: string
  jobs: InsightsJobTotals
  ledger: InsightsLedger
  economics: InsightsEconomics
  tiers: InsightsTier[]
  generatedAt: string
}

const EMPTY_TOTALS: InsightsJobTotals = {
  total: 0,
  queued: 0,
  running: 0,
  moderated: 0,
  completed: 0,
  failed: 0,
}

/** Provider per job, from the generation row (default: local demo). */
async function providerByJobId(userId: string): Promise<Map<string, string>> {
  const generations = await db.generation.findMany({
    where: { job: { userId } },
    select: { jobId: true, provider: true },
  })
  const map = new Map<string, string>()
  for (const g of generations) {
    if (!map.has(g.jobId)) map.set(g.jobId, g.provider) // first row = the run that counted
  }
  return map
}

export async function getInsights(userId: string): Promise<InsightsSnapshot> {
  const [user, jobs, ledgerRows, providers] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { plan: true, credits: true },
    }),
    db.job.findMany({
      where: { userId },
      select: {
        id: true,
        kind: true,
        model: true,
        resolution: true,
        status: true,
        creditsCharged: true,
        providerCostUsd: true,
      },
    }),
    db.creditTransaction.groupBy({
      by: ['kind'],
      where: { userId },
      _sum: { amount: true },
    }),
    providerByJobId(userId),
  ])

  // ------------------------------------------------------------ jobs
  const totals = { ...EMPTY_TOTALS }
  for (const job of jobs) {
    totals.total++
    if (job.status in totals) {
      totals[job.status as keyof InsightsJobTotals]++
    }
  }

  // ---------------------------------------------------------- ledger
  const sumOf = (kind: string) =>
    Math.abs(ledgerRows.find((r) => r.kind === kind)?._sum.amount ?? 0)
  const granted = ['signup', 'monthly', 'topup'].reduce((acc, kind) => acc + sumOf(kind), 0)
  const spent = sumOf('spend')
  const refunded = sumOf('refund')

  // ------------------------------------------------------- economics
  const rate = usdPerCredit(user.plan)
  const consumed = spent - refunded
  const revenueUsd = Math.max(0, consumed) * rate
  const providerCostUsd = jobs.reduce((acc, j) => acc + (j.providerCostUsd ?? 0), 0)
  const grossMarginPct =
    revenueUsd > 0 ? ((revenueUsd - providerCostUsd) / revenueUsd) * 100 : 0

  // ------------------------------------------------------------ tiers
  const tierMap = new Map<string, InsightsTier>()
  for (const job of jobs) {
    const provider = providers.get(job.id) ?? 'demo'
    const key = `${provider}|${job.model}|${job.resolution}`
    const tier =
      tierMap.get(key) ??
      ({
        provider,
        model: job.model,
        resolution: job.resolution,
        jobs: 0,
        credits: 0,
        costUsd: 0,
        revenueUsd: 0,
        marginPct: 0,
        avgCostUsdPerJob: 0,
      } satisfies InsightsTier)
    tier.jobs++
    tier.credits += job.creditsCharged
    tier.costUsd += job.providerCostUsd ?? 0
    tierMap.set(key, tier)
  }
  const tiers = [...tierMap.values()].map((tier) => {
    tier.revenueUsd = tier.credits * rate
    tier.marginPct = tier.revenueUsd > 0 ? ((tier.revenueUsd - tier.costUsd) / tier.revenueUsd) * 100 : 0
    tier.avgCostUsdPerJob = tier.jobs > 0 ? tier.costUsd / tier.jobs : 0
    return tier
  })

  return {
    plan: user.plan,
    jobs: totals,
    ledger: { granted, spent, refunded, balance: user.credits },
    economics: {
      revenueUsd: Math.round(revenueUsd * 1e10) / 1e10,
      providerCostUsd: Math.round(providerCostUsd * 1e10) / 1e10,
      grossMarginPct: Math.round(grossMarginPct * 1e6) / 1e6,
    },
    tiers: tiers.map((tier) => ({
      ...tier,
      costUsd: Math.round(tier.costUsd * 1e10) / 1e10,
      revenueUsd: Math.round(tier.revenueUsd * 1e10) / 1e10,
      marginPct: Math.round(tier.marginPct * 1e6) / 1e6,
      avgCostUsdPerJob: Math.round(tier.avgCostUsdPerJob * 1e10) / 1e10,
    })),
    generatedAt: new Date().toISOString(),
  }
}
