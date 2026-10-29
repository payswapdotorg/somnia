'use client'

import { Badge } from '@/components/ui/badge'
import { Coins, GitBranch, PenLine } from 'lucide-react'
import * as React from 'react'

/** Header chip showing the live credit balance. */
export function CreditsChip({ balance }: { balance: number | null }) {
  return (
    <Badge
      variant="outline"
      className="h-11 min-w-11 gap-2 rounded-xl border-primary/40 bg-primary/10 px-3 text-sm font-semibold text-primary tabular-nums"
      aria-label={`Credit balance: ${balance ?? '…'} credits`}
    >
      <Coins className="size-4" aria-hidden="true" />
      {balance === null ? <span className="animate-pulse">…</span> : `${balance} cr`}
    </Badge>
  )
}

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      role="img"
      aria-label="Reelforge logo: a film reel over an ember spark"
    >
      <defs>
        <linearGradient id="rf-ember" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#fbbf24" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="12" fill="#18181b" stroke="url(#rf-ember)" strokeWidth="2.5" />
      <path
        d="M24 9c-6.6 0-12 5.4-12 12s5.4 12 12 12h9.5c1.4 0 2.5-1.1 2.5-2.5V21c0-6.6-5.4-12-12-12z"
        fill="url(#rf-ember)"
        opacity="0.92"
      />
      <circle cx="19.5" cy="21" r="2.4" fill="#18181b" />
      <circle cx="28.5" cy="17.5" r="2.4" fill="#18181b" />
      <circle cx="28.5" cy="24.5" r="2.4" fill="#18181b" />
      <path d="M14 39h20" stroke="url(#rf-ember)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function StatusChip({ status }: { status: string }) {
  const styles: Record<string, string> = {
    queued: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
    dispatched: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    running: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    moderated: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
    completed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    failed: 'bg-red-500/15 text-red-400 border-red-500/30',
  }
  // Phase 2 pipeline labels: 'running' is the keyframe pass, 'moderated' is
  // the video composite phase (moderation + ffmpeg render window).
  const labels: Record<string, string> = {
    running: 'generating frames',
    moderated: 'rendering video',
  }
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${styles[status] ?? styles.queued}`}
    >
      {labels[status] ?? status}
    </span>
  )
}

/** Small board label chip (Phase 2 organizer). */
export function BoardChip({ board }: { board: string }) {
  return (
    <span className="inline-flex max-w-[10rem] items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary/90">
      <span className="truncate" title={board}>
        {board}
      </span>
    </span>
  )
}

/** Phase 3: edit-thread version badge ("edit v2" = first edit child). */
export function VersionChip({ version }: { version: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-orange-500/40 bg-orange-500/15 px-2 py-0.5 text-[11px] font-semibold text-orange-400">
      <PenLine className="size-3" aria-hidden="true" />
      edit v{version}
    </span>
  )
}

/** Phase 3: derived-clip kind chip (re-crop / camera move). */
export function VariantChip({ kind }: { kind: 'reframe' | 'camera' | 'restyle' }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-400">
      <GitBranch className="size-3" aria-hidden="true" />
      {kind === 'reframe' ? 're-crop' : kind === 'camera' ? 'camera' : 'restyle'}
    </span>
  )
}

export function TierChip({ tier }: { tier: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        tier === 'quality'
          ? 'border-amber-500/40 bg-amber-500/15 text-amber-400'
          : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400'
      }`}
    >
      {tier === 'quality' ? 'Quality' : 'Draft'}
    </span>
  )
}

/** Phase 8: creation surface — video clip vs single still. */
export function KindChip({ kind }: { kind: string }) {
  if (kind !== 'image') return null
  return (
    <span className="inline-flex items-center rounded-full border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-400">
      Image
    </span>
  )
}

export function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

/** Truncate a prompt for row/card display. */
export function excerpt(prompt: string, max = 72): string {
  return prompt.length > max ? prompt.slice(0, max - 1) + '…' : prompt
}
