import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { absoluteFromPublic, ensureGeneratedDirWritable, GENERATED_DIR } from '@/lib/frames'
import { resolveFfmpegBin } from '@/lib/runtime'
import type { CameraPresetId } from '@/lib/presets'
import type { AspectRatio, Tier } from '@/lib/pricing'

/**
 * Reelforge video compositor (Phase 2 + Phase 3).
 *
 * Composites an ordered list of still frames into a cinematic MP4 clip with
 * the system ffmpeg binary:
 *   - per-segment Ken Burns motion (slow zoom, alternating in/out) via zoompan
 *   - crossfades between segments via xfade
 *   - H.264 + yuv420p + faststart, 30 fps, CRF 26 (draft) / 23 (quality)
 *
 * Phase 3 additions:
 *   - `motion` presets on renderVideo: virtual camera moves (push in,
 *     pull back, drift left/right) re-render an existing frame list
 *   - `reframeVideo`: scale + centre-crop transform of an existing MP4 onto
 *     a new aspect-ratio canvas (tier-aware resolution)
 *
 * Robustness contract: `renderVideo`/`reframeVideo` NEVER throw. On any
 * failure (ffmpeg missing, filter error, timeout) they log, clean up, and
 * resolve to null so callers can degrade gracefully (never a hard failure).
 *
 * Phase 6: the binary resolves through @/lib/runtime — system ffmpeg when
 * present (sandbox parity), the bundled ffmpeg-static binary on serverless.
 */

const FPS = 30
/** Crossfade overlap between neighbouring segments, in seconds. */
const XFADE_SEC = 0.5
/** Ken Burns zoom ceiling (segment zooms travel between 1.0 and this). */
const MAX_ZOOM = 1.1
/** Virtual camera move zoom ceiling (Phase 3 presets travel between 1.0 and this). */
const CAMERA_MAX_ZOOM = 1.14
/** Constant zoom for the horizontal drift presets (leaves pan headroom). */
const DRIFT_ZOOM = 1.08
/** Total wall-clock budget for one render (hard kill well under job limits). */
const TOTAL_BUDGET_MS = 110_000
/** Ceiling for a single ffmpeg invocation. */
const SINGLE_RUN_CAP_MS = 90_000

const CANVAS: Record<Tier, Record<AspectRatio, { w: number; h: number }>> = {
  quality: {
    '16:9': { w: 1344, h: 768 },
    '9:16': { w: 768, h: 1344 },
    '1:1': { w: 960, h: 960 },
  },
  draft: {
    '16:9': { w: 854, h: 480 },
    '9:16': { w: 480, h: 854 },
    '1:1': { w: 480, h: 480 },
  },
}

const CRF_BY_TIER: Record<Tier, number> = {
  draft: 26,
  quality: 23,
}

export function videoPath(jobId: string): string {
  return `/generated/${jobId}.mp4`
}

interface FfmpegRunResult {
  ok: boolean
  stderrTail: string
  timedOut: boolean
}

function runFfmpeg(args: string[], timeoutMs: number): Promise<FfmpegRunResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(resolveFfmpegBin(), args, { stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (error) {
      resolve({ ok: false, stderrTail: `spawn failed: ${(error as Error)?.message ?? error}`, timedOut: false })
      return
    }

    let stderr = ''
    let timedOut = false
    let settled = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, Math.max(1_000, timeoutMs))

    const finish = (result: FfmpegRunResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    child.on('error', (error) => {
      finish({ ok: false, stderrTail: `process error: ${error.message}`, timedOut })
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      // Keep only the tail — ffmpeg is chatty even at low loglevels on failure.
      stderr = (stderr + chunk.toString()).slice(-2000)
    })

    child.on('close', (code) => {
      finish({ ok: code === 0 && !timedOut, stderrTail: stderr, timedOut })
    })
  })
}

function kenBurnsZoomExpression(segFrames: number, zoomIn: boolean): string {
  // Deterministic per-frame zoom: linear travel between 1.0 and MAX_ZOOM.
  const rate = (MAX_ZOOM - 1) / Math.max(1, segFrames - 1)
  return zoomIn
    ? `min(1+${rate.toFixed(6)}*on,${MAX_ZOOM})`
    : `max(${MAX_ZOOM}-${rate.toFixed(6)}*on,1.0)`
}

/** Phase 3 virtual camera moves: preset ids live in the shared presets module. */
export type CameraPreset = CameraPresetId

/** Motion applied to each segment of a render. */
export type Motion = 'kenburns' | CameraPreset

function cameraZoomExpression(segFrames: number, preset: 'push-in' | 'pull-back'): string {
  // Same deterministic linear travel as Ken Burns, but every segment moves the
  // same direction and the ceiling is the camera preset's wider 1.14 travel.
  const rate = (CAMERA_MAX_ZOOM - 1) / Math.max(1, segFrames - 1)
  return preset === 'push-in'
    ? `min(1+${rate.toFixed(6)}*on,${CAMERA_MAX_ZOOM})`
    : `max(${CAMERA_MAX_ZOOM}-${rate.toFixed(6)}*on,1.0)`
}

function driftXExpression(segFrames: number, workW: number, direction: 'drift-left' | 'drift-right'): string {
  // Horizontal pan across the padded working canvas at constant zoom: the
  // viewport traverses the full zoom-cropped margin over the segment length.
  const panRange = workW - workW / DRIFT_ZOOM
  const rate = panRange / Math.max(1, segFrames - 1)
  return direction === 'drift-right'
    ? `min(${rate.toFixed(6)}*on,${panRange.toFixed(4)})`
    : `max(${panRange.toFixed(4)}-${rate.toFixed(6)}*on,0)`
}

function segmentFilter(
  canvas: { w: number; h: number },
  segFrames: number,
  motion: Motion,
  kenBurnsZoomIn: boolean
): string {
  // 2× working buffer keeps zoompan's integer-pixel stepping sub-pixel at the
  // output scale (classic Ken Burns smoothness trick).
  const workW = canvas.w * 2
  const workH = canvas.h * 2
  let zoom: string
  let x: string
  const y = 'ih/2-(ih/zoom/2)'
  if (motion === 'kenburns') {
    zoom = kenBurnsZoomExpression(segFrames, kenBurnsZoomIn)
    x = 'iw/2-(iw/zoom/2)'
  } else if (motion === 'push-in' || motion === 'pull-back') {
    zoom = cameraZoomExpression(segFrames, motion)
    x = 'iw/2-(iw/zoom/2)'
  } else {
    zoom = `${DRIFT_ZOOM}`
    x = driftXExpression(segFrames, workW, motion)
  }
  return [
    `scale=${workW}:${workH}:force_original_aspect_ratio=increase`,
    `crop=${workW}:${workH}`,
    `zoompan=z='${zoom}':x='${x}':y='${y}':d=${segFrames}:s=${canvas.w}x${canvas.h}:fps=${FPS}`,
    'format=yuv420p',
    // Sources arrive mixed: real image-API keyframes are JPEG bytes flagged
    // full-range (yuvj420p) while placeholder PNGs are unflagged — normalize to
    // limited range so every clip comes out plain yuv420p (identity scale,
    // converts values only when the source was full-range).
    'scale=iw:ih:out_range=tv',
  ].join(',')
}

export interface RenderVideoOptions {
  jobId: string
  tier: Tier
  aspectRatio: AspectRatio
  durationSec: number
  /** Ordered stills (public-relative paths) composing the story. */
  segments: string[]
  /** Segment motion. Default 'kenburns' (alternating Phase 2 look). */
  motion?: Motion
  /** Base file name (without extension) — defaults to the jobId. Phase 3
   * camera variants render to `<jobId>-camera-<preset>`. */
  outputName?: string
}

/**
 * Render the composite clip. Returns the public-relative MP4 path on success,
 * or null when video production had to be skipped (never throws).
 */
export async function renderVideo(options: RenderVideoOptions): Promise<string | null> {
  const { jobId, tier, aspectRatio, durationSec } = options
  const motion: Motion = options.motion ?? 'kenburns'
  const outputName = options.outputName ?? jobId
  const segments = options.segments.filter((s) => typeof s === 'string' && s.length > 0)
  if (segments.length === 0) return null

  const canvas = CANVAS[tier]?.[aspectRatio]
  if (!canvas) return null

  const startedAt = Date.now()
  const remaining = () => TOTAL_BUDGET_MS - (Date.now() - startedAt)

  let tmpDir: string | null = null
  try {
    await ensureGeneratedDirWritable()
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reelforge-render-'))

    const count = segments.length
    // Equal segment lengths so that: sum(L) - (N-1)*XFADE == durationSec.
    const segFrames = Math.max(
      2,
      Math.round(((durationSec + (count - 1) * XFADE_SEC) / count) * FPS)
    )
    const segDur = segFrames / FPS
    const crf = CRF_BY_TIER[tier]

    // 1) One intermediate clip per segment (Ken Burns over a single still).
    const segmentFiles: string[] = []
    for (let index = 0; index < count; index++) {
      if (remaining() < 3_000) throw new Error('render budget exhausted before segments finished')
      const source = absoluteFromPublic(segments[index])
      const segFile = path.join(tmpDir, `seg-${index}.mp4`)
      const args = [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-loop',
        '1',
        '-i',
        source,
        '-vf',
        segmentFilter(canvas, segFrames, motion, index % 2 === 0),
        '-frames:v',
        String(segFrames),
        '-c:v',
        'libx264',
        '-crf',
        String(crf),
        '-preset',
        'veryfast',
        '-an',
        segFile,
      ]
      const run = await runFfmpeg(args, Math.min(SINGLE_RUN_CAP_MS, remaining()))
      if (!run.ok) {
        console.error(
          `[video] segment ${index} failed${run.timedOut ? ' (timeout)' : ''}: ${run.stderrTail.slice(-400)}`
        )
        return null
      }
      segmentFiles.push(segFile)
    }

    // 2) Chain crossfades across the intermediates into the final clip.
    if (remaining() < 3_000) throw new Error('render budget exhausted before final composite')
    const finalAbs = path.join(GENERATED_DIR, `${outputName}.mp4`)
    const partAbs = `${finalAbs}.part`
    let finalArgs: string[]
    if (segmentFiles.length === 1) {
      finalArgs = [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        segmentFiles[0],
        '-c:v',
        'libx264',
        '-crf',
        String(crf),
        '-preset',
        'veryfast',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        '-an',
        '-f',
        'mp4',
        partAbs,
      ]
    } else {
      const chain: string[] = []
      let previous = '0:v'
      for (let k = 1; k < segmentFiles.length; k++) {
        // Offset where fade k starts inside the accumulated timeline:
        // k * (segDur - XFADE) for equal-length segments.
        const offset = (k * (segDur - XFADE_SEC)).toFixed(4)
        const label = `v${k}`
        chain.push(
          `[${previous}][${k}:v]xfade=transition=fade:duration=${XFADE_SEC}:offset=${offset}[${label}]`
        )
        previous = label
      }
      finalArgs = [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        ...segmentFiles.flatMap((file) => ['-i', file]),
        '-filter_complex',
        chain.join(';'),
        '-map',
        `[${previous}]`,
        '-c:v',
        'libx264',
        '-crf',
        String(crf),
        '-preset',
        'veryfast',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        '-an',
        '-f',
        'mp4',
        partAbs,
      ]
    }

    const finalRun = await runFfmpeg(finalArgs, Math.min(SINGLE_RUN_CAP_MS, remaining()))
    if (!finalRun.ok) {
      console.error(
        `[video] final composite failed${finalRun.timedOut ? ' (timeout)' : ''}: ${finalRun.stderrTail.slice(-400)}`
      )
      return null
    }

    // 3) Move into place (same-filesystem rename keeps the swap atomic).
    await fs.rename(partAbs, finalAbs)
    console.log(
      `[video] rendered /generated/${outputName}.mp4 (${count} segments, ${durationSec}s target, ${motion} motion, ${(Date.now() - startedAt) / 1000}s wall)`
    )
    return `/generated/${outputName}.mp4`
  } catch (error) {
    console.error('[video] render skipped:', (error as Error)?.message ?? error)
    return null
  } finally {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

export interface ExtractStyledFramesOptions {
  jobId: string
  /** Public-relative path of the source MP4. */
  sourcePath: string
  /** ffmpeg -vf chain applied while extracting (the style grade). */
  styleFilter: string
  /** Evenly spaced timestamps (seconds) to sample, in order. */
  timestamps: number[]
  /** Public-relative output paths for the styled stills (same length). */
  outputPaths: string[]
}

/**
 * Phase 11 restyle: seek-extract styled stills from an existing MP4. Each
 * frame is one ffmpeg invocation — -ss seek + -frames:v 1 + the style filter
 * — writing a PNG into the generated dir. Returns the paths that were
 * actually written (subset on partial failure), or null when nothing could
 * be extracted. Never throws.
 */
export async function extractStyledFrames(
  options: ExtractStyledFramesOptions
): Promise<string[] | null> {
  const { jobId, styleFilter, timestamps, outputPaths } = options
  if (timestamps.length === 0 || timestamps.length !== outputPaths.length) return null

  const startedAt = Date.now()
  const written: string[] = []
  try {
    await ensureGeneratedDirWritable()
    const source = absoluteFromPublic(options.sourcePath)

    for (let index = 0; index < timestamps.length; index += 1) {
      const stamp = Math.max(0, timestamps[index])
      const targetPublic = outputPaths[index]
      const targetAbs = absoluteFromPublic(targetPublic)
      const partAbs = `${targetAbs}.part`
      const run = await runFfmpeg(
        [
          '-y',
          '-hide_banner',
          '-loglevel',
          'error',
          // Seek before -i: fast keyframe-accurate-enough positioning for stills.
          '-ss',
          stamp.toFixed(3),
          '-i',
          source,
          '-frames:v',
          '1',
          '-vf',
          styleFilter,
          // Explicit encoder + muxer: the .part suffix breaks extension inference.
          '-c:v',
          'png',
          '-f',
          'image2',
          partAbs,
        ],
        Math.min(SINGLE_RUN_CAP_MS, Math.max(5_000, 110_000 - (Date.now() - startedAt)))
      )
      if (run.ok) {
        await fs.rename(partAbs, targetAbs)
        written.push(targetPublic)
      } else {
        console.error(
          `[video] styled frame ${index + 1} failed${run.timedOut ? ' (timeout)' : ''}: ${run.stderrTail.slice(-300)}`
        )
        await fs.rm(partAbs, { force: true }).catch(() => undefined)
      }
    }

    if (written.length === 0) {
      console.error(`[video] restyle extraction produced nothing for job ${jobId}`)
      return null
    }
    console.log(
      `[video] extracted ${written.length}/${timestamps.length} styled frames for job ${jobId} (${((Date.now() - startedAt) / 1000).toFixed(1)}s wall)`
    )
    return written
  } catch (error) {
    console.error('[video] styled extraction skipped:', (error as Error)?.message ?? error)
    return written.length > 0 ? written : null
  }
}


export function reframeVariantPath(jobId: string, aspectRatio: AspectRatio): string {
  // Aspect encoded without the colon so it is filesystem- and URL-safe.
  return `/generated/${jobId}-reframe-${aspectRatio.replace(':', 'x')}.mp4`
}

export function cameraVariantPath(jobId: string, preset: CameraPreset): string {
  return `/generated/${jobId}-camera-${preset}.mp4`
}

export interface ReframeVideoOptions {
  jobId: string
  tier: Tier
  /** Target canvas aspect — resolution comes from the job's tier map. */
  targetAspectRatio: AspectRatio
  /** Public-relative path of the existing MP4 to re-crop. */
  sourcePath: string
}

/**
 * Phase 3 reframe: scale + centre-crop an existing MP4 onto the target
 * aspect's tier-aware canvas, re-encoded H.264 yuv420p faststart 30fps at the
 * tier CRF. Returns the public-relative MP4 path on success, or null (never
 * throws). Frame count/duration of the source are preserved exactly.
 */
export async function reframeVideo(options: ReframeVideoOptions): Promise<string | null> {
  const { jobId, tier, targetAspectRatio } = options
  const canvas = CANVAS[tier]?.[targetAspectRatio]
  if (!canvas) return null

  const startedAt = Date.now()
  let partAbs: string | null = null
  try {
    await ensureGeneratedDirWritable()
    const source = absoluteFromPublic(options.sourcePath)
    const finalPublic = reframeVariantPath(jobId, targetAspectRatio)
    const finalAbs = absoluteFromPublic(finalPublic)
    partAbs = `${finalAbs}.part`

    // cover-fit the source onto the target canvas: scale up so it covers, then
    // centre-crop the overflow. Frame timing passes through untouched.
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      source,
      '-vf',
      `scale=${canvas.w}:${canvas.h}:force_original_aspect_ratio=increase,crop=${canvas.w}:${canvas.h},fps=${FPS},format=yuv420p`,
      '-r',
      String(FPS),
      '-c:v',
      'libx264',
      '-crf',
      String(CRF_BY_TIER[tier]),
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-an',
      '-f',
      'mp4',
      partAbs,
    ]
    const run = await runFfmpeg(args, SINGLE_RUN_CAP_MS)
    if (!run.ok) {
      console.error(
        `[video] reframe failed${run.timedOut ? ' (timeout)' : ''}: ${run.stderrTail.slice(-400)}`
      )
      return null
    }
    await fs.rename(partAbs, finalAbs)
    partAbs = null
    console.log(
      `[video] reframed ${finalPublic} (${canvas.w}x${canvas.h}, ${(Date.now() - startedAt) / 1000}s wall)`
    )
    return finalPublic
  } catch (error) {
    console.error('[video] reframe skipped:', (error as Error)?.message ?? error)
    return null
  } finally {
    if (partAbs) {
      await fs.rm(partAbs, { force: true }).catch(() => undefined)
    }
  }
}
