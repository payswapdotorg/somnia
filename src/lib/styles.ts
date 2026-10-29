/**
 * Phase 11 (N5): Restyle — video-to-video style treatments.
 *
 * A restyle re-renders a completed clip through a named colour/mood grade:
 * the forge extracts evenly spaced keyframes from the source MP4 (applying
 * the style's filter chain during extraction), then re-composites them with
 * the standard Ken Burns recipe. Styles are plain ffmpeg filter chains —
 * deterministic, dependency-free and provider-agnostic (the same catalogue
 * can later drive a hosted video-to-video model via the provider layer).
 *
 * Clean-room note: these are original treatment names and filter recipes,
 * expressed in Reelforge's forge vocabulary.
 */

export const RESTYLE_STYLE_IDS = ['noir', 'ember', 'frost', 'neon', 'vhs'] as const

export type RestyleStyleId = (typeof RESTYLE_STYLE_IDS)[number]

export interface RestyleStyleMeta {
  id: RestyleStyleId
  /** Human label shown in dialogs and variant chips. */
  label: string
  /** One-line blurb for the picker. */
  blurb: string
  /** ffmpeg -vf chain applied at extraction time. */
  filter: string
  /** Tailwind gradient swatch for the picker chip. */
  swatch: string
}

export const RESTYLE_STYLES: RestyleStyleMeta[] = [
  {
    id: 'noir',
    label: 'Noir',
    blurb: 'Silver monochrome, hard contrast, smoke-shadow mood.',
    filter: 'hue=s=0,eq=contrast=1.28:brightness=-0.04',
    swatch: 'from-zinc-200 via-zinc-500 to-zinc-900',
  },
  {
    id: 'ember',
    label: 'Ember',
    blurb: 'Firelight grade — warm highlights, cooled shadows.',
    filter: 'colorbalance=rs=0.14:gs=-0.04:bs=-0.1,eq=saturation=1.18:contrast=1.06',
    swatch: 'from-amber-200 via-orange-600 to-red-900',
  },
  {
    id: 'frost',
    label: 'Frost',
    blurb: 'Moonlit blues, soft saturation, morning haze.',
    filter: 'colorbalance=rs=-0.08:gs=0.03:bs=0.14,eq=saturation=0.92:contrast=1.05',
    swatch: 'from-sky-200 via-sky-500 to-slate-900',
  },
  {
    id: 'neon',
    label: 'Neon',
    blurb: 'Vivid chroma punch for nightlife and cyber scenes.',
    filter: 'eq=saturation=1.55:contrast=1.16,hue=h=8',
    swatch: 'from-fuchsia-400 via-violet-600 to-indigo-900',
  },
  {
    id: 'vhs',
    label: 'VHS',
    blurb: 'Retro tape — faded chroma, living grain, 80s memory.',
    filter: 'noise=alls=10:allf=t,eq=saturation=0.82:contrast=1.04,hue=s=0.75',
    swatch: 'from-teal-200 via-purple-400 to-neutral-800',
  },
]

const STYLE_BY_ID = new Map<string, RestyleStyleMeta>(RESTYLE_STYLES.map((s) => [s.id, s]))

export function restyleStyle(id: string): RestyleStyleMeta | null {
  return STYLE_BY_ID.get(id) ?? null
}

export function restyleVariantKey(style: RestyleStyleId): string {
  return `restyle-${style}`
}

export function restyleVariantPath(jobId: string, style: RestyleStyleId): string {
  return `/generated/${jobId}-restyle-${style}.mp4`
}

/** Styled keyframe naming — segments feed renderVideo as stills. */
export function restyleFramePath(jobId: string, style: RestyleStyleId, index: number): string {
  return `/generated/${jobId}-restyle-${style}-f${index + 1}.png`
}

/**
 * How many source keyframes a restyle samples — matches the storyboard rhythm
 * the generation engine itself uses (roughly one beat every 3s, 3-5 total).
 */
export function restyleFrameCount(durationSec: number): number {
  return Math.min(5, Math.max(3, Math.round(durationSec / 3)))
}
