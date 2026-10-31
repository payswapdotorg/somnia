// src/components/somnia/app-shell.tsx — the session-aware app frame (T17).
//
// The Dream-Machine layout: a slim left icon rail (logo → primary
// destinations → account cluster) with a fluid, full-bleed main region that
// each page owns. A compact icon top bar takes over below md. Purely
// presentational — the screens own the session state.
'use client'

import Link from 'next/link'
import {
  Sparkles,
  Compass,
  Clock,
  LayoutGrid,
  Bot,
  KeyRound,
  CreditCard,
  LineChart,
} from 'lucide-react'
import { BRAND } from '@/lib/brand'
import { AvatarBlob } from '@/components/somnia/bits'
import type { SessionUser } from '@/hooks/use-session'

export type ShellSection =
  | 'create'
  | 'explore'
  | 'history'
  | 'boards'
  | 'agents'
  | 'keys'
  | 'plans'
  | 'insights'

const NAV: { key: ShellSection; href: string; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'create', href: '/', label: 'Create', icon: Sparkles },
  { key: 'explore', href: '/explore', label: 'Explore', icon: Compass },
  { key: 'history', href: '/history', label: 'History', icon: Clock },
  { key: 'boards', href: '/boards', label: 'Boards', icon: LayoutGrid },
  { key: 'agents', href: '/agents', label: 'Agents', icon: Bot },
]

const SECONDARY: { key: ShellSection; href: string; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'keys', href: '/keys', label: 'API keys', icon: KeyRound },
  { key: 'plans', href: '/plans', label: 'Plans', icon: CreditCard },
  { key: 'insights', href: '/insights', label: 'Insights', icon: LineChart },
]

export interface AppShellProps {
  user: SessionUser | null
  loading?: boolean
  current?: ShellSection
  signOut?: () => void
  children: React.ReactNode
}

function IconLink({
  href,
  label,
  active,
  icon: Icon,
}: {
  href: string
  label: string
  active: boolean
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <Link
      href={href}
      title={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={`group flex size-10 items-center justify-center rounded-xl transition ${
        active
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
      }`}
    >
      <Icon className="size-5" />
    </Link>
  )
}

export function AppShell({ user, loading, current, signOut, children }: AppShellProps) {
  const rail = [...NAV, ...SECONDARY]

  return (
    <div className="flex min-h-screen bg-background">
      {/* ------------------------------------------------ left icon rail */}
      <nav
        aria-label="Primary"
        className="sticky top-0 z-40 hidden h-screen w-[68px] shrink-0 flex-col items-center gap-1 border-r border-border/60 bg-background/95 py-4 backdrop-blur md:flex"
      >
        <Link
          href="/"
          title={BRAND.name}
          aria-label={`${BRAND.name} home`}
          className="mb-3 flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-sm font-bold text-white"
        >
          S
        </Link>

        {NAV.map((item) => (
          <IconLink key={item.key} href={item.href} label={item.label} icon={item.icon} active={current === item.key} />
        ))}

        <div className="mt-auto flex flex-col items-center gap-1">
          {SECONDARY.map((item) => (
            <IconLink key={item.key} href={item.href} label={item.label} icon={item.icon} active={current === item.key} />
          ))}

          <div className="mt-2 flex flex-col items-center gap-1 border-t border-border/60 pt-3">
            {loading ? (
              <span className="size-10 animate-pulse rounded-full bg-muted" aria-hidden="true" />
            ) : user ? (
              <button
                type="button"
                onClick={() => void signOut?.()}
                title={`${user.name} · ${user.credits.toLocaleString()} credits · ${user.plan} plan — sign out`}
                aria-label={`Sign out ${user.name}`}
                className="rounded-full transition hover:opacity-80"
              >
                <AvatarBlob seed={user.avatarSeed} name={user.name} size="lg" />
              </button>
            ) : (
              <Link
                href="/signin"
                title="Sign in"
                aria-label="Sign in"
                className="flex size-10 items-center justify-center rounded-xl bg-primary text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
              >
                →
              </Link>
            )}
          </div>
        </div>
      </nav>

      {/* ------------------------------------------- mobile icon top bar */}
      <header className="sticky top-0 z-40 flex h-14 items-center gap-1 border-b border-border/60 bg-background/90 px-3 backdrop-blur md:hidden">
        <Link
          href="/"
          aria-label={`${BRAND.name} home`}
          className="mr-1 flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-xs font-bold text-white"
        >
          S
        </Link>
        <div className="flex flex-1 items-center gap-0.5 overflow-x-auto">
          {rail.map((item) => {
            const active = current === item.key
            const Icon = item.icon
            return (
              <Link
                key={item.key}
                href={item.href}
                title={item.label}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={`flex size-9 shrink-0 items-center justify-center rounded-lg transition ${
                  active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="size-[18px]" />
              </Link>
            )
          })}
        </div>
        {loading ? (
          <span className="size-8 animate-pulse rounded-full bg-muted" aria-hidden="true" />
        ) : user ? (
          <button
            type="button"
            onClick={() => void signOut?.()}
            aria-label={`Sign out ${user.name}`}
            className="rounded-full transition hover:opacity-80"
          >
            <AvatarBlob seed={user.avatarSeed} name={user.name} size="md" />
          </button>
        ) : (
          <Link
            href="/signin"
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          >
            Sign in
          </Link>
        )}
      </header>

      {/* ------------------------------------------------- fluid region */}
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  )
}
