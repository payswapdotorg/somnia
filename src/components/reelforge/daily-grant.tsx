'use client'

import { Sparkles } from 'lucide-react'
import * as React from 'react'
import type { DailyGrantDto } from '@/lib/types'

/**
 * Phase 9 (N6): daily free-refill indicator. Shows "+20/day" with a live
 * countdown to the next UTC-midnight unlock — the play-money counterpart of
 * daily-login credit drops. Compact by design: a quiet chip next to the
 * balance, not a modal.
 */

function hoursMinutesLeft(target: string): string {
  const ms = new Date(target).getTime() - Date.now()
  if (ms <= 0) return 'soon'
  const totalMinutes = Math.floor(ms / 60000)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function DailyGrantCountdown({
  grant,
  className,
}: {
  grant: DailyGrantDto | null
  className?: string
}) {
  const [, forceTick] = React.useReducer((n: number) => n + 1, 0)

  // Re-render every minute so the countdown stays honest.
  React.useEffect(() => {
    const timer = window.setInterval(forceTick, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  if (!grant) {
    return (
      <span
        className={`inline-flex h-9 items-center gap-1.5 rounded-full border border-border/60 px-3.5 text-xs text-muted-foreground ${className ?? ''}`}
        aria-hidden="true"
      >
        <Sparkles className="size-3.5" />
        +20/day
      </span>
    )
  }

  const left = hoursMinutesLeft(grant.nextRefillAt)
  return (
    <span
      className={`inline-flex h-9 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3.5 text-xs font-medium text-primary tabular-nums ${className ?? ''}`}
      title={`Daily +${grant.amount} credits unlock at the next UTC midnight`}
    >
      <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="whitespace-nowrap">+{grant.amount}/day · next in {left}</span>
    </span>
  )
}
