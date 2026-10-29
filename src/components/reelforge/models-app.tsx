'use client'

import { AppShellNav } from '@/components/reelforge/app-nav'
import {
  MODEL_ASPECT_NOTE,
  MODEL_CARDS,
  MODEL_GROUP_META,
  VIDEO_COST_TABLE,
  type ModelGroup,
} from '@/lib/models'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ArrowRight, Cog, Coins, Image as ImageIcon, Sparkles, Wand2 } from 'lucide-react'
import Link from 'next/link'
import * as React from 'react'

/**
 * Phase 9 (N1): model lineup directory — the Reelforge engine catalogue.
 *
 * Clean-room note: this follows the model-directory LAYOUT grammar shared by
 * multi-model platforms (grouped sections, badge chips, capability metadata,
 * per-model entry that deep-links the generator) while every card maps to a
 * real shipped engine with its true credit rate — no invented model names.
 */

const GROUP_ICON: Record<ModelGroup, React.ReactNode> = {
  video: <Cog className="size-4" aria-hidden="true" />,
  image: <ImageIcon className="size-4" aria-hidden="true" />,
  agent: <Sparkles className="size-4" aria-hidden="true" />,
  editing: <Wand2 className="size-4" aria-hidden="true" />,
}

function recipeHref(id: string, mode: string, tier?: string): string {
  const params = new URLSearchParams({ mode })
  if (tier) params.set('tier', tier)
  if (id === 'forge-agent') params.set('from', 'models-agent')
  else params.set('from', 'models')
  return `/?${params.toString()}`
}

const GROUP_ORDER: ModelGroup[] = ['video', 'image', 'agent', 'editing']

export function ModelsApp() {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <AppShellNav current="/models" />

      <main className="flex-1">
        {/* Headline */}
        <div className="rf-composer-glow border-b border-border/40">
          <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
            <p className="text-center text-xs font-semibold uppercase tracking-[0.3em] text-primary">
              Engine catalogue
            </p>
            <h1 className="rf-display-glow mt-3 text-center text-3xl font-extrabold uppercase tracking-wide sm:text-5xl">
              The Forge Lineup
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-center text-sm text-muted-foreground sm:text-base">
              Every engine below is live in this build — real credit rates, real pipelines. Pick
              one and the composer loads with it preselected.
            </p>
            <p className="mt-3 text-center text-xs text-muted-foreground">{MODEL_ASPECT_NOTE}</p>
          </div>
        </div>

        {/* Grouped model cards */}
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
          {GROUP_ORDER.map((group) => {
            const meta = MODEL_GROUP_META[group]
            const cards = MODEL_CARDS.filter((card) => card.group === group)
            if (!cards.length) return null
            return (
              <section key={group} className="py-10 sm:py-12" aria-labelledby={`group-${group}`}>
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
                    {GROUP_ICON[group]}
                  </span>
                  <div>
                    <h2 id={`group-${group}`} className="text-xl font-bold tracking-tight sm:text-2xl">
                      {meta.label}
                    </h2>
                    <p className="text-sm text-muted-foreground">{meta.blurb}</p>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {cards.map((card) => (
                    <article
                      key={card.id}
                      className="group relative flex flex-col rounded-2xl border border-border/70 bg-card/60 p-5 transition-all hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-base font-semibold tracking-tight">{card.name}</h3>
                        {card.badge ? (
                          <Badge className="shrink-0 rounded-full bg-primary/15 text-primary hover:bg-primary/15">
                            {card.badge}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        {card.blurb}
                      </p>

                      <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Capabilities">
                        {card.capabilities.map((cap) => (
                          <li
                            key={cap}
                            className="rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground"
                          >
                            {cap}
                          </li>
                        ))}
                      </ul>

                      <div className="mt-4 space-y-1.5 border-t border-border/50 pt-4 text-sm">
                        <p className="flex items-center gap-2 font-medium text-primary">
                          <Coins className="size-4 shrink-0" aria-hidden="true" />
                          {card.creditLine}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Provider reference: {card.costLine}
                        </p>
                        <p className="text-xs text-muted-foreground">{card.engineNote}</p>
                      </div>

                      <Button asChild size="sm" className="mt-5 h-10 w-full rounded-xl">
                        <Link href={recipeHref(card.id, card.recipe.mode, card.recipe.tier)}>
                          Forge with this
                          <ArrowRight
                            className="size-4 transition-transform group-hover:translate-x-0.5"
                            aria-hidden="true"
                          />
                        </Link>
                      </Button>
                    </article>
                  ))}
                </div>
              </section>
            )
          })}
        </div>

        {/* Cost comparison table */}
        <section className="border-t border-border/40 bg-muted/20" aria-labelledby="cost-table">
          <div className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6">
            <h2 id="cost-table" className="text-center text-xl font-bold tracking-tight sm:text-2xl">
              Credits at a glance — video engines
            </h2>
            <p className="mt-2 text-center text-sm text-muted-foreground">
              No surprise metering: the charge is tier rate × seconds, debited before the job runs
              and refunded if it fails.
            </p>
            <div className="mt-6 overflow-x-auto rounded-2xl border border-border/70 bg-card/70">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/70 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th scope="col" className="px-4 py-3 font-medium">Engine</th>
                    <th scope="col" className="px-4 py-3 font-medium">Duration</th>
                    <th scope="col" className="px-4 py-3 font-medium">Credits</th>
                    <th scope="col" className="px-4 py-3 font-medium">Provider ref.</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {VIDEO_COST_TABLE.map((row) => (
                    <tr key={`${row.tier}-${row.seconds}`} className="border-b border-border/40 last:border-0">
                      <td className="px-4 py-2.5 font-medium">
                        <span
                          className={
                            row.tier === 'quality' ? 'text-primary' : 'text-foreground'
                          }
                        >
                          {row.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{row.seconds} s</td>
                      <td className="px-4 py-2.5 font-semibold">{row.credits} cr</td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        ${row.providerUsd.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Still forges are flat-rate: 12 cr (draft) / 24 cr (quality). Reframes 10 cr, camera
              moves 15 cr. Daily free refill: +20 cr at UTC midnight.
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/40 py-8">
        <p className="text-center text-xs text-muted-foreground">
          Reelforge — an original clean-room studio. Engine names describe this build&apos;s real
          pipelines.
        </p>
      </footer>
    </div>
  )
}
