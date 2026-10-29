// src/components/somnia/app-shell.tsx — the session-aware app frame.
//
// One top bar for every Somnia surface: brand mark, the six primary
// destinations with an honest active state, the live credit balance pulled
// from the session user, and the account cluster (avatar, sign out) or the
// sign-in link. Purely presentational — the screens own the session state.
'use client'

import Link from 'next/link'
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

const NAV: { key: ShellSection; href: string; label: string }[] = [
  { key: 'create', href: '/', label: 'Create' },
  { key: 'explore', href: '/explore', label: 'Explore' },
  { key: 'history', href: '/history', label: 'History' },
  { key: 'boards', href: '/boards', label: 'Boards' },
  { key: 'agents', href: '/agents', label: 'Agents' },
  { key: 'keys', href: '/keys', label: 'API keys' },
  { key: 'plans', href: '/plans', label: 'Plans' },
  { key: 'insights', href: '/insights', label: 'Insights' },
]

export interface AppShellProps {
  user: SessionUser | null
  loading?: boolean
  current?: ShellSection
  signOut?: () => void
  children: React.ReactNode
}

export function AppShell({ user, loading, current, signOut, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-xs font-bold text-white">
              S
            </span>
            <span className="hidden sm:inline">{BRAND.name}</span>
          </Link>

          <nav className="flex flex-1 items-center gap-1 overflow-x-auto text-sm">
            {NAV.map((item) => {
              const active = current === item.key
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 transition ${
                    active
                      ? 'bg-muted font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>

          <div className="flex items-center gap-3">
            {loading ? (
              <span className="h-8 w-24 animate-pulse rounded-lg bg-muted" aria-hidden="true" />
            ) : user ? (
              <>
                <Link
                  href="/plans"
                  className="hidden rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs text-muted-foreground transition hover:text-foreground sm:inline-flex"
                  title="Credit balance"
                >
                  {user.credits.toLocaleString()} credits
                </Link>
                <span className="flex items-center gap-2 text-sm" title={user.email}>
                  <AvatarBlob seed={user.avatarSeed} name={user.name} size="sm" />
                  <span className="hidden max-w-28 truncate md:inline">{user.name}</span>
                </span>
                <button
                  type="button"
                  onClick={() => void signOut?.()}
                  className="rounded-lg px-2 py-1 text-xs text-muted-foreground transition hover:text-foreground"
                >
                  Sign out
                </button>
              </>
            ) : (
              <Link
                href="/signin"
                className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-8">{children}</main>
    </div>
  )
}
