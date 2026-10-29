// src/components/somnia/bits.tsx — small shared Somnia UI atoms.
//
// Presentational only: avatar blob (deterministic gradient per seed), job
// status chips, meta chips and the empty-state sign-in invitation shared by
// every authenticated surface.
'use client'

import Link from 'next/link'
import { AVATAR_SEEDS } from '@/lib/brand'
import type { JobStatus } from '@/components/somnia/dto'

const SEED_STYLES: Record<string, string> = {
  aurora: 'from-indigo-400 to-cyan-300',
  ember: 'from-orange-400 to-rose-400',
  tide: 'from-sky-400 to-teal-300',
  orchid: 'from-fuchsia-400 to-violet-400',
  comet: 'from-slate-300 to-indigo-400',
  frost: 'from-cyan-200 to-sky-400',
  dune: 'from-amber-300 to-orange-400',
  grove: 'from-emerald-300 to-lime-400',
}

export function AvatarBlob({
  seed,
  name,
  size = 'md',
}: {
  seed: string
  name: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const known = (AVATAR_SEEDS as readonly string[]).includes(seed) ? seed : 'aurora'
  const gradient = SEED_STYLES[known] ?? SEED_STYLES.aurora
  const dim = size === 'sm' ? 'size-6 text-[10px]' : size === 'lg' ? 'size-10 text-sm' : 'size-8 text-xs'
  return (
    <span
      aria-hidden="true"
      className={`inline-flex ${dim} shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${gradient} font-semibold uppercase text-white`}
    >
      {name.slice(0, 1)}
    </span>
  )
}

const STATUS_STYLES: Record<string, string> = {
  queued: 'bg-amber-500/15 text-amber-500',
  dispatched: 'bg-sky-500/15 text-sky-400',
  running: 'bg-sky-500/15 text-sky-400',
  moderated: 'bg-red-500/15 text-red-400',
  completed: 'bg-emerald-500/15 text-emerald-500',
  failed: 'bg-red-500/15 text-red-400',
}

export function StatusChip({ status }: { status: JobStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground'}`}
    >
      {status}
    </span>
  )
}

export function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
      {children}
    </span>
  )
}

/** Signed-out invitation shared by every authenticated surface. */
export function SignInInvitation({ what }: { what: string }) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-border/60 bg-card/70 p-10 text-center">
      <h2 className="text-lg font-semibold tracking-tight">Sign in to {what}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Create an account in seconds — the trial grant is 1,000 credits, no card required.
      </p>
      <Link
        href="/signin"
        className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
      >
        Sign in
      </Link>
    </div>
  )
}
