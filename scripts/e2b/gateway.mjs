// gateway.mjs — Somnia selfhosted render gateway (T15/T16), runs INSIDE an E2B sandbox.
//
// Implements the Somnia self-hosted queue contract byte-for-byte:
//   POST /v1/video/jobs            {model, prompt, resolution, duration_sec,
//                                  aspect_ratio, hdr, loop, start_frame?,
//                                  end_frame?, keyframes}  → 202 {id}
//   GET  /v1/video/jobs/{id}       {status, progress?, error?, video_url?, frames?}
//   POST /v1/image/jobs            {model, prompt, resolution, aspect_ratio,
//                                  start_frame?, keyframes}  → 202 {id}   (T16)
//   GET  /v1/image/jobs/{id}       {status, progress?, error?, image_url?} (T16)
//   GET  /files/{jobId}/{name}     rendered artifacts (unguessable job-scoped ids)
//   GET  /healthz                  liveness + capability truth
//
// Render pipeline (mirrors src/lib/video.ts semantics exactly):
//   imagery  — keyframes: the USER'S pinned timeline, downloaded verbatim;
//              prompt-only jobs: real AI keyframes from api.a0.dev (Replicate-
//              backed cache proxy, no key) with the same storyboard beats the
//              local pipeline uses, generated in PARALLEL
//   composit — ffmpeg Ken Burns (alternating zoom, 2x working buffer,
//              crossfade chain, H.264 yuv420p faststart 30fps, resolution CRF)
//   stills   — T16: one image (pinned frame verbatim, or generated), scaled
//              + cropped to the canvas, PNG — prism's /v1/image/jobs contract
//
// Honesty contract: a job whose imagery cannot be produced FAILS — it never
// returns placeholder art posing as a hosted render. Somnia's failover then
// refunds the customer.
//
// Env: GATEWAY_API_KEY (bearer for /v1/*), PUBLIC_BASE (this gateway's public
//      https origin), APP_ORIGIN (Somnia origin for /generated-relative refs),
//      PORT (default 3000), RENDER_DEADLINE_MS (default 240000).

import http from 'node:http'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const PORT = Number(process.env.PORT || 3000)
const API_KEY = (process.env.GATEWAY_API_KEY || '').trim()
const PUBLIC_BASE = (process.env.PUBLIC_BASE || '').replace(/\/+$/, '')
const APP_ORIGIN = (process.env.APP_ORIGIN || '').replace(/\/+$/, '')
const RENDER_DEADLINE_MS = Number(process.env.RENDER_DEADLINE_MS || 240_000)
const DATA_DIR = '/data'
const IMAGERY_SOURCE = 'a0.dev (Replicate cache)'

const FPS = 30
const XFADE_SEC = 0.5
const MAX_ZOOM = 1.1
const IMAGE_FETCH_TIMEOUT_MS = 30_000
const IMAGE_MIN_BYTES = 800
const SINGLE_RUN_CAP_MS = 120_000

// Mirror of src/lib/video.ts CANVAS (resolution → aspect → pixels).
const CANVAS = {
  '540p': {
    '16:9': { w: 960, h: 540 }, '9:16': { w: 540, h: 960 }, '1:1': { w: 540, h: 540 },
    '4:3': { w: 720, h: 540 }, '3:4': { w: 540, h: 720 }, '21:9': { w: 1260, h: 540 },
    '9:21': { w: 540, h: 1260 },
  },
  '720p': {
    '16:9': { w: 1280, h: 720 }, '9:16': { w: 720, h: 1280 }, '1:1': { w: 720, h: 720 },
    '4:3': { w: 960, h: 720 }, '3:4': { w: 720, h: 960 }, '21:9': { w: 1680, h: 720 },
    '9:21': { w: 720, h: 1680 },
  },
  '1080p': {
    '16:9': { w: 1920, h: 1080 }, '9:16': { w: 1080, h: 1920 }, '1:1': { w: 1080, h: 1080 },
    '4:3': { w: 1440, h: 1080 }, '3:4': { w: 1080, h: 1440 }, '21:9': { w: 2520, h: 1080 },
    '9:21': { w: 1080, h: 2520 },
  },
}
const CRF = { '540p': 28, '720p': 26, '1080p': 23 }

// Mirror of src/lib/pipeline.ts STORYBOARD_BEATS + beatCount.
const STORYBOARD_BEATS = [
  'wide establishing shot that sets the scene',
  'medium shot with the main subject in focus and implied motion',
  'closing shot with tighter framing and atmospheric detail',
  'insert detail beat that deepens the mood',
  'final payoff shot with cinematic closure',
]
const beatCount = (durationSec) => (durationSec >= 10 ? 5 : 3)
// T16 — the still beat mirrors the local prism path's 'still image' beat.
const STILL_BEAT = 'a single striking still image with cinematic lighting and rich detail'

const jobs = new Map()
const stats = { total: 0, succeeded: 0, failed: 0 }
let ffmpegVersion = null
let renderChain = Promise.resolve()

const log = (...a) => console.log(new Date().toISOString(), '[gw]', ...a)
const uid = () => `gw_${crypto.randomBytes(6).toString('hex')}`

function spawnSync2(bin, args) {
  const r = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  r.stdout?.on('data', (c) => (stdout += c.toString()))
  r.stderr?.on('data', (c) => (stderr += c.toString()))
  return new Promise((resolve) => {
    r.on('error', () => resolve({ ok: false, stdout, stderr }))
    r.on('close', (code) => resolve({ ok: code === 0, stdout, stderr }))
  })
}

// ---------------------------------------------------------------- fetch imagery

function imageUrl(prompt, beat, aspect, seed) {
  const text = `${prompt}. Storyboard keyframe: ${beat}. Cinematic lighting, rich color, high detail.`
  return `https://api.a0.dev/assets/image?text=${encodeURIComponent(text)}&aspect=${encodeURIComponent(aspect)}&seed=${seed}`
}

async function fetchBuffer(url, timeoutMs) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const type = res.headers.get('content-type') || ''
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength < IMAGE_MIN_BYTES) throw new Error(`suspiciously small body (${buf.byteLength}B)`)
  if (!type.startsWith('image/')) throw new Error(`non-image content-type ${type}`)
  return buf
}

/** One generated keyframe with one retry (fallback aspect for exotic ratios). */
async function generateKeyframe(prompt, beat, aspect, seed) {
  const attempts = [
    imageUrl(prompt, beat, aspect, seed),
    imageUrl(prompt, beat, aspect.includes(':') && Number(aspect.split(':')[0]) < Number(aspect.split(':')[1]) ? '9:16' : '16:9', seed + 7919),
  ]
  let lastError = null
  for (const url of attempts) {
    try {
      return await fetchBuffer(url, IMAGE_FETCH_TIMEOUT_MS)
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(`keyframe generation failed: ${lastError?.message ?? lastError}`)
}

/** Resolve a Somnia frame reference (absolute URL or app-relative path). */
async function downloadFrameRef(ref) {
  const url = /^https?:\/\//.test(ref) ? ref : `${APP_ORIGIN}${ref.startsWith('/') ? '' : '/'}${ref}`
  return fetchBuffer(url, IMAGE_FETCH_TIMEOUT_MS)
}

// ---------------------------------------------------------------- ffmpeg (mirror video.ts)

function runFfmpeg(args, timeoutMs) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (error) {
      resolve({ ok: false, stderrTail: `spawn failed: ${error?.message ?? error}`, timedOut: false })
      return
    }
    let stderr = ''
    let timedOut = false
    let settled = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, Math.max(1_000, timeoutMs))
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    child.on('error', (error) => finish({ ok: false, stderrTail: `process error: ${error.message}`, timedOut }))
    child.stderr?.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-2000)
    })
    child.on('close', (code) => finish({ ok: code === 0 && !timedOut, stderrTail: stderr, timedOut }))
  })
}

function kenBurnsZoomExpression(segFrames, zoomIn) {
  const rate = (MAX_ZOOM - 1) / Math.max(1, segFrames - 1)
  return zoomIn
    ? `min(1+${rate.toFixed(6)}*on,${MAX_ZOOM})`
    : `max(${MAX_ZOOM}-${rate.toFixed(6)}*on,1.0)`
}

function segmentFilter(canvas, segFrames, zoomIn) {
  const workW = canvas.w * 2
  const workH = canvas.h * 2
  const zoom = kenBurnsZoomExpression(segFrames, zoomIn)
  return [
    `scale=${workW}:${workH}:force_original_aspect_ratio=increase`,
    `crop=${workW}:${workH}`,
    `zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${segFrames}:s=${canvas.w}x${canvas.h}:fps=${FPS}`,
    'format=yuv420p',
    'scale=iw:ih:out_range=tv',
  ].join(',')
}

/** Composite ordered stills → one MP4. Mirrors renderVideo() 1:1. */
async function composite(job, dir, timeline) {
  const canvas = CANVAS[job.resolution]?.[job.aspectRatio]
  if (!canvas) throw new Error(`unsupported canvas ${job.resolution}/${job.aspectRatio}`)
  const count = timeline.length
  const segFrames = Math.max(2, Math.round(((job.durationSec + (count - 1) * XFADE_SEC) / count) * FPS))
  const segDur = segFrames / FPS
  const crf = CRF[job.resolution]

  const segmentFiles = []
  for (let index = 0; index < count; index++) {
    const segFile = path.join(dir, `seg-${index}.mp4`)
    const run = await runFfmpeg(
      [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-loop', '1', '-i', timeline[index].file,
        '-vf', segmentFilter(canvas, segFrames, index % 2 === 0),
        '-frames:v', String(segFrames),
        '-c:v', 'libx264', '-crf', String(crf), '-preset', 'veryfast', '-an',
        segFile,
      ],
      SINGLE_RUN_CAP_MS
    )
    if (!run.ok) {
      throw new Error(`segment ${index} composite failed${run.timedOut ? ' (timeout)' : ''}: ${run.stderrTail.slice(-300)}`)
    }
    segmentFiles.push(segFile)
    job.progress = Math.min(80, 30 + Math.round(((index + 1) / count) * 40))
  }

  const finalFile = path.join(dir, 'out.mp4')
  const partFile = `${finalFile}.part`
  let finalArgs
  if (segmentFiles.length === 1) {
    finalArgs = [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', segmentFiles[0],
      '-c:v', 'libx264', '-crf', String(crf), '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', '-f', 'mp4', partFile,
    ]
  } else {
    const chain = []
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
      '-c:v', 'libx264', '-crf', String(crf), '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', '-f', 'mp4', partFile,
    ]
  }
  const finalRun = await runFfmpeg(finalArgs, SINGLE_RUN_CAP_MS)
  if (!finalRun.ok) {
    throw new Error(`final composite failed${finalRun.timedOut ? ' (timeout)' : ''}: ${finalRun.stderrTail.slice(-300)}`)
  }
  await fsp.rename(partFile, finalFile)
  return finalFile
}

// ---------------------------------------------------------------- render flow

function hashSeed(...parts) {
  return parseInt(crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 8), 16) % 100_000
}

async function renderJob(job) {
  const dir = path.join(DATA_DIR, job.id)
  await fsp.mkdir(dir, { recursive: true })
  job.status = 'running'
  job.progress = 10

  // ---- resolve the ordered timeline ----
  let timeline = []
  if (job.keyframes.length > 0) {
    // The user's own imagery — downloaded verbatim, never regenerated.
    const buffers = await Promise.all(job.keyframes.map((ref) => downloadFrameRef(ref)))
    timeline = buffers.map((buf, i) => ({ buf, name: `src-${i + 1}.img` }))
  } else {
    const count = beatCount(job.durationSec)
    const prompt = job.prompt
    const beats = Array.from({ length: count }, (_, i) => STORYBOARD_BEATS[i % STORYBOARD_BEATS.length])
    const buffers = await Promise.all(
      beats.map((beat, i) => generateKeyframe(prompt, beat, job.aspectRatio, hashSeed(job.id, i)))
    )
    timeline = buffers.map((buf, i) => ({ buf, name: `src-${i + 1}.img` }))
    if (job.startFrame) timeline.unshift({ buf: await downloadFrameRef(job.startFrame), name: 'src-start.img' })
    if (job.endFrame) timeline.push({ buf: await downloadFrameRef(job.endFrame), name: 'src-end.img' })
  }
  if (timeline.length === 0) throw new Error('empty timeline')

  for (const [i, frame] of timeline.entries()) {
    await fsp.writeFile(path.join(dir, frame.name), frame.buf)
    frame.file = path.join(dir, frame.name)
    frame.url = `${PUBLIC_BASE}/files/${job.id}/${frame.name}`
  }
  job.progress = 25

  // ---- composite ----
  await composite(job, dir, timeline)

  job.progress = 90
  job.videoUrl = `${PUBLIC_BASE}/files/${job.id}/out.mp4`
  job.frames = timeline.map((f) => f.url)
  job.status = 'succeeded'
  job.progress = 100
  stats.succeeded += 1
  log(`job ${job.id} succeeded — ${timeline.length} segments, ${job.resolution} ${job.aspectRatio}, ${job.durationSec}s`)
}

/** Serialized render queue (2 vCPU box — one ffmpeg pipeline at a time). */
function serializeRender(job, worker) {
  renderChain = renderChain.then(async () => {
    const startedAt = Date.now()
    job.deadlineAt = Date.now() + RENDER_DEADLINE_MS
    try {
      const timer = new Promise((_, reject) => {
        job.deadlineTimer = setTimeout(
          () => reject(new Error(`render deadline exceeded (${RENDER_DEADLINE_MS}ms)`)),
          RENDER_DEADLINE_MS
        )
      })
      await Promise.race([worker(job), timer])
      clearTimeout(job.deadlineTimer)
    } catch (error) {
      clearTimeout(job.deadlineTimer)
      job.status = 'failed'
      job.error = error?.message ?? String(error)
      stats.failed += 1
      log(`job ${job.id} FAILED after ${((Date.now() - startedAt) / 1000).toFixed(1)}s: ${job.error}`)
    }
  })
  return renderChain
}

function enqueueRender(job) {
  return serializeRender(job, renderJob)
}

// ---------------------------------------------------------------- still renders (T16)

/** One prism still: pinned frame verbatim, or generated imagery — canvas-sized PNG. */
async function renderStillJob(job) {
  const dir = path.join(DATA_DIR, job.id)
  await fsp.mkdir(dir, { recursive: true })
  job.status = 'running'
  job.progress = 15

  let buf
  if (job.keyframes.length > 0) {
    // The user's own imagery — verbatim, never regenerated.
    buf = await downloadFrameRef(job.keyframes[0])
  } else if (job.startFrame) {
    buf = await downloadFrameRef(job.startFrame)
  } else {
    buf = await generateKeyframe(job.prompt, STILL_BEAT, job.aspectRatio, hashSeed(job.id, 'still'))
  }
  const src = path.join(dir, 'src.img')
  await fsp.writeFile(src, buf)
  job.progress = 55

  const canvas = CANVAS[job.resolution]?.[job.aspectRatio]
  if (!canvas) throw new Error(`unsupported canvas ${job.resolution}/${job.aspectRatio}`)
  const out = path.join(dir, 'still.png')
  const run = await runFfmpeg(
    [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', src,
      '-vf', `scale=${canvas.w}:${canvas.h}:force_original_aspect_ratio=increase,crop=${canvas.w}:${canvas.h}`,
      '-frames:v', '1',
      out,
    ],
    SINGLE_RUN_CAP_MS
  )
  if (!run.ok) {
    throw new Error(`still composite failed${run.timedOut ? ' (timeout)' : ''}: ${run.stderrTail.slice(-300)}`)
  }

  job.progress = 95
  job.imageUrl = `${PUBLIC_BASE}/files/${job.id}/still.png`
  job.status = 'succeeded'
  job.progress = 100
  stats.succeeded += 1
  log(`still job ${job.id} succeeded — ${job.resolution} ${job.aspectRatio}${job.keyframes.length ? ' (pinned frame)' : ' (generated)'}`)
}

/** Stills ride the same serialized chain — one ffmpeg at a time. */
function enqueueStill(job) {
  return serializeRender(job, renderStillJob)
}

// ---------------------------------------------------------------- http surface

const MIME = { '.mp4': 'video/mp4', '.webp': 'image/webp', '.png': 'image/png', '.img': 'application/octet-stream' }

function authorized(req) {
  if (!API_KEY) return true
  return req.headers.authorization === `Bearer ${API_KEY}`
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function serveFile(req, res, jobId, name) {
  if (!/^\w[\w.-]*$/.test(name) || !/^[\w-]+$/.test(jobId)) {
    res.writeHead(400).end('bad request')
    return
  }
  const file = path.join(DATA_DIR, jobId, name)
  fsp.stat(file).then((st) => {
    const type = MIME[path.extname(name)] || 'application/octet-stream'
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '')
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'content-type': type, 'content-length': String(st.size), 'accept-ranges': 'bytes' })
      res.end()
      return
    }
    if (range && req.method === 'GET') {
      const start = range[1] ? Number(range[1]) : 0
      const end = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1
      if (start <= end && start < st.size) {
        res.writeHead(206, {
          'content-type': type,
          'content-length': String(end - start + 1),
          'content-range': `bytes ${start}-${end}/${st.size}`,
          'accept-ranges': 'bytes',
        })
        // NOTE: createReadStream lives on the callback fs API — fs/promises
        // has no createReadStream (calling the nonexistent fsp method threw
        // inside this then, tripping the 404 catch AFTER the 200 headers were
        // already sent — corrupting every /files response with 0 body bytes).
        const stream = createReadStream(file, { start, end })
        stream.on('error', () => res.destroy())
        stream.pipe(res)
        return
      }
    }
    res.writeHead(200, { 'content-type': type, 'content-length': String(st.size), 'accept-ranges': 'bytes' })
    const stream = createReadStream(file)
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  }).catch(() => {
    if (!res.headersSent) res.writeHead(404).end('not found')
    else res.destroy()
  })
}

const server = http.createServer((req, res) => {
  const reqTag = `${req.method} ${req.url?.split('?')[0]}`
  log(`→ ${reqTag} (keep-alive=${req.headers.connection !== 'close'})`)
  const origWriteHead = res.writeHead.bind(res)
  res.writeHead = (...writeArgs) => {
    if (res.headersSent) {
      log(`!! double writeHead on ${reqTag} — suppressed\n${new Error('trace').stack}`)
      return res
    }
    log(`← ${reqTag} → ${writeArgs[0]}`)
    return origWriteHead(...writeArgs)
  }
  void (async () => {
    const url = (req.url || '/').split('?')[0]
    const method = req.method || 'GET'

    if (method === 'GET' && url === '/healthz') {
      // Connection: close — the E2B edge mishandles pooled keep-alive POSTs
      // after a GET on the same client connection; one connection per request
      // sidesteps it entirely at negligible cost for this traffic volume.
      res.setHeader('connection', 'close')
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        ok: true,
        uptimeSec: Math.round(process.uptime()),
        imagery: IMAGERY_SOURCE,
        images: true, // T16 — serves the /v1/image/jobs still contract
        appOrigin: APP_ORIGIN || null,
        publicBase: PUBLIC_BASE || null,
        renderDeadlineMs: RENDER_DEADLINE_MS,
        authRequired: Boolean(API_KEY),
        ffmpeg: ffmpegVersion,
        jobs: { ...stats, active: [...jobs.values()].filter((j) => j.status === 'running' || j.status === 'queued').length },
      }))
      return
    }

    if (method === 'GET' && url.startsWith('/files/')) {
      const [, , jobId, name] = url.split('/')
      serveFile(req, res, jobId, name)
      return
    }

    if (url.startsWith('/v1/')) {
      res.setHeader('connection', 'close')
      if (!authorized(req)) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'unauthorized' }))
        return
      }
      const submitMatch = method === 'POST' && url === '/v1/video/jobs'
      const statusMatch = method === 'GET' && /^\/v1\/video\/jobs\/[\w-]+$/.test(url)
      const imageSubmitMatch = method === 'POST' && url === '/v1/image/jobs'
      const imageStatusMatch = method === 'GET' && /^\/v1\/image\/jobs\/[\w-]+$/.test(url)
      if (submitMatch) {
        const body = JSON.parse((await readBody(req)) || '{}')
        const job = {
          id: uid(),
          model: String(body.model || ''),
          prompt: String(body.prompt || '').slice(0, 2000),
          resolution: String(body.resolution || '540p'),
          aspectRatio: String(body.aspect_ratio || '16:9'),
          durationSec: Number(body.duration_sec) || 5,
          hdr: body.hdr === true,
          loop: body.loop === true,
          startFrame: typeof body.start_frame === 'string' && body.start_frame ? body.start_frame : null,
          endFrame: typeof body.end_frame === 'string' && body.end_frame ? body.end_frame : null,
          keyframes: Array.isArray(body.keyframes)
            ? body.keyframes.filter((k) => typeof k === 'string' && k.length > 0).slice(0, 16)
            : [],
          status: 'queued',
          progress: 0,
          error: null,
          videoUrl: null,
          frames: [],
          createdAt: new Date().toISOString(),
        }
        if (job.prompt.length < 3) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'prompt must be at least 3 characters' }))
          return
        }
        jobs.set(job.id, job)
        stats.total += 1
        enqueueRender(job)
        log(`job ${job.id} accepted — ${job.keyframes.length ? `pinned timeline (${job.keyframes.length} frames)` : `prompt-only (${beatCount(job.durationSec)} beats)`}`)
        res.writeHead(202, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ id: job.id }))
        return
      }
      if (statusMatch) {
        const id = url.split('/').pop()
        const job = jobs.get(id)
        if (!job) {
          res.writeHead(404, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'no such job' }))
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          status: job.status,
          progress: job.progress,
          error: job.error,
          video_url: job.status === 'succeeded' ? job.videoUrl : undefined,
          frames: job.status === 'succeeded' ? job.frames : undefined,
        }))
        return
      }
      if (imageSubmitMatch) {
        const body = JSON.parse((await readBody(req)) || '{}')
        const job = {
          id: uid(),
          model: String(body.model || ''),
          prompt: String(body.prompt || '').slice(0, 2000),
          resolution: String(body.resolution || '540p'),
          aspectRatio: String(body.aspect_ratio || '16:9'),
          startFrame: typeof body.start_frame === 'string' && body.start_frame ? body.start_frame : null,
          keyframes: Array.isArray(body.keyframes)
            ? body.keyframes.filter((k) => typeof k === 'string' && k.length > 0).slice(0, 16)
            : [],
          status: 'queued',
          progress: 0,
          error: null,
          imageUrl: null,
          createdAt: new Date().toISOString(),
        }
        if (job.prompt.length < 3) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'prompt must be at least 3 characters' }))
          return
        }
        jobs.set(job.id, job)
        stats.total += 1
        enqueueStill(job)
        log(`still job ${job.id} accepted — ${job.keyframes.length ? 'pinned frame' : 'generated'} ${job.resolution} ${job.aspectRatio}`)
        res.writeHead(202, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ id: job.id }))
        return
      }
      if (imageStatusMatch) {
        const id = url.split('/').pop()
        const job = jobs.get(id)
        if (!job) {
          res.writeHead(404, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'no such job' }))
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          status: job.status,
          progress: job.progress,
          error: job.error,
          image_url: job.status === 'succeeded' ? job.imageUrl : undefined,
        }))
        return
      }
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }

    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  })().catch((error) => {
    log('request error:', error?.message ?? error)
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'internal error' }))
  })
})

// ---------------------------------------------------------------- boot

await fsp.mkdir(DATA_DIR, { recursive: true })
const probe = await spawnSync2('ffmpeg', ['-version'])
if (probe.ok) {
  const first = (probe.stdout || '').split('\n')[0] || ''
  ffmpegVersion = /ffmpeg version (\S+)/i.exec(first)?.[1] || 'ffmpeg'
} else {
  ffmpegVersion = null
}
log(`ffmpeg probe: ok=${probe.ok} version=${ffmpegVersion} err=${(probe.stderr || '').slice(0, 120)}`)
server.listen(PORT, () => {
  log(`somnia render gateway up on :${PORT}`)
  log(`public=${PUBLIC_BASE} appOrigin=${APP_ORIGIN} deadline=${RENDER_DEADLINE_MS}ms auth=${Boolean(API_KEY)} ffmpeg=${ffmpegVersion}`)
})
process.on('unhandledRejection', (error) => log('unhandledRejection:', error?.message ?? error))
