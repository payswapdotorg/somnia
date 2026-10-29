// src/components/somnia/landing.tsx — the signed-out marketing landing (T6c).
//
// What an anonymous visitor to / sees: the Somnia hero (tagline, an honest
// trial promise, links into the auth surface and the public ideas feed),
// the six product pillars and the public plan catalogue from GET /api/plans
// — the ONLY network call this surface makes (no session probing). When the
// catalogue is unreachable the hero stays and an honest note replaces the
// cards. Every string is original Somnia copy (clean-room provenance).
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BRAND } from '@/lib/brand'
import type { PlanView } from '@/components/somnia/dto'

const PILLARS: { title: string; body: string }[] = [
  {
    title: 'Prompt to clip',
    body: 'Describe a dream, get a rendered, seekable MP4 — five or ten seconds, draft or quality, every ratio from 21:9 to 9:21.',
  },
  {
    title: '16-keyframe timeline',
    body: 'Pin up to sixteen frames and let the render walk your timeline beat by beat. First and last frames become the opening and closing shots.',
  },
  {
    title: 'Prism stills',
    body: 'Image mode when you want one perfect frame — the same prompt language, the same honest metering, a poster you can share.',
  },
  {
    title: 'Boards',
    body: 'File finished dreams into boards and hand one unlisted link to a collaborator. Revoking the link kills it; nothing leaks by accident.',
  },
  {
    title: 'Ideas feed & remix',
    body: 'A public feed of what the community dreamed — like what moves you and remix it into your own composer with one click.',
  },
  {
    title: 'Honest credits',
    body: 'Every charge is written to an append-only ledger before the render starts, and refunded in full when a render fails. sk_somnia API keys included.',
  },
]

function priceLabel(plan: PlanView): string {
  return plan.priceUsd === 0 ? 'Free' : `$${plan.priceUsd.toLocaleString('en-US')}/mo`
}

export function LandingApp() {
  const [plans, setPlans] = useState<PlanView[] | null>(null)
  const [catalogueError, setCatalogueError] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch('/api/plans', { credentials: 'same-origin' })
        if (!res.ok) throw new Error('catalogue unavailable')
        const body = (await res.json()) as { plans: PlanView[] }
        if (alive) setPlans(body.plans)
      } catch {
        if (alive) setCatalogueError(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="min-h-screen bg-background">
      {/* ---------------------------------------------------------- header */}
      <header className="border-b border-border/60">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <span className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-xs font-bold text-white">
              S
            </span>
            {BRAND.name}
          </span>
          <Link
            href="/signin"
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* ------------------------------------------------------------ hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-indigo-500/10 via-violet-500/5 to-transparent"
        />
        <div className="relative mx-auto max-w-4xl px-4 py-20 text-center sm:py-28">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
            Dream it. <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent">Render it.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground sm:text-lg">
            {BRAND.description}
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/signin"
              className="rounded-xl bg-primary px-8 py-3 text-base font-medium text-primary-foreground shadow-lg shadow-primary/25 transition hover:bg-primary/90"
            >
              Start dreaming — 1,000 credits on the house
            </Link>
            <Link
              href="/explore"
              className="rounded-xl border border-border/60 bg-card/60 px-8 py-3 text-base font-medium transition hover:bg-muted/60"
            >
              Browse the ideas feed
            </Link>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            No card required. The trial grant lands the moment you create an account.
          </p>
        </div>
      </section>

      {/* -------------------------------------------------------- pillars */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-2xl font-semibold tracking-tight">What you get</h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PILLARS.map((pillar) => (
            <article
              key={pillar.title}
              className="rounded-2xl border border-border/60 bg-card/60 p-6 transition hover:border-primary/40"
            >
              <h3 className="font-medium tracking-tight">{pillar.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{pillar.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------- plans */}
      <section className="border-t border-border/60 bg-card/30">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-center text-2xl font-semibold tracking-tight">The ladder</h2>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            Priced per month, metered per dream. Every tier is the same engine — only the pool and the
            queue change.
          </p>
          {catalogueError ? (
            <p className="mt-10 text-center text-sm text-muted-foreground">
              The plan catalogue could not be loaded — sign in and the in-app Plans surface retries live.
            </p>
          ) : plans ? (
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {plans.map((plan) => (
                <article
                  key={plan.id}
                  data-plan={plan.id}
                  className={`flex flex-col rounded-2xl border p-6 ${
                    plan.id === 'spark'
                      ? 'border-primary/50 bg-primary/5'
                      : 'border-border/60 bg-card/60'
                  }`}
                >
                  <h3 className="font-medium tracking-tight">{plan.label}</h3>
                  <p className="mt-2 text-2xl font-semibold tracking-tight">{priceLabel(plan)}</p>
                  {plan.monthlyCredits > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {plan.monthlyCredits.toLocaleString('en-US')} credits / month
                    </p>
                  )}
                  <ul className="mt-4 flex-1 space-y-2 text-sm text-muted-foreground">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex gap-2">
                        <span aria-hidden="true" className="text-primary">·</span>
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/signin"
                    className="mt-6 rounded-lg border border-border/60 bg-background px-4 py-2 text-center text-sm font-medium transition hover:bg-muted/60"
                  >
                    Start with {plan.label}
                  </Link>
                </article>
              ))}
            </div>
          ) : (
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-64 animate-pulse rounded-2xl bg-muted" />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* --------------------------------------------------------- footer */}
      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 py-10 text-center text-xs text-muted-foreground">
          <p>
            {BRAND.name} is an original clean-room build — every line of engine, ledger and interface
            was written from first principles. No reference-product code, assets or accounts involved.
          </p>
          <p>
            Unlisted share links are the only thing public by default; this landing and the ideas feed
            are the rest.
          </p>
        </div>
      </footer>
    </div>
  )
}
