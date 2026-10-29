'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ArrowRight, Flame, Image as ImageIcon, Bot, Recycle, Terminal } from 'lucide-react'
import * as React from 'react'

/**
 * Phase 8: tool cards — the "do more with your forges" grid on the home
 * surface. Every card points at a REAL shipped feature: transforms (Phase 3),
 * image mode, the Forge Agent, the weekly challenge recipe, and the public
 * REST surface (Phase 6 catch-all). Card art is Reelforge's own showcase
 * media — no third-party assets.
 */

const API_ENDPOINTS: Array<{ method: string; path: string; note: string }> = [
  { method: 'GET', path: '/api/credits', note: 'Balance + recent ledger' },
  { method: 'POST', path: '/api/generate', note: 'Create + charge a video job' },
  { method: 'POST', path: '/api/image', note: 'Create + charge an image still' },
  { method: 'POST', path: '/api/agent', note: 'Forge Agent chat (free)' },
  { method: 'GET', path: '/api/jobs', note: 'Job list (newest first)' },
  { method: 'GET', path: '/api/jobs/:id', note: 'Single job (polling)' },
  { method: 'POST', path: '/api/jobs/:id/edit', note: 'Edit-thread child job' },
  { method: 'POST', path: '/api/jobs/:id/extend', note: '+5s continuation' },
  { method: 'POST', path: '/api/jobs/:id/reframe', note: 'Aspect re-crop (10 cr)' },
  { method: 'POST', path: '/api/jobs/:id/camera', note: 'Camera-move variant (15 cr)' },
  { method: 'POST', path: '/api/jobs/:id/restyle', note: 'Video-to-video style grade (12 cr)' },
  { method: 'POST', path: '/api/jobs/:id/rerun', note: 'Re-run as a fresh job' },
  { method: 'POST', path: '/api/jobs/:id/share', note: 'Mint unlisted share token' },
  { method: 'GET', path: '/api/jobs/shared/:token', note: 'Public share payload' },
  { method: 'GET', path: '/api/media/*', note: 'Range-aware media streaming' },
  { method: 'GET', path: '/api/insights', note: 'Ops + economics aggregates' },
  { method: 'GET', path: '/api/providers/health', note: 'Provider health snapshot' },
]

interface ToolCardData {
  id: string
  art: string
  artAlt: string
  badge: string
  title: string
  description: string
  action: string
  icon: React.ReactNode
  onActivate: () => void
  href?: string
}

export function ToolCards({
  onPickImage,
  onPickAgent,
  onChallenge,
}: {
  onPickImage: () => void
  onPickAgent: () => void
  onChallenge: () => void
}) {
  const [apiOpen, setApiOpen] = React.useState(false)

  const cards: ToolCardData[] = [
    {
      id: 'reforge',
      art: '/showcase/rooftop-fox.jpg',
      artAlt: 'A tiny fox sprinting across rooftop tiles at blue hour',
      badge: 'Transforms',
      title: 'Reforge',
      description:
        'Re-cut any render without regenerating: 9:16 and 1:1 crops, push-ins, drifts, +5s extends — flat credits, instant.',
      action: 'Open the Studio',
      icon: <Recycle className="size-4" aria-hidden="true" />,
      onActivate: () => undefined,
      href: '/studio',
    },
    {
      id: 'image',
      art: '/showcase/paper-lantern.jpg',
      artAlt: 'A paper lantern released into a twilight sky',
      badge: 'Stills',
      title: 'Image Forge',
      description:
        'Single stills in any aspect — concept art, posters, keyframes. One prompt, one image, flat-rate credits.',
      action: 'Switch to Image',
      icon: <ImageIcon className="size-4" aria-hidden="true" />,
      onActivate: onPickImage,
    },
    {
      id: 'agent',
      art: '/showcase/moonlit-gutter.jpg',
      artAlt: 'A paper boat drifting down a moonlit gutter',
      badge: 'Chat',
      title: 'Forge Agent',
      description:
        'Describe the vibe in plain words. The agent sharpens it into a shootable prompt — then forges it in one click.',
      action: 'Talk to the agent',
      icon: <Bot className="size-4" aria-hidden="true" />,
      onActivate: onPickAgent,
    },
    {
      id: 'challenge',
      art: '/showcase/paper-boat.jpg',
      artAlt: 'A paper boat sailing a molten river at dusk',
      badge: 'This week',
      title: 'Forge Challenge',
      description:
        'Forge a paper boat on a molten river, embers trailing behind it. Best clip tops the showcase wall.',
      action: 'Take the challenge',
      icon: <Flame className="size-4" aria-hidden="true" />,
      onActivate: onChallenge,
    },
    {
      id: 'api',
      art: '/showcase/canyon-balloon.jpg',
      artAlt: 'A hot air balloon rising over misty canyon ridges at sunrise',
      badge: 'REST',
      title: 'Reelforge API',
      description:
        'Every surface here is an endpoint — jobs, credits, insights, share links. A clean MCP-ready surface for agents.',
      action: 'View endpoints',
      icon: <Terminal className="size-4" aria-hidden="true" />,
      onActivate: () => setApiOpen(true),
    },
  ]

  return (
    <section aria-labelledby="rf-tools-heading" className="mx-auto w-full max-w-7xl">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 id="rf-tools-heading" className="text-xl font-bold tracking-tight sm:text-2xl">
            Do more with your forges
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Real tools, shipped — not teasers. Every card opens a working surface.
          </p>
        </div>
      </div>

      <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <li key={card.id}>
            {card.href ? (
              <a
                href={card.href}
                className="rf-tool-card group block overflow-hidden rounded-2xl border border-border bg-card"
              >
                <ToolCardBody card={card} />
              </a>
            ) : (
              <button
                type="button"
                onClick={card.onActivate}
                className="rf-tool-card group block w-full overflow-hidden rounded-2xl border border-border bg-card text-left"
              >
                <ToolCardBody card={card} />
              </button>
            )}
          </li>
        ))}
      </ul>

      <Dialog open={apiOpen} onOpenChange={setApiOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Terminal className="size-4 text-primary" aria-hidden="true" />
              Reelforge REST surface
            </DialogTitle>
            <DialogDescription>
              Every capability ships as an endpoint under <code className="text-xs">/api</code> —
              agent-friendly and MCP-ready. No auth in demo mode; wire your provider keys for real
              generation.
            </DialogDescription>
          </DialogHeader>
          <ul className="mt-2 space-y-1.5">
            {API_ENDPOINTS.map((endpoint) => (
              <li
                key={`${endpoint.method}-${endpoint.path}`}
                className="flex items-center gap-3 rounded-lg border border-border/60 bg-secondary/40 px-3 py-2"
              >
                <span
                  className={`w-14 shrink-0 rounded-md px-1.5 py-0.5 text-center text-[10px] font-bold tracking-wide ${
                    endpoint.method === 'GET'
                      ? 'bg-sky-500/15 text-sky-400'
                      : 'bg-primary/15 text-primary'
                  }`}
                >
                  {endpoint.method}
                </span>
                <code className="min-w-0 flex-1 truncate text-xs">{endpoint.path}</code>
                <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:block">
                  {endpoint.note}
                </span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function ToolCardBody({ card }: { card: ToolCardData }) {
  return (
    <>
      <div className="relative h-36 overflow-hidden sm:h-40">
        { }
        <img
          src={card.art}
          alt={card.artAlt}
          className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/30 to-transparent" />
        <span className="absolute left-3 top-3 rounded-full border border-primary/40 bg-background/70 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary backdrop-blur-sm">
          {card.badge}
        </span>
      </div>
      <div className="p-4">
        <h3 className="flex items-center gap-2 text-base font-bold tracking-tight">
          {card.icon}
          {card.title}
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{card.description}</p>
        <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition-transform group-hover:translate-x-0.5">
          {card.action}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </span>
      </div>
    </>
  )
}

/** Exported so the create shell can trigger the challenge recipe. */
export const CHALLENGE_RECIPE = {
  prompt: 'A paper boat sailing a molten river at dusk, embers trailing behind it, cinematic',
  board: 'challenge',
} as const
