'use client'

import { StatusChip, TierChip } from '@/components/reelforge/bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type {
  InsightsDto,
  InsightsTotalsDto,
  JobStatus,
  ProviderHealthDto,
  Tier,
} from '@/lib/types'
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  ChartColumn,
  CircleAlert,
  CircleCheck,
  CircleDollarSign,
  CircleX,
  Clapperboard,
  Coins,
  Cpu,
  Film,
  Gauge,
  Lightbulb,
  RefreshCw,
  Server,
  Terminal,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import * as React from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from 'recharts'

/**
 * Phase 4 — Ops & Insights tab: cost-per-generation dashboard + provider
 * health. Read-only: fetches /api/insights + /api/providers/health when the
 * tab activates (plus a manual refresh). No background interval polling.
 */

const intFmt = new Intl.NumberFormat('en-US')
const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const pctFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
const pctFmt0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/** "2026-10-13" → "Oct 13" (UTC-stable, no server/client drift). */
function formatDayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return '—'
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

const KNOWN_KINDS = ['generation', 'transform', 'grant', 'refund'] as const

const KIND_META: Record<string, { label: string; color: string }> = {
  generation: { label: 'Generation', color: 'var(--chart-1)' },
  transform: { label: 'Transform', color: 'var(--chart-4)' },
  grant: { label: 'Grant', color: 'var(--chart-2)' },
  refund: { label: 'Refund', color: 'var(--chart-5)' },
}
const KIND_FALLBACK_COLOR = 'var(--chart-3)'

function kindLabel(kind: string): string {
  return KIND_META[kind]?.label ?? kind.charAt(0).toUpperCase() + kind.slice(1)
}

function kindColor(kind: string): string {
  return KIND_META[kind]?.color ?? KIND_FALLBACK_COLOR
}

const jobsPerDayConfig = { count: { label: 'Generations', color: 'var(--chart-1)' } } satisfies ChartConfig
const boardConfig = { jobs: { label: 'Jobs', color: 'var(--chart-2)' } } satisfies ChartConfig
const ledgerConfig = { credits: { label: 'Credits', color: 'var(--chart-2)' } } satisfies ChartConfig

// ── Small building blocks ───────────────────────────────────────────────

interface KpiCardProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub?: string
}

function KpiCard({ icon: Icon, label, value, sub }: KpiCardProps) {
  return (
    <Card className="gap-2 p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      {sub ? <p className="text-xs leading-snug text-muted-foreground">{sub}</p> : null}
    </Card>
  )
}

function ChartPlaceholder({ message }: { message: string }) {
  return (
    <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-border/70 text-sm text-muted-foreground">
      {message}
    </div>
  )
}

function KpisRow({ totals }: { totals: InsightsTotalsDto }) {
  const avgCostPerCompleted =
    totals.jobsCompleted > 0 ? usdFmt.format(totals.providerCostUsdTotal / totals.jobsCompleted) : '—'
  return (
    <section aria-label="Key studio metrics" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 sm:gap-4">
      <KpiCard
        icon={Clapperboard}
        label="Total generations"
        value={intFmt.format(totals.jobsTotal)}
        sub={`${intFmt.format(totals.jobsCompleted)} completed · ${intFmt.format(totals.jobsFailed)} failed`}
      />
      <KpiCard
        icon={Film}
        label="Acceptance rate"
        value={`${pctFmt0.format(totals.acceptanceRate * 100)}%`}
        sub={`${intFmt.format(totals.jobsWithVideo)} delivered an MP4`}
      />
      <KpiCard
        icon={Coins}
        label="Credits granted / spent"
        value={`${intFmt.format(totals.creditsGranted)} / ${intFmt.format(totals.creditsSpent)}`}
        sub="play-money ledger flow"
      />
      <KpiCard
        icon={Wallet}
        label="Current balance"
        value={`${intFmt.format(totals.creditsBalance)} cr`}
        sub="demo studio account"
      />
      <KpiCard
        icon={CircleDollarSign}
        label="Provider cost"
        value={usdFmt.format(totals.providerCostUsdTotal)}
        sub="sum of job provider costs"
      />
      <KpiCard
        icon={TrendingUp}
        label="Gross margin (proxy)"
        value={totals.grossMarginPct === null ? '—' : `${pctFmt.format(totals.grossMarginPct)}%`}
        sub="revenue proxy vs provider cost"
      />
      <KpiCard
        icon={Gauge}
        label="Avg cost / completed"
        value={avgCostPerCompleted}
        sub="provider cost per finished job"
      />
    </section>
  )
}

const FUNNEL_STATUSES: JobStatus[] = ['queued', 'dispatched', 'running', 'moderated', 'completed', 'failed']

function StatusFunnel({ breakdown }: { breakdown: Record<JobStatus, number> }) {
  return (
    <Card className="gap-2 p-4">
      <p className="text-xs font-medium text-muted-foreground">Pipeline funnel — every job lands in one bucket</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {FUNNEL_STATUSES.map((status) => {
          const count = breakdown[status] ?? 0
          return (
            <span
              key={status}
              className={cn('inline-flex items-center gap-1.5', count === 0 && 'opacity-55')}
            >
              <StatusChip status={status} />
              <span className="text-xs font-semibold tabular-nums text-foreground">{intFmt.format(count)}</span>
            </span>
          )
        })}
      </div>
    </Card>
  )
}

// ── Charts ──────────────────────────────────────────────────────────────

function JobsPerDayChart({ data }: { data: InsightsDto['jobsPerDay'] }) {
  return (
    <Card className="gap-3 p-4 sm:p-5">
      <div>
        <CardTitle className="text-sm">Jobs per day</CardTitle>
        <CardDescription className="mt-1 text-xs">Submissions over the last 14 days (UTC)</CardDescription>
      </div>
      <ChartContainer config={jobsPerDayConfig} className="aspect-auto h-52 w-full sm:h-60">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={20}
            tickFormatter={(value) => formatDayLabel(String(value))}
          />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={30} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(label) => formatDayLabel(String(label))}
                formatter={(value) => [intFmt.format(Number(value ?? 0)), 'Jobs'] as [string, string]}
              />
            }
          />
          <Bar dataKey="count" fill="var(--chart-1)" fillOpacity={0.75} radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ChartContainer>
    </Card>
  )
}

function LedgerKindChart({ ledgerByKind }: { ledgerByKind: InsightsDto['ledgerByKind'] }) {
  const known = KNOWN_KINDS.filter((kind) => ledgerByKind[kind])
  const unknown = Object.keys(ledgerByKind).filter((kind) => !KNOWN_KINDS.includes(kind as never))
  const entries = [
    ...known.map((kind) => ({ kind, credits: Math.abs(ledgerByKind[kind].credits) })),
    ...unknown.map((kind) => ({ kind, credits: Math.abs(ledgerByKind[kind].credits) })),
  ]

  return (
    <Card className="gap-3 p-4 sm:p-5">
      <div>
        <CardTitle className="text-sm">Credits by ledger kind</CardTitle>
        <CardDescription className="mt-1 text-xs">Volume per ledger activity (magnitude)</CardDescription>
      </div>
      {entries.length === 0 ? (
        <ChartPlaceholder message="No ledger activity yet." />
      ) : (
        <>
          <ChartContainer config={ledgerConfig} className="aspect-auto h-48 w-full sm:h-56">
            <PieChart>
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    nameKey="kind"
                    formatter={(value, name) => [
                      `${intFmt.format(Number(value ?? 0))} cr`,
                      kindLabel(String(name)),
                    ] as [string, string]}
                  />
                }
              />
              <Pie
                data={entries}
                dataKey="credits"
                nameKey="kind"
                innerRadius="60%"
                outerRadius="85%"
                paddingAngle={3}
                cornerRadius={4}
                strokeWidth={0}
              >
                {entries.map((entry) => (
                  <Cell key={entry.kind} fill={kindColor(entry.kind)} fillOpacity={0.8} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
          <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
            {entries.map((entry) => (
              <li key={entry.kind} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: kindColor(entry.kind) }}
                  aria-hidden="true"
                />
                {kindLabel(entry.kind)}
                <span className="font-medium tabular-nums text-foreground">
                  {intFmt.format(entry.credits)} cr
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}

function TierComparison({ perTier }: { perTier: InsightsDto['perTier'] }) {
  const tiers: Tier[] = ['draft', 'quality']
  return (
    <Card className="gap-3 p-4 sm:p-5">
      <div>
        <CardTitle className="text-sm">Tier economics</CardTitle>
        <CardDescription className="mt-1 text-xs">Draft vs quality — jobs, credits and provider cost</CardDescription>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {tiers.map((tier) => {
          const stats = perTier[tier]
          return (
            <div key={tier} className="rounded-lg border border-border/70 bg-background/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <TierChip tier={tier} />
                <span className="text-lg font-bold tabular-nums">{intFmt.format(stats.jobs)}</span>
              </div>
              <dl className="mt-2.5 space-y-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">Credits charged</dt>
                  <dd className="font-medium tabular-nums">{intFmt.format(stats.credits)}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">Provider cost</dt>
                  <dd className="font-medium tabular-nums">{usdFmt.format(stats.providerCostUsd)}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">Avg cost / job</dt>
                  <dd className="font-medium tabular-nums">{usdFmt.format(stats.avgCostUsdPerJob)}</dd>
                </div>
              </dl>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function BoardUsageChart({ data }: { data: InsightsDto['boardUsage'] }) {
  return (
    <Card className="gap-3 p-4 sm:p-5">
      <div>
        <CardTitle className="text-sm">Board usage</CardTitle>
        <CardDescription className="mt-1 text-xs">Top boards by job count</CardDescription>
      </div>
      {data.length === 0 ? (
        <ChartPlaceholder message="No boards in use yet." />
      ) : (
        <ChartContainer config={boardConfig} className="aspect-auto h-52 w-full sm:h-60">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid horizontal={false} strokeDasharray="3 3" />
            <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
            <YAxis
              type="category"
              dataKey="board"
              width={104}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => {
                const name = String(value)
                return name.length > 16 ? `${name.slice(0, 15)}…` : name
              }}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) => [intFmt.format(Number(value ?? 0)), 'Jobs'] as [string, string]}
                />
              }
            />
            <Bar dataKey="jobs" fill="var(--chart-2)" fillOpacity={0.75} radius={[0, 4, 4, 0]} maxBarSize={20} />
          </BarChart>
        </ChartContainer>
      )}
    </Card>
  )
}

// ── Provider health ─────────────────────────────────────────────────────

function HealthFact({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 text-sm text-foreground">{children}</dd>
      </div>
    </div>
  )
}

function ProviderHealthCard({ health }: { health: ProviderHealthDto }) {
  const isDemo = health.activeProvider === 'demo'
  const providerBadge =
    health.activeProvider === 'selfhosted'
      ? 'selfhosted · gpu tier'
      : health.activeProvider === 'fal'
        ? 'fal · live'
        : 'demo engine'
  const providerCaption =
    health.activeProvider === 'selfhosted'
      ? 'self-hosted open-model gateway'
      : health.activeProvider === 'fal'
        ? 'remote queue adapter'
        : 'local keyframes + ffmpeg composite'
  return (
    <Card className="gap-4 p-4 sm:p-5" aria-label="Provider health">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="text-sm">Provider health</CardTitle>
          <CardDescription className="mt-1 text-xs">Engine, renderer and recent activity</CardDescription>
        </div>
        <Badge
          variant="outline"
          className={
            isDemo
              ? 'gap-1.5 border-amber-500/40 bg-amber-500/15 text-amber-600 dark:text-amber-400'
              : 'gap-1.5 border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
          }
        >
          <Server className="size-3" aria-hidden="true" />
          {providerBadge}
        </Badge>
      </div>

      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        <HealthFact icon={Server} label="Active provider">
          {health.activeProvider}
          <span className="block text-xs text-muted-foreground">{providerCaption}</span>
        </HealthFact>
        <HealthFact icon={Cpu} label="Self-hosted GPU">
          {health.selfHostedConfigured ? (
            <span className="inline-flex items-center gap-1.5">
              <CircleCheck className="size-3.5 text-emerald-500" aria-hidden="true" />
              <span className="truncate">wired · {health.selfHostedModel ?? 'model'}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <CircleX className="size-3.5 text-muted-foreground" aria-hidden="true" />
              not wired
            </span>
          )}
        </HealthFact>
        <HealthFact icon={Terminal} label="FAL key">
          {health.falConfigured ? (
            <span className="inline-flex items-center gap-1.5">
              <CircleCheck className="size-3.5 text-emerald-500" aria-hidden="true" />
              wired — live calls enabled
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <CircleX className="size-3.5 text-muted-foreground" aria-hidden="true" />
              not wired
            </span>
          )}
        </HealthFact>
        <HealthFact icon={Gauge} label="Renderer (ffmpeg)">
          {health.ffmpegAvailable ? (
            <span className="inline-flex items-center gap-1.5">
              <CircleCheck className="size-3.5 text-emerald-500" aria-hidden="true" />
              <span className="truncate">available · v{health.ffmpegVersion ?? '—'}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <CircleX className="size-3.5 text-red-500" aria-hidden="true" />
              unavailable
            </span>
          )}
        </HealthFact>
        <HealthFact icon={Activity} label="Last job">
          {health.lastJobAt ? formatRelative(health.lastJobAt) : '—'}
        </HealthFact>
        <HealthFact icon={ChartColumn} label="Last 5 minutes">
          {health.last5m.submitted === 0 && health.last5m.completed === 0 && health.last5m.failed === 0 ? (
            <span className="text-muted-foreground">quiet — no activity</span>
          ) : (
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
              <span className="inline-flex items-center gap-1">
                <ArrowUpRight className="size-3.5 text-amber-500" aria-hidden="true" />
                {intFmt.format(health.last5m.submitted)} submitted
              </span>
              <span className="inline-flex items-center gap-1">
                <CircleCheck className="size-3.5 text-emerald-500" aria-hidden="true" />
                {intFmt.format(health.last5m.completed)} completed
              </span>
              <span className="inline-flex items-center gap-1">
                <ArrowDownRight className="size-3.5 text-red-500" aria-hidden="true" />
                {intFmt.format(health.last5m.failed)} failed
              </span>
            </span>
          )}
        </HealthFact>
        <HealthFact icon={Coins} label="Credits remaining">
          <span className={cn('tabular-nums', health.creditsRemaining < 100 && 'font-semibold text-red-500')}>
            {intFmt.format(health.creditsRemaining)} cr
          </span>
          {health.creditsRemaining < 100 && (
            <span className="block text-xs text-red-500/90">drain guard — balance running low</span>
          )}
        </HealthFact>
      </dl>

      {!health.falConfigured && !health.selfHostedConfigured && (
        <p className="flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <Lightbulb className="size-3.5 shrink-0" aria-hidden="true" />
          Wire SELFHOSTED_URL (self-hosted GPU tier) or FAL_KEY (hosted queue) to switch from the demo engine to live generation.
        </p>
      )}
    </Card>
  )
}

// ── Ledger table ────────────────────────────────────────────────────────

function LedgerTable({ rows }: { rows: InsightsDto['recentLedger'] }) {
  return (
    <Card className="gap-3 p-4 sm:p-5" aria-label="Recent credit ledger">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="text-sm">Credit ledger</CardTitle>
          <CardDescription className="mt-1 text-xs">Append-only trail — latest {rows.length || 15} entries</CardDescription>
        </div>
        <span className="text-xs text-muted-foreground">amount · running balance</span>
      </div>
      {rows.length === 0 ? (
        <ChartPlaceholder message="No ledger activity yet." />
      ) : (
        <div className="max-h-96 overflow-y-auto rf-scroll rounded-lg border border-border/60">
          <Table>
            <TableCaption className="sr-only">
              Recent credit ledger entries with signed amounts and running balance
            </TableCaption>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-10">Kind</TableHead>
                <TableHead className="h-10 text-right">Amount</TableHead>
                <TableHead className="h-10 text-right">Balance</TableHead>
                <TableHead className="h-10 text-right">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => (
                <TableRow key={`${row.createdAt}-${index}`}>
                  <TableCell className="py-2.5">
                    <span className="inline-flex items-center rounded-full border border-border/70 bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {kindLabel(row.kind)}
                    </span>
                  </TableCell>
                  <TableCell
                    className={cn(
                      'py-2.5 text-right font-medium tabular-nums',
                      row.amount > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground/90'
                    )}
                  >
                    {row.amount > 0 ? '+' : ''}
                    {intFmt.format(row.amount)}
                  </TableCell>
                  <TableCell className="py-2.5 text-right tabular-nums text-muted-foreground">
                    {intFmt.format(row.balanceAfter)}
                  </TableCell>
                  <TableCell className="py-2.5 text-right text-muted-foreground">
                    {formatRelative(row.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  )
}

// ── Skeletons / empty / error ───────────────────────────────────────────

function InsightsSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading insights">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-24" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 sm:gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-16 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
      <Skeleton className="h-48 rounded-xl" />
    </div>
  )
}

function EmptyState() {
  return (
    <Card className="gap-3 p-8 text-center sm:p-10">
      <Gauge className="mx-auto size-10 text-muted-foreground/40" aria-hidden="true" />
      <div>
        <CardTitle className="text-base">No telemetry yet</CardTitle>
        <CardDescription className="mx-auto mt-2 max-w-sm">
          Forge your first clip in the Studio — cost per generation, ledger flow and pipeline
          health will light up here.
        </CardDescription>
      </div>
    </Card>
  )
}

// ── Tab root ────────────────────────────────────────────────────────────

export function InsightsTab() {
  const [insights, setInsights] = React.useState<InsightsDto | null>(null)
  const [health, setHealth] = React.useState<ProviderHealthDto | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [insightsResponse, healthResponse] = await Promise.all([
        fetch('/api/insights'),
        fetch('/api/providers/health'),
      ])
      if (!insightsResponse.ok || !healthResponse.ok) {
        throw new Error(`insights ${insightsResponse.status} / health ${healthResponse.status}`)
      }
      const [insightsData, healthData] = await Promise.all([
        insightsResponse.json() as Promise<InsightsDto>,
        healthResponse.json() as Promise<ProviderHealthDto>,
      ])
      setInsights(insightsData)
      setHealth(healthData)
      setError(null)
      setUpdatedAt(new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))
    } catch {
      setError('Could not load insights from the studio server.')
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch when the tab activates (the tab content mounts on activation).
  React.useEffect(() => {
    void load()
  }, [load])

  const refreshing = loading && insights !== null

  if (loading && !insights) {
    return <InsightsSkeleton />
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Ops &amp; Insights</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Cost per generation, ledger flow and provider health — read-only telemetry.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          {updatedAt && (
            <span aria-live="polite" className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
              Updated {updatedAt}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh insights data"
            className="min-h-11"
          >
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} aria-hidden="true" />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {error && !insights && (
        <Card className="gap-3 border-red-500/30 p-6">
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-red-500" aria-hidden="true" />
            <div className="flex-1">
              <CardTitle className="text-sm text-red-500">Insights unavailable</CardTitle>
              <CardDescription className="mt-1">{error}</CardDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} className="min-h-11 self-start">
            <RefreshCw className="size-4" aria-hidden="true" />
            Retry
          </Button>
        </Card>
      )}
      {error && insights && (
        <p className="text-xs text-muted-foreground" role="status">
          Last refresh failed — showing previously loaded data.
        </p>
      )}

      {insights &&
        (insights.totals.jobsTotal === 0 ? (
          <EmptyState />
        ) : (
          <>
            <KpisRow totals={insights.totals} />
            <StatusFunnel breakdown={insights.statusBreakdown} />
            <section aria-label="Insights charts" className="grid gap-4 lg:grid-cols-2">
              <JobsPerDayChart data={insights.jobsPerDay} />
              <LedgerKindChart ledgerByKind={insights.ledgerByKind} />
              <TierComparison perTier={insights.perTier} />
              <BoardUsageChart data={insights.boardUsage} />
            </section>
            <p className="text-xs text-muted-foreground/70">
              Revenue proxy assumes retail pricing of $0.01 per credit (draft table: 50 credits =
              $0.50). Credits are play money — no real billing in this build.
            </p>
          </>
        ))}

      {health ? <ProviderHealthCard health={health} /> : <Skeleton className="h-56 rounded-xl" />}

      {insights && <LedgerTable rows={insights.recentLedger} />}
    </div>
  )
}
