'use client'

import * as React from 'react'
import type { CreditsDto } from '@/lib/types'

/**
 * Phase 9: shared credits hook — balance, ledger refresh and the daily
 * free-refill state in one place. Every surface that shows the balance chip
 * shares this, so the first mount of a UTC day triggers the refill exactly
 * once no matter which page loads first.
 *
 * `refreshSignal` lets embedding surfaces (e.g. the cockpit composer) poke a
 * re-read after a charge — bump the number to refetch.
 */

interface UseCreditsResult {
  balance: number | null
  dailyGrant: CreditsDto['dailyGrant'] | null
  refresh: () => Promise<void>
}

export function useCredits(refreshSignal?: number): UseCreditsResult {
  const [balance, setBalance] = React.useState<number | null>(null)
  const [dailyGrant, setDailyGrant] = React.useState<CreditsDto['dailyGrant'] | null>(null)

  const refresh = React.useCallback(async () => {
    try {
      const response = await fetch('/api/credits')
      if (!response.ok) return
      const data = (await response.json()) as CreditsDto
      setBalance(data.balance)
      setDailyGrant(data.dailyGrant ?? null)
    } catch {
      /* transient — consumers keep the last known balance */
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh, refreshSignal])

  return { balance, dailyGrant, refresh }
}
