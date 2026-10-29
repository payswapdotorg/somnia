'use client'

import { LogoMark, CreditsChip } from '@/components/reelforge/bits'
import { ThemeToggle } from '@/components/reelforge/theme-toggle'
import { DailyGrantCountdown } from '@/components/reelforge/daily-grant'
import { useCredits } from '@/hooks/use-credits'
import { useToast } from '@/hooks/use-toast'
import Link from 'next/link'
import * as React from 'react'
import { usePathname } from 'next/navigation'

/**
 * Phase 9: shared application-shell navigation for the top-level surfaces
 * (/models, /explore, /history). Mirrors the cockpit header grammar — glass
 * bar, logo, primary nav with active state, live balance + daily-refill
 * countdown, theme toggle — so every surface reads as one app.
 */

const NAV_ITEMS: Array<{ href: string; label: string }> = [
  { href: '/', label: 'Create' },
  { href: '/explore', label: 'Explore' },
  { href: '/models', label: 'Models' },
  { href: '/history', label: 'History' },
  { href: '/showcase', label: 'Showcase' },
  { href: '/studio', label: 'Studio' },
]

export function AppShellNav({ current, refreshSignal }: { current: string; refreshSignal?: number }) {
  const pathname = usePathname()
  const { toast } = useToast()
  const { balance: credits, dailyGrant } = useCredits(refreshSignal)

  // Announce the daily refill exactly once — the first credits read of a
  // UTC day returns justGranted and toasts wherever the user happens to be.
  const announcedRef = React.useRef(false)
  React.useEffect(() => {
    if (dailyGrant?.justGranted && !announcedRef.current) {
      announcedRef.current = true
      toast({
        title: `+${dailyGrant.amount} daily credits`,
        description: 'Your free daily refill just landed. Back at the next UTC midnight.',
      })
    }
  }, [dailyGrant, toast])

  return (
    <header className="rf-safe-top sticky top-0 z-40 rf-glass border-b">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex min-h-11 items-center gap-2.5" aria-label="Reelforge home">
          <LogoMark className="size-9 shrink-0 rounded-xl" />
          <span className="text-lg font-bold tracking-tight">Reelforge</span>
        </Link>

        {/* Desktop nav */}
        <nav aria-label="Primary" className="ml-4 hidden items-center gap-5 md:flex">
          {NAV_ITEMS.map((item) => {
            const active = item.href === current || (item.href !== '/' && pathname === item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={
                  active
                    ? 'text-sm font-medium text-foreground underline-offset-4 hover:underline'
                    : 'text-sm text-muted-foreground transition-colors hover:text-foreground'
                }
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <DailyGrantCountdown grant={dailyGrant ?? null} className="hidden lg:inline-flex" />
          <CreditsChip balance={credits} />
          <ThemeToggle />
        </div>
      </div>

      {/* Mobile nav — scrollable pill row with a right-edge fade that
          signals more items without hard-clipping labels */}
      <div className="relative">
        <nav
          aria-label="Primary mobile"
          className="flex gap-1.5 overflow-x-auto border-t px-4 py-2 md:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {NAV_ITEMS.map((item) => {
            const active = item.href === current
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={
                  active
                    ? 'shrink-0 rounded-full border bg-primary/15 px-3.5 py-1.5 text-xs font-semibold text-primary'
                    : 'shrink-0 rounded-full border border-border/60 px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground'
                }
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent"
        />
      </div>
    </header>
  )
}
