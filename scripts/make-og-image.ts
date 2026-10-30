// scripts/make-og-image.ts — regenerate public/og.png (the branded landing
// OG card, 1200x630). Run after any brand/visual change:
//
//   bun run scripts/make-og-image.ts
//
// Pure raster pipeline: an SVG (brand night gradient, S mark, wordmark,
// tagline) rendered by sharp/librsvg with fontconfig fonts (DejaVu Sans) —
// no network, no AI imagery, deterministic output committed to the repo so
// crawlers get the same card on every deploy.
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'public', 'og.png')

// Somnia brand tokens (kept in sync with src/lib/brand.ts + globals.css):
const NIGHT = '#09090b'
const INDIGO = '#6366f1'
const VIOLET = '#8b5cf6'
const FUCHSIA = '#d946ef'
const ZINC_400 = '#a1a1aa'

const WIDTH = 1200
const HEIGHT = 630

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="brand" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="${INDIGO}"/>
      <stop offset="55%" stop-color="${VIOLET}"/>
      <stop offset="100%" stop-color="${FUCHSIA}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.28" r="0.75">
      <stop offset="0%" stop-color="${VIOLET}" stop-opacity="0.34"/>
      <stop offset="100%" stop-color="${VIOLET}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="0.18" cy="0.9" r="0.6">
      <stop offset="0%" stop-color="${INDIGO}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${INDIGO}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="${NIGHT}"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow2)"/>

  <!-- starfield (deterministic positions) -->
  ${Array.from({ length: 90 }, (_, i) => {
    const x = ((i * 719) % 1180) + 10
    const y = ((i * 373) % 610) + 10
    const r = ((i * 97) % 3) * 0.55 + 0.5
    const o = ((i * 53) % 5) * 0.12 + 0.25
    return `<circle cx="${x}" cy="${y}" r="${r.toFixed(2)}" fill="#e4e4e7" opacity="${o.toFixed(2)}"/>`
  }).join('\n  ')}

  <!-- the S mark, scaled up from the app logo -->
  <rect x="92" y="228" width="128" height="128" rx="34" fill="${NIGHT}" stroke="url(#brand)" stroke-width="7"/>
  <path d="M126 268c-4.6-5.9-11.7-8.9-19.8-8.9-11.4 0-19.6 5.9-19.6 14.2 0 7.7 6.4 11.5 17.6 13.8 12.9 2.7 20.5 7.1 20.5 17.7 0 9.4-8.7 16.1-21.3 16.1-9.6 0-17.9-3.6-22.5-9.7"
        fill="none" stroke="url(#brand)" stroke-width="9.4" stroke-linecap="round"
        transform="translate(22, 10) scale(1.42)"/>

  <!-- wordmark + tagline -->
  <text x="256" y="296" font-family="DejaVu Sans" font-size="88" font-weight="bold" fill="#fafafa" letter-spacing="2">Somnia</text>
  <text x="260" y="346" font-family="DejaVu Sans" font-size="30" fill="${ZINC_400}" letter-spacing="1">Dream it. Render it.</text>

  <!-- honest metering footnote, right-aligned -->
  <text x="${WIDTH - 92}" y="${HEIGHT - 64}" font-family="DejaVu Sans" font-size="24" fill="${ZINC_400}" text-anchor="end" letter-spacing="1">prompt-to-clip · keyframes · honest credits</text>
</svg>`

mkdirSync(path.dirname(OUT), { recursive: true })
await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(OUT)
console.log(`wrote ${path.relative(ROOT, OUT)} (${WIDTH}x${HEIGHT})`)
