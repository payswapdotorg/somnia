// src/components/somnia/insights-app.tsx — the Insights / usage surface (T8).
//
// GET /api/insights (the T7 margin lens) rendered honestly: job totals,
// ledger flow, revenue / provider cost / gross margin, and the per-
// (provider x model x resolution) tier table. One fetch on mount plus a
// manual Refresh — a usage dashboard has no business polling. Honesty
// rules carried over from the lens: provider cost includes failed renders
// (refunded customers, real GPU money), revenue prices consumed credits
// only, zero revenue reports 0% (never NaN), and negative margins are
// marked in rose rather than hidden.
'use client'

import { useCallback, useEffect, useState } from 'react'
import { SignInInvitation } from '@/components/somnia/bits'
import type { InsightsTierView, InsightsView } from '@/components/somnia/dto'
import type { SessionUser } from '@/hooks/use-session'

export interface InsightsAppProps {
  user?: SessionUser | null
}

const usd = (v: number) => `$${v.toFixed(2)}`
const num = (v: number) => v.toLocaleString('en-US')
/** One decimal, trailing zeros dropped: 49.4253 -> 49.4%, -100 -> -100%. */
const pct = (v: number) => `${Math.round(v * 10) / 10}%`

/** "2026-10-29T12:00:00.000Z" -> "Snapshot 2026-10-29 12:00 UTC" (it IS UTC). */
function generatedLabel(iso: string): string {
  return `Snapshot ${iso.slice(0, 16).replace('T', ' ')} UTC`
}

function StatCard({
  label,
  value,
  sub,
  negative,
}: {
  label: string
  value: string
  sub: string
  negative?: boolean
}) {
  return (
    <article className="rounded-2xl border border-border/60 bg-card/60 p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`mt-2 text-3xl font-semibold tracking-tight ${negative ? 'text-rose-500' : ''}`}
      >
        {value}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">{sub}</p>
    </article>
  )
}

function LedgerStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tracking-tight">{value}</dd>
    </div>
  )
}

function TierRow({ tier }: { tier: InsightsTierView }) {
  const negative = tier.marginPct < 0
  const key = `${tier.provider}|${tier.model}|${tier.resolution}`
  return (
    <tr data-tier={key} className="border-t border-border/40">
      <td className="py-2.5 pr-4 font-medium">{tier.provider}</td>
      <td className="py-2.5 pr-4 text-muted-foreground">{tier.model}</td>
      <td className="py-2.5 pr-4 text-muted-foreground">{tier.resolution}</td>
      <td className="py-2.5 pr-4 tabular-nums">{tier.jobs}</td>
      <td className="py-2.5 pr-4 tabular-nums">{num(tier.credits)}</td>
      <td className="py-2.5 pr-4 tabular-nums">{usd(tier.costUsd)}</td>
      <td className="py-2.5 pr-4 tabular-nums">{usd(tier.revenueUsd)}</td>
      <td
        data-margin={negative ? 'negative' : 'positive'}
        className={`py-2.5 pr-4 tabular-nums font-medium ${negative ? 'text-rose-500' : ''}`}
      >
        {pct(tier.marginPct)}
      </td>
      <td className="py-2.5 tabular-nums text-muted-foreground">{usd(tier.avgCostUsdPerJob)}</td>
    </tr>
  )
}

export function InsightsApp({ user }: InsightsAppProps) {
  const [snapshot, setSnapshot] = useState<InsightsView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/insights', { credentials: 'same-origin' })
      if (!res.ok) throw new Error('insights unavailable')
      setSnapshot((await res.json()) as InsightsView)
    } catch {
      setError('Your usage snapshot could not be loaded — please retry.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    void load()
  }, [user, load])

  if (!user) {
    return <SignInInvitation what="see your usage and margin" />
  }

  if (loading && !snapshot) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-muted" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
        <div className="h-24 animate-pulse rounded-2xl bg-muted" />
        <div className="h-48 animate-pulse rounded-2xl bg-muted" />
      </div>
    )
  }

  if (!snapshot) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        {error ?? 'Your usage snapshot could not be loaded — please retry.'}
        <div className="mt-4">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-border/60 bg-muted/40 px-4 py-2 text-sm font-medium transition hover:bg-muted"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  const { jobs, ledger, economics, tiers, plan, generatedAt } = snapshot

  return (
    <div className={`space-y-6 ${loading ? 'opacity-60 transition-opacity' : ''}`} aria-busy={loading}>
      {/* snapshot header: plan chip, honest UTC stamp, manual refresh */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span
            data-plan={plan}
            className="rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs font-medium capitalize"
          >
            {plan} plan
          </span>
          <time dateTime={generatedAt} className="text-xs">
            {generatedLabel(generatedAt)}
          </time>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-border/60 bg-muted/40 px-4 py-2 text-sm font-medium transition hover:bg-muted"
        >
          Refresh
        </button>
      </div>

      {/* a failed refresh keeps the stale lens visible plus the error + retry */}
      {error && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-600 dark:text-rose-400">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-medium transition hover:bg-rose-500/10"
          >
            Retry
          </button>
        </div>
      )}

      {/* the margin lens: four KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Dreams"
          value={String(jobs.total)}
          sub={`${jobs.completed} completed · ${jobs.failed} failed`}
        />
        <StatCard
          label="Revenue"
          value={usd(economics.revenueUsd)}
          sub="consumed credits × plan rate"
        />
        <StatCard
          label="Provider cost"
          value={usd(economics.providerCostUsd)}
          sub="failures included"
        />
        <StatCard
          label="Gross margin"
          value={pct(economics.grossMarginPct)}
          sub={economics.revenueUsd > 0 ? 'revenue less provider cost' : 'no revenue yet'}
          negative={economics.grossMarginPct < 0}
        />
      </div>

      {/* ledger flow */}
      <section className="rounded-2xl border border-border/60 bg-card/60 p-5">
        <h2 className="text-sm font-semibold tracking-tight">Ledger flow</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <LedgerStat label="Granted" value={num(ledger.granted)} />
          <LedgerStat label="Spent" value={num(ledger.spent)} />
          <LedgerStat label="Refunded" value={num(ledger.refunded)} />
          <LedgerStat label="Balance" value={`${num(ledger.balance)} credits`} />
        </dl>
      </section>

      {/* tier economics */}
      <section className="rounded-2xl border border-border/60 bg-card/60 p-5">
        <h2 className="text-sm font-semibold tracking-tight">Tier economics</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Per provider × model × resolution — the operator view of what each combination actually
          costs and earns. Tier revenue prices charged credits; the global card above prices
          consumed credits (refunds deducted), so the two can differ by exactly your refunds.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="pb-2 pr-4">Provider</th>
                <th className="pb-2 pr-4">Model</th>
                <th className="pb-2 pr-4">Resolution</th>
                <th className="pb-2 pr-4">Dreams</th>
                <th className="pb-2 pr-4">Credits</th>
                <th className="pb-2 pr-4">Cost</th>
                <th className="pb-2 pr-4">Revenue</th>
                <th className="pb-2 pr-4">Margin</th>
                <th className="pb-2">Avg cost</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier) => (
                <TierRow key={`${tier.provider}|${tier.model}|${tier.resolution}`} tier={tier} />
              ))}
            </tbody>
          </table>
        </div>
        {tiers.length === 0 && (
          <p className="mt-4 text-sm text-muted-foreground">
            No renders yet — forge a first dream and the tiers will show up here.
          </p>
        )}
      </section>
    </div>
  )
}
