/**
 * regen_showcase.ts — regenerate the landing marketing media with REAL
 * imagery (z-ai image SDK) + the product's own render recipe.
 *
 * Why: the committed public/showcase clips (and hero.mp4) were produced in a
 * curation run where every SDK keyframe attempt outlived the demo provider's
 * 28s budget, so the branded PLACEHOLDER frames (orange circle + storyboard
 * labels) got rendered into every clip. Real imagery is now confirmed to work
 * in this sandbox (~80s/image), so this script rebuilds the media set:
 *
 *   1. generate keyframes (2 per tile, 3 for the hero) via the SDK,
 *      3-way concurrency, per-image retry, resumable (skips existing files)
 *   2. composite each clip with the SAME recipe as src/lib/video.ts
 *      (Ken Burns alternating zoom via zoompan on a 2x working buffer,
 *      0.5s xfade chain, H.264 yuv420p faststart, 30fps, tier CRF)
 *   3. write 1280x720 posters (and hero-poster.jpg for OG/Twitter)
 *
 * Run: bun scripts/regen_showcase.ts
 */
import { promises as fs } from 'fs'
import { spawn } from 'child_process'
import path from 'path'
import os from 'os'
import ZAI from 'z-ai-web-dev-sdk'

const ROOT = path.resolve(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'public', 'showcase')
const KEY_DIR = path.join(ROOT, 'scripts', 'tmp', 'regen')

const FPS = 30
const XFADE_SEC = 0.5
const MAX_ZOOM = 1.1

const CANVAS = {
  quality: { w: 1344, h: 768, crf: 23 },
  draft: { w: 854, h: 480, crf: 26 },
} as const

type Tier = keyof typeof CANVAS

interface ClipSpec {
  slug: string
  prompt: string
  tier: Tier
  beats: number
  durationSec: number
}

const BEATS = [
  'wide establishing shot that sets the scene',
  'medium shot with the main subject in focus and implied motion',
  'closing shot with tighter framing and atmospheric detail',
] as const

const CLIPS: ClipSpec[] = [
  {
    slug: 'hero',
    prompt:
      'A lighthouse under a swirling aurora borealis on a black basalt coast, glowing waves crashing',
    tier: 'quality',
    beats: 3,
    durationSec: 5,
  },
  {
    slug: 'paper-boat',
    prompt: 'A paper boat sailing a molten river at dusk, embers trailing behind it',
    tier: 'quality',
    beats: 2,
    durationSec: 5,
  },
  {
    slug: 'glass-kite',
    prompt: 'A glass kite drifting through a night market, warm lanterns everywhere',
    tier: 'quality',
    beats: 2,
    durationSec: 5,
  },
  {
    slug: 'rooftop-fox',
    prompt: 'A tiny fox sprinting across rooftop tiles at blue hour',
    tier: 'quality',
    beats: 2,
    durationSec: 5,
  },
  {
    slug: 'origami-crane',
    prompt: 'An origami crane gliding over a still lake at dawn',
    tier: 'draft',
    beats: 2,
    durationSec: 5,
  },
  {
    slug: 'canyon-balloon',
    prompt: 'A hot air balloon rising over misty canyon ridges at sunrise',
    tier: 'draft',
    beats: 2,
    durationSec: 5,
  },
  {
    slug: 'paper-lantern',
    prompt: 'A paper lantern released into a twilight sky, drifting upward',
    tier: 'draft',
    beats: 2,
    durationSec: 5,
  },
  {
    slug: 'bronze-compass',
    prompt: 'A bronze compass spinning on an old sea chart',
    tier: 'draft',
    beats: 2,
    durationSec: 5,
  },
  {
    slug: 'seabird-keeper',
    prompt: 'A lighthouse keeper counting seabirds at golden hour, gentle waves',
    tier: 'draft',
    beats: 2,
    durationSec: 5,
  },
  {
    slug: 'moonlit-gutter',
    prompt: 'A paper boat drifting down a moonlit gutter, cinematic macro shot',
    tier: 'draft',
    beats: 2,
    durationSec: 5,
  },
]

/* ---------------------------------------------------------------- helpers */

function run(cmd: string, args: string[], timeoutMs = 120_000): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    const finish = (ok: boolean) => {
      clearTimeout(timer)
      resolve({ ok: ok && !timedOut, stderr: stderr.slice(-800) })
    }
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString()
    })
    child.on('error', () => finish(false))
    child.on('close', (code) => finish(code === 0))
  })
}

async function existsBig(file: string): Promise<boolean> {
  try {
    const stat = await fs.stat(file)
    return stat.size > 30_000
  } catch {
    return false
  }
}

async function generateKeyframe(
  zai: Awaited<ReturnType<typeof ZAI.create>>,
  spec: ClipSpec,
  beatIndex: number,
  target: string
): Promise<boolean> {
  if (await existsBig(target)) {
    console.log(`  [skip] ${path.basename(target)} already present`)
    return true
  }
  const beat = BEATS[beatIndex % BEATS.length]
  const prompt = `${spec.prompt}. Storyboard keyframe: ${beat}. Cinematic lighting, rich color, high detail.`
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await zai.images.generations.create({
        prompt,
        size: '1344x768',
      })
      const base64 = response?.data?.[0]?.base64
      if (typeof base64 === 'string' && base64.length > 32) {
        await fs.writeFile(target, Buffer.from(base64, 'base64'))
        console.log(`  [gen ] ${path.basename(target)} (${(base64.length / 1024).toFixed(0)}KB b64)`)
        return true
      }
      throw new Error('empty response')
    } catch (error) {
      console.warn(
        `  [warn] ${path.basename(target)} attempt ${attempt} failed: ${(error as Error)?.message ?? error}`
      )
      if (attempt < 2) await new Promise((r) => setTimeout(r, 15_000))
    }
  }
  return false
}

/** Mirrors segmentFilter() from src/lib/video.ts (kenburns motion). */
function segmentFilter(canvas: { w: number; h: number }, segFrames: number, zoomIn: boolean): string {
  const workW = canvas.w * 2
  const workH = canvas.h * 2
  const rate = (MAX_ZOOM - 1) / Math.max(1, segFrames - 1)
  const zoom = zoomIn
    ? `min(1+${rate.toFixed(6)}*on,${MAX_ZOOM})`
    : `max(${MAX_ZOOM}-${rate.toFixed(6)}*on,1.0)`
  const x = 'iw/2-(iw/zoom/2)'
  const y = 'ih/2-(ih/zoom/2)'
  return [
    `scale=${workW}:${workH}:force_original_aspect_ratio=increase`,
    `crop=${workW}:${workH}`,
    `zoompan=z='${zoom}':x='${x}':y='${y}':d=${segFrames}:s=${canvas.w}x${canvas.h}:fps=${FPS}`,
    'format=yuv420p',
    'scale=iw:ih:out_range=tv',
  ].join(',')
}

/** Mirrors renderVideo() from src/lib/video.ts for a list of stills. */
async function renderClip(spec: ClipSpec, keyframes: string[]): Promise<boolean> {
  const canvas = CANVAS[spec.tier]
  const count = keyframes.length
  const segFrames = Math.max(
    2,
    Math.round(((spec.durationSec + (count - 1) * XFADE_SEC) / count) * FPS)
  )
  const segDur = segFrames / FPS
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'regen-render-'))
  try {
    const segmentFiles: string[] = []
    for (let index = 0; index < count; index++) {
      const segFile = path.join(tmpDir, `seg-${index}.mp4`)
      const args = [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-loop', '1', '-i', keyframes[index],
        '-vf', segmentFilter(canvas, segFrames, index % 2 === 0),
        '-frames:v', String(segFrames),
        '-c:v', 'libx264', '-crf', String(canvas.crf), '-preset', 'veryfast', '-an',
        segFile,
      ]
      const r = await run('ffmpeg', args)
      if (!r.ok) {
        console.error(`  [fail] segment ${index}: ${r.stderr}`)
        return false
      }
      segmentFiles.push(segFile)
    }

    const outMp4 = path.join(OUT_DIR, `${spec.slug}.mp4`)
    const part = `${outMp4}.part`
    let finalArgs: string[]
    if (segmentFiles.length === 1) {
      finalArgs = [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-i', segmentFiles[0],
        '-c:v', 'libx264', '-crf', String(canvas.crf), '-preset', 'veryfast',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', '-f', 'mp4',
        part,
      ]
    } else {
      const chain: string[] = []
      let previous = '0:v'
      for (let k = 1; k < segmentFiles.length; k++) {
        const offset = (k * (segDur - XFADE_SEC)).toFixed(4)
        chain.push(`[${previous}][${k}:v]xfade=transition=fade:duration=${XFADE_SEC}:offset=${offset}[v${k}]`)
        previous = `v${k}`
      }
      finalArgs = [
        '-y', '-hide_banner', '-loglevel', 'error',
        ...segmentFiles.flatMap((f) => ['-i', f]),
        '-filter_complex', chain.join(';'),
        '-map', `[${previous}]`,
        '-c:v', 'libx264', '-crf', String(canvas.crf), '-preset', 'veryfast',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', '-f', 'mp4',
        part,
      ]
    }
    const fr = await run('ffmpeg', finalArgs)
    if (!fr.ok) {
      console.error(`  [fail] final composite: ${fr.stderr}`)
      return false
    }
    await fs.rename(part, outMp4)

    // Poster from the first keyframe at 1280x720 (matches OG metadata dims).
    const poster = path.join(OUT_DIR, `${spec.slug === 'hero' ? 'hero-poster' : spec.slug}.jpg`)
    const pr = await run('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', keyframes[0],
      '-vf', 'scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720',
      '-q:v', '3',
      poster,
    ])
    if (!pr.ok) {
      console.error(`  [warn] poster failed: ${pr.stderr}`)
    }
    const size = (await fs.stat(outMp4)).size
    console.log(`  [clip] ${spec.slug}.mp4 (${count} segs, ${(size / 1024).toFixed(0)}KB)`)
    return true
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/* ------------------------------------------------------------------ main */

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true })
  await fs.mkdir(KEY_DIR, { recursive: true })
  const zai = await ZAI.create()

  // Flatten the work list, then generate through a 3-way concurrency pool
  // (observed ~80s/image; bursts beyond 3 concurrent risk rate limiting).
  interface Task {
    spec: ClipSpec
    beatIndex: number
    target: string
  }
  const tasks: Task[] = []
  for (const spec of CLIPS) {
    for (let b = 0; b < spec.beats; b++) {
      tasks.push({
        spec,
        beatIndex: b,
        target: path.join(KEY_DIR, `${spec.slug}-k${b + 1}.png`),
      })
    }
  }
  console.log(`[regen] ${tasks.length} keyframes across ${CLIPS.length} clips`)

  const failures: string[] = []
  let cursor = 0
  async function worker(id: number) {
    while (cursor < tasks.length) {
      const task = tasks[cursor++]
      const ok = await generateKeyframe(zai, task.spec, task.beatIndex, task.target)
      if (!ok) failures.push(path.basename(task.target))
      console.log(`[pool ${id}] ${ok ? 'done' : 'FAILED'} (${cursor}/${tasks.length})`)
    }
  }
  await Promise.all([worker(1), worker(2), worker(3)])

  if (failures.length > 0) {
    console.error(`[regen] ${failures.length} keyframe(s) failed: ${failures.join(', ')}`)
    console.error('[regen] re-run this script to resume (completed files are skipped).')
    process.exitCode = 1
  }

  console.log('[regen] rendering clips with the product render recipe…')
  const renderFailures: string[] = []
  for (const spec of CLIPS) {
    const keyframes: string[] = []
    for (let b = 0; b < spec.beats; b++) {
      const f = path.join(KEY_DIR, `${spec.slug}-k${b + 1}.png`)
      if (await existsBig(f)) keyframes.push(f)
    }
    if (keyframes.length === 0) {
      renderFailures.push(spec.slug)
      continue
    }
    const ok = await renderClip(spec, keyframes)
    if (!ok) renderFailures.push(spec.slug)
  }
  if (renderFailures.length > 0) {
    console.error(`[regen] clip render failures: ${renderFailures.join(', ')}`)
    process.exitCode = 1
  }
  console.log('[regen] complete.')
}

main().catch((error) => {
  console.error('[regen] fatal:', error)
  process.exit(1)
})
