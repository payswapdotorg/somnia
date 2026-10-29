// src/components/somnia/plans-app.tsx — the public plan catalogue (T4b).
//
// GET /api/plans rendered as honest cards: price, the monthly credit pool,
// agent economics and features. The caller's plan (or trial, the default,
// when signed out) is highlighted so the ladder reads top-down.
'use client'

import { useEffect, useState } from 'react'
import { SignInInvitation } from '@/components/somnia/bits'
import type { PlanView } from '@/components/somnia/dto'
import type { SessionUser } from '@/hooks/use-session'

export interface PlansAppProps {
  user?: SessionUser | null
}

export function PlansApp({ user }: PlansAppProps) {
  const [plans, setPlans] = useState<PlanView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch('/api/plans', { credentials: 'same-origin' })
        if (!res.ok) throw new Error('catalogue unavailable')
        const body = (await res.json()) as { plans: PlanView[] }
        if (alive) setPlans(body.plans)
      } catch {
        if (alive) setError('The plan catalogue could not be loaded — please retry.')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // Trial is the default plan — an anonymous visitor is effectively on it.
  const currentPlan = user?.plan ?? 'trial'

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-64 animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">{error}</div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Plans that price honestly</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
          Every render charges the same credits whatever plan you are on — plans only change how much
          dreaming you can afford each month, agent headroom and queue speed. Failed renders always refund in full.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => {
          const isCurrent = plan.id === currentPlan
          return (
            <article
              key={plan.id}
              data-plan={plan.id}
              data-current={isCurrent ? 'true' : 'false'}
              className={`flex flex-col rounded-2xl border p-5 ${
                isCurrent ? 'border-primary/60 bg-primary/5 shadow-lg shadow-primary/10' : 'border-border/60 bg-card/60'
              }`}
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold tracking-tight">{plan.label}</h2>
                {isCurrent && (
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                    Current plan
                  </span>
                )}
              </div>
              <p className="mt-3 text-3xl font-semibold tracking-tight">
                ${plan.priceUsd}
                <span className="text-sm font-normal text-muted-foreground"> / month</span>
              </p>
              <ul className="mt-4 flex-1 space-y-2 text-sm text-muted-foreground">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <span aria-hidden="true" className="text-primary">
                      ✓
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-[11px] text-muted-foreground">
                Agent runs at {plan.agentMultiplier}x usage · {plan.agentVariationCap} simultaneous variations
              </p>
            </article>
          )
        })}
      </div>

      {!user && <SignInInvitation what="claim your 1,000 trial credits" />}
    </div>
  )
}
