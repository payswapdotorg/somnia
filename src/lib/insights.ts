import { db } from '@/lib/db'
import { TIERS, round2, type Tier } from '@/lib/pricing'
import type {
  InsightsBoardUsageDto,
  InsightsDayCountDto,
  InsightsDto,
  InsightsTierStatsDto,
  JobStatus,
} from '@/lib/types'
import { getOrCreateDemoUser } from '@/lib/user'

/**
 * Phase 4 — read-only cost-per-generation dashboard aggregation.
 * Every number below is computed with grouped/aggregate Prisma queries (no
 * N+1): counts via `count`, sums via `aggregate`, buckets via `groupBy`,
 * and the 14-day series via a single narrow `findMany` over the window.
 */

/** Retail proxy: $0.01 per credit, from the report's draft pricing table (50cr = $0.50). */
const REVENUE_PER_CREDIT_USD = 0.01

const STATUS_ORDER: JobStatus[] = [
  'queued',
  'dispatched',
  'running',
  'moderated',
  'completed',
  'failed',
]

const DAY_MS = 24 * 60 * 60 * 1000
const NO_BOARD_LABEL = '(no board)'

/** UTC YYYY-MM-DD keys for the last 14 days (inclusive of today), oldest first. */
function last14DayKeys(): string[] {
  const now = new Date()
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const keys: string[] = []
  for (let i = 13; i >= 0; i--) {
    keys.push(new Date(todayUtc - i * DAY_MS).toISOString().slice(0, 10))
  }
  return keys
}

export async function getInsights(): Promise<InsightsDto> {
  const dayKeys = last14DayKeys()
  const windowStart = new Date(`${dayKeys[0]}T00:00:00.000Z`)

  const [
    user,
    jobsTotal,
    jobsCompleted,
    jobsFailed,
    jobsWithVideo,
    jobCostAggregate,
    grantedAggregate,
    spentAggregate,
    tierGroups,
    statusGroups,
    ledgerGroups,
    boardGroups,
    recentWindowJobs,
    recentLedger,
  ] = await Promise.all([
    getOrCreateDemoUser(),
    db.job.count(),
    db.job.count({ where: { status: 'completed' } }),
    db.job.count({ where: { status: 'failed' } }),
    db.job.count({
      where: { status: 'completed', generations: { some: { videoPath: { not: null } } } },
    }),
    db.job.aggregate({ _sum: { providerCostUsd: true } }),
    db.creditTransaction.aggregate({ _sum: { amount: true }, where: { amount: { gt: 0 } } }),
    db.creditTransaction.aggregate({ _sum: { amount: true }, where: { amount: { lt: 0 } } }),
    db.job.groupBy({
      by: ['tier'],
      _count: { _all: true },
      _sum: { creditsCharged: true, providerCostUsd: true },
    }),
    db.job.groupBy({ by: ['status'], _count: { _all: true } }),
    db.creditTransaction.groupBy({
      by: ['kind'],
      _count: { _all: true },
      _sum: { amount: true },
    }),
    db.job.groupBy({
      by: ['board'],
      _count: { _all: true },
      orderBy: { _count: { board: 'desc' } },
      take: 8,
    }),
    // One narrow query for the 14-day series — createdAt only, grouped in JS.
    db.job.findMany({
      where: { createdAt: { gte: windowStart } },
      select: { createdAt: true },
    }),
    db.creditTransaction.findMany({
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: { kind: true, amount: true, balanceAfter: true, jobId: true, createdAt: true },
    }),
  ])

  const creditsGranted = grantedAggregate._sum.amount ?? 0
  const creditsSpent = Math.abs(spentAggregate._sum.amount ?? 0)
  const providerCostUsdTotal = round2(jobCostAggregate._sum.providerCostUsd ?? 0)
  // Revenue proxy: credits spent × $0.01 (report retail table: 50 credits = $0.50).
  const revenueUsdProxy = round2(creditsSpent * REVENUE_PER_CREDIT_USD)
  const grossMarginPct =
    revenueUsdProxy > 0
      ? round2(((revenueUsdProxy - providerCostUsdTotal) / revenueUsdProxy) * 100)
      : null

  const perTier = {} as Record<Tier, InsightsTierStatsDto>
  for (const tier of TIERS) {
    const group = tierGroups.find((g) => g.tier === tier)
    const jobs = group?._count._all ?? 0
    const providerCostUsd = round2(group?._sum.providerCostUsd ?? 0)
    perTier[tier] = {
      jobs,
      credits: group?._sum.creditsCharged ?? 0,
      providerCostUsd,
      avgCostUsdPerJob: jobs > 0 ? round2(providerCostUsd / jobs) : 0,
    }
  }

  const countByDay = new Map<string, number>()
  for (const job of recentWindowJobs) {
    const key = job.createdAt.toISOString().slice(0, 10)
    countByDay.set(key, (countByDay.get(key) ?? 0) + 1)
  }
  const jobsPerDay: InsightsDayCountDto[] = dayKeys.map((date) => ({
    date,
    count: countByDay.get(date) ?? 0,
  }))

  const ledgerByKind: Record<string, { count: number; credits: number }> = {}
  for (const group of ledgerGroups) {
    ledgerByKind[group.kind] = {
      count: group._count._all,
      credits: group._sum.amount ?? 0,
    }
  }

  const boardUsage: InsightsBoardUsageDto[] = boardGroups.map((group) => ({
    board: group.board ?? NO_BOARD_LABEL,
    jobs: group._count._all,
  }))

  const statusBreakdown = {} as Record<JobStatus, number>
  for (const status of STATUS_ORDER) {
    statusBreakdown[status] = statusGroups.find((g) => g.status === status)?._count._all ?? 0
  }

  return {
    totals: {
      jobsTotal,
      jobsCompleted,
      jobsFailed,
      jobsWithVideo,
      acceptanceRate: jobsTotal > 0 ? jobsWithVideo / jobsTotal : 0,
      creditsBalance: user.credits,
      creditsGranted,
      creditsSpent,
      providerCostUsdTotal,
      revenueUsdProxy,
      grossMarginPct,
    },
    perTier,
    jobsPerDay,
    ledgerByKind,
    boardUsage,
    recentLedger: recentLedger.map((tx) => ({
      kind: tx.kind,
      amount: tx.amount,
      balanceAfter: tx.balanceAfter,
      jobId: tx.jobId,
      createdAt: tx.createdAt.toISOString(),
    })),
    statusBreakdown,
  }
}
