// Curated showcase entries for the landing page.
// All clips and posters are Reelforge's own generated media — real SDK
// keyframes composited through the product's render recipe (Ken Burns +
// crossfades via ffmpeg; see scripts/regen_showcase.ts) — committed under
// public/showcase so the landing page works on any deployment, independent
// of runtime media. Tier labels match the render tier of each clip.

export interface ShowcaseEntry {
  /** file name inside public/showcase (mp4) */
  video: string
  /** poster file name inside public/showcase (jpg) */
  poster: string
  /** the prompt that forged the clip (displayed as caption) */
  prompt: string
  /** render tier label */
  tier: 'Draft' | 'Quality'
  /** clip duration */
  seconds: number
  /** optional span flag for the featured first tile */
  featured?: boolean
}

export const HERO_VIDEO = '/showcase/hero.mp4'
export const HERO_POSTER = '/showcase/hero-poster.jpg'

export const SHOWCASE: ShowcaseEntry[] = [
  {
    video: 'paper-boat.mp4',
    poster: 'paper-boat.jpg',
    prompt: 'A paper boat sailing a molten river at dusk, embers trailing behind it',
    tier: 'Quality',
    seconds: 5,
    featured: true,
  },
  {
    video: 'glass-kite.mp4',
    poster: 'glass-kite.jpg',
    prompt: 'A glass kite drifting through a night market, warm lanterns everywhere',
    tier: 'Quality',
    seconds: 5,
  },
  {
    video: 'rooftop-fox.mp4',
    poster: 'rooftop-fox.jpg',
    prompt: 'A tiny fox sprinting across rooftop tiles at blue hour',
    tier: 'Quality',
    seconds: 5,
  },
  {
    video: 'origami-crane.mp4',
    poster: 'origami-crane.jpg',
    prompt: 'An origami crane gliding over a still lake at dawn',
    tier: 'Draft',
    seconds: 5,
  },
  {
    video: 'canyon-balloon.mp4',
    poster: 'canyon-balloon.jpg',
    prompt: 'A hot air balloon rising over misty canyon ridges at sunrise',
    tier: 'Draft',
    seconds: 5,
  },
  {
    video: 'paper-lantern.mp4',
    poster: 'paper-lantern.jpg',
    prompt: 'A paper lantern released into a twilight sky, drifting upward',
    tier: 'Draft',
    seconds: 5,
  },
  {
    video: 'bronze-compass.mp4',
    poster: 'bronze-compass.jpg',
    prompt: 'A bronze compass spinning on an old sea chart',
    tier: 'Draft',
    seconds: 5,
  },
  {
    video: 'seabird-keeper.mp4',
    poster: 'seabird-keeper.jpg',
    prompt: 'A lighthouse keeper counting seabirds at golden hour, gentle waves',
    tier: 'Draft',
    seconds: 5,
  },
  {
    video: 'moonlit-gutter.mp4',
    poster: 'moonlit-gutter.jpg',
    prompt: 'A paper boat drifting down a moonlit gutter, cinematic macro shot',
    tier: 'Draft',
    seconds: 5,
  },
]
