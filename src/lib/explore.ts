// Reelforge Phase 9 — curated community gallery for /explore (N2).
//
// Every entry is real Reelforge output: the video tiles are the studio's own
// generated clips (see scripts/regen_showcase.ts) and the stills were forged
// with the same image SDK the product's image mode uses
// (scripts/p9_gallery_stills.ts). Each entry carries its creation recipe so
// the gallery card can deep-link the composer prefilled — the remix loop.

import { SHOWCASE } from '@/lib/showcase'
import type { AspectRatio, Tier } from '@/lib/pricing'

export type ExploreKind = 'video' | 'image'

export interface ExploreEntry {
  /** Stable slug (also the asset file stem in public/showcase). */
  slug: string
  kind: ExploreKind
  /** Media src: mp4 for video tiles, jpg for stills. */
  src: string
  /** Poster for video tiles (jpg). */
  poster: string
  prompt: string
  tier: Tier
  aspectRatio: AspectRatio
  /** Video-only clip length in seconds. */
  seconds?: number
  /** Display span for the featured first tile. */
  featured?: boolean
}

/** Gallery stills — original SDK forgeries committed with the repo. */
const STILLS: ExploreEntry[] = [
  {
    slug: 'still-ember-orchid',
    kind: 'image',
    src: '/showcase/still-ember-orchid.jpg',
    poster: '/showcase/still-ember-orchid.jpg',
    prompt:
      'A bioluminescent orchid glowing embers in a dark rainforest, macro photography, moody cinematic lighting',
    tier: 'quality',
    aspectRatio: '16:9',
  },
  {
    slug: 'still-clockwork-crow',
    kind: 'image',
    src: '/showcase/still-clockwork-crow.jpg',
    poster: '/showcase/still-clockwork-crow.jpg',
    prompt:
      'A crow made of clockwork brass perched on a mossy branch, painterly detail, soft forest light',
    tier: 'quality',
    aspectRatio: '16:9',
  },
  {
    slug: 'still-aurora-whale',
    kind: 'image',
    src: '/showcase/still-aurora-whale.jpg',
    poster: '/showcase/still-aurora-whale.jpg',
    prompt:
      'A whale swimming through a sky full of aurora borealis above snow mountains, dreamlike wide shot',
    tier: 'quality',
    aspectRatio: '16:9',
  },
  {
    slug: 'still-neon-ramen',
    kind: 'image',
    src: '/showcase/still-neon-ramen.jpg',
    poster: '/showcase/still-neon-ramen.jpg',
    prompt:
      'A rainy neon-lit ramen stall at midnight in a narrow alley, steam rising, cinematic reflections',
    tier: 'quality',
    aspectRatio: '16:9',
  },
]

/** Video tiles derived from the curated showcase set. */
const VIDEO_TILES: ExploreEntry[] = SHOWCASE.map((entry) => ({
  slug: entry.video.replace(/\.mp4$/, ''),
  kind: 'video',
  src: `/showcase/${entry.video}`,
  poster: `/showcase/${entry.poster}`,
  prompt: entry.prompt,
  tier: entry.tier === 'Quality' ? 'quality' : 'draft',
  aspectRatio: '16:9',
  seconds: entry.seconds,
  featured: entry.featured,
}))

/**
 * Community grid order: featured clip first, then an alternating weave of
 * stills and clips so both disciplines read immediately, then the rest.
 */
export const EXPLORE_ENTRIES: ExploreEntry[] = [
  VIDEO_TILES[0], // featured paper-boat
  STILLS[0],
  VIDEO_TILES[1],
  STILLS[1],
  VIDEO_TILES[2],
  STILLS[2],
  VIDEO_TILES[3],
  STILLS[3],
  ...VIDEO_TILES.slice(4),
]

export const EXPLORE_FILTERS: Array<{ id: 'all' | ExploreKind; label: string }> = [
  { id: 'all', label: 'All forgeries' },
  { id: 'video', label: 'Video' },
  { id: 'image', label: 'Stills' },
]

export function remixHref(entry: ExploreEntry): string {
  const params = new URLSearchParams({
    mode: entry.kind,
    prompt: entry.prompt,
    tier: entry.tier,
    aspect: entry.aspectRatio,
  })
  if (entry.kind === 'video' && entry.seconds) params.set('duration', String(entry.seconds))
  return `/?${params.toString()}`
}
