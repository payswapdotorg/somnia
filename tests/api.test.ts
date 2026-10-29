// tests/api.test.ts — Somnia HTTP surface (T3).
//
// Exercises the dispatcher directly with standard Request objects (no Next
// server needed): auth (session cookie + sk_somnia Bearer keys), per-user
// credits, the generation endpoints, transforms, boards, likes, the ideas
// feed, agent runs and the public share surfaces. Domain fixtures that need
// a completed job use engine helpers directly (the render loop is a later
// tier — the API contract is what these specs pin).
import { describe, it, expect } from 'vitest'
import { dispatchSomnia } from '@/lib/somnia-api'
import { db } from '@/lib/db'
import { markJobCompleted } from '@/lib/engine'

const BASE = 'http://localhost/api'

// 1x1 red pixel PNG — valid for the frame pipeline.
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

let emailSeq = 0
const nextEmail = () => `user${++emailSeq}@somnia.test`

interface CallOpts {
  body?: unknown
  cookie?: string
  bearer?: string
}

async function call(method: string, path: string, opts: CallOpts = {}) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.cookie) headers['cookie'] = `somnia_session=${opts.cookie}`
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`
  const segments = path.split('/').filter(Boolean)
  const res = await dispatchSomnia(
    new Request(`${BASE}/${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
    segments
  )
  const isJson = (res.headers.get('content-type') ?? '').includes('json')
  const body = isJson ? await res.json().catch(() => null) : null
  return {
    res,
    status: res.status,
    body: body as any,
    setCookie: res.headers.get('set-cookie'),
  }
}

async function newUser(email = nextEmail()) {
  const { body, setCookie } = await call('POST', 'auth/signup', {
    body: { email, password: 'password123', name: 'Test User' },
  })
  expect(body?.user?.id).toBeTruthy()
  const token = /somnia_session=([^;]+)/.exec(setCookie ?? '')?.[1]
  expect(token).toBeTruthy()
  return { id: body.user.id as string, email, token: token as string }
}

/** Completed video job fixture (render loop is a later tier). */
async function completedVideoJob(userId: string, token: string) {
  const { body } = await call('POST', 'generate', {
    body: { prompt: 'a lantern drifting over still water', idempotencyKey: `job-${userId}-${Math.random()}` },
    cookie: token,
  })
  await markJobCompleted(body.job.id, { videoPath: `/generated/${body.job.id}.mp4` })
  return body.job as { id: string; prompt: string; creditsCharged: number }
}

async function balanceOf(token: string): Promise<number> {
  const { body } = await call('GET', 'credits', { cookie: token })
  return body.balance as number
}

// ------------------------------------------------------------------- auth

describe('auth', () => {
  it('signup creates a trial account, grants 1000 credits, and sets a session cookie', async () => {
    const email = nextEmail()
    const { status, body, setCookie } = await call('POST', 'auth/signup', {
      body: { email, password: 'password123' },
    })
    expect(status).toBe(201)
    expect(body.user.email).toBe(email)
    expect(body.user.plan).toBe('trial')
    expect(body.user.credits).toBe(1000)
    expect(setCookie).toContain('somnia_session=')

    const me = await call('GET', 'auth/me', { cookie: extractToken(setCookie!) })
    expect(me.status).toBe(200)
    expect(me.body.user.id).toBe(body.user.id)
  })

  it('signup derives the name from the email when absent', async () => {
    const email = nextEmail()
    const { body } = await call('POST', 'auth/signup', {
      body: { email, password: 'password123' },
    })
    expect(body.user.name).toBe(email.split('@')[0])
  })

  it('rejects duplicate email with 409', async () => {
    const email = nextEmail()
    await call('POST', 'auth/signup', { body: { email, password: 'password123' } })
    const dup = await call('POST', 'auth/signup', { body: { email, password: 'password456' } })
    expect(dup.status).toBe(409)
  })

  it('rejects invalid email and short password with 400', async () => {
    const badEmail = await call('POST', 'auth/signup', {
      body: { email: 'not-an-email', password: 'password123' },
    })
    expect(badEmail.status).toBe(400)

    const shortPw = await call('POST', 'auth/signup', {
      body: { email: nextEmail(), password: 'short' },
    })
    expect(shortPw.status).toBe(400)
  })

  it('login returns a working session; wrong password is 401', async () => {
    const email = nextEmail()
    await call('POST', 'auth/signup', { body: { email, password: 'password123' } })

    const bad = await call('POST', 'auth/login', { body: { email, password: 'wrongpass99' } })
    expect(bad.status).toBe(401)

    const ok = await call('POST', 'auth/login', { body: { email, password: 'password123' } })
    expect(ok.status).toBe(200)
    const token = extractToken(ok.setCookie!)
    expect(token).toBeTruthy()
    const me = await call('GET', 'auth/me', { cookie: token })
    expect(me.status).toBe(200)
    expect(me.body.user.email).toBe(email)
  })

  it('logout destroys the session server-side and clears the cookie', async () => {
    const { token } = await newUser()
    const out = await call('POST', 'auth/logout', { cookie: token })
    expect(out.status).toBe(200)
    expect(out.setCookie).toContain('somnia_session=;')

    const me = await call('GET', 'auth/me', { cookie: token })
    expect(me.status).toBe(401)
  })

  it('auth/me without a session is 401', async () => {
    const me = await call('GET', 'auth/me')
    expect(me.status).toBe(401)
  })

  it('Google OAuth surface reports not-configured without env credentials', async () => {
    const res = await call('GET', 'auth/google')
    expect(res.status).toBe(501)
    expect(res.body.error).toBe('oauth_not_configured')
  })
})

function extractToken(setCookie: string): string {
  const token = /somnia_session=([^;]+)/.exec(setCookie)?.[1]
  return token as string
}

// ------------------------------------------------------------------ plans

describe('plans', () => {
  it('exposes the public plan catalogue without auth', async () => {
    const { status, body } = await call('GET', 'plans')
    expect(status).toBe(200)
    const ids = body.plans.map((p: { id: string }) => p.id)
    expect(ids).toEqual(['trial', 'spark', 'studio', 'infinite'])
    expect(body.plans[1].priceUsd).toBe(30)
    expect(body.plans[3].monthlyCredits).toBe(150000)
  })
})

// ---------------------------------------------------------------- credits

describe('credits', () => {
  it('returns the balance, plan and ledger tail for the session user', async () => {
    const { token } = await newUser()
    const { status, body } = await call('GET', 'credits', { cookie: token })
    expect(status).toBe(200)
    expect(body.balance).toBe(1000)
    expect(body.plan).toBe('trial')
    expect(
      body.transactions.some((t: { amount: number; kind: string }) => t.amount === 1000 && t.kind === 'signup')
    ).toBe(true)
  })

  it('requires auth', async () => {
    const { status } = await call('GET', 'credits')
    expect(status).toBe(401)
  })

  it('isolates balances per user', async () => {
    const a = await newUser()
    const b = await newUser()
    await call('POST', 'generate', {
      body: { prompt: 'a single wave at dawn' },
      cookie: a.token,
    })
    expect(await balanceOf(a.token)).toBe(900)
    expect(await balanceOf(b.token)).toBe(1000)
  })
})

// --------------------------------------------------------------- generate

describe('generate (video)', () => {
  it('charges the pulse-3 5s 720p base rate and queues the job', async () => {
    const { token } = await newUser()
    const { status, body } = await call('POST', 'generate', {
      body: { prompt: 'aurora over a black lake' },
      cookie: token,
    })
    expect(status).toBe(201)
    expect(body.job.status).toBe('queued')
    expect(body.job.model).toBe('pulse-3')
    expect(body.job.resolution).toBe('720p')
    expect(body.job.durationSec).toBe(5)
    expect(body.job.creditsCharged).toBe(100) // pulse-3 5s 720p base
    expect(await balanceOf(token)).toBe(900)
  })

  it('prices 10s HDR at 3x duration x 2x hdr; loop stays free', async () => {
    const { token } = await newUser()
    const { body } = await call('POST', 'generate', {
      body: {
        prompt: 'neon rain on chrome streets',
        model: 'pulse-flash',
        resolution: '1080p',
        durationSec: 10,
        hdr: true,
        loop: true,
        aspectRatio: '9:16',
      },
      cookie: token,
    })
    expect(body.job.creditsCharged).toBe(960) // 160 * 3 * 2
    expect(body.job.hdr).toBe(true)
    expect(body.job.loop).toBe(true)
    expect(body.job.aspectRatio).toBe('9:16')
    expect(await balanceOf(token)).toBe(40)
  })

  it('persists an ordered keyframe timeline (first/last become start/end)', async () => {
    const { token } = await newUser()
    const { body } = await call('POST', 'generate', {
      body: {
        prompt: 'paper boat journey down a stream',
        keyframes: [
          { dataUrl: PNG_1PX, name: 'f1.png' },
          { dataUrl: PNG_1PX, name: 'f2.png' },
          { dataUrl: PNG_1PX, name: 'f3.png' },
        ],
      },
      cookie: token,
    })
    expect(body.job.keyframes).toHaveLength(3)
    expect(body.job.keyframes.map((k: { order: number }) => k.order)).toEqual([1, 2, 3])
    expect(body.job.startFramePath).toBeTruthy()
    expect(body.job.endFramePath).toBeTruthy()

    // stored frames stream back through the public media route
    const name = (body.job.startFramePath as string).split('/').pop()
    const media = await call('GET', `media/${name}`)
    expect(media.status).toBe(200)
    expect(media.res.headers.get('content-type')).toContain('image/')
  })

  it('rejects unknown model, bad duration and short prompts with 400', async () => {
    const { token } = await newUser()
    const badModel = await call('POST', 'generate', {
      body: { prompt: 'valid prompt here', model: 'pulse-99' },
      cookie: token,
    })
    expect(badModel.status).toBe(400)

    const badDuration = await call('POST', 'generate', {
      body: { prompt: 'valid prompt here', durationSec: 7 },
      cookie: token,
    })
    expect(badDuration.status).toBe(400)

    const shortPrompt = await call('POST', 'generate', {
      body: { prompt: 'ab' },
      cookie: token,
    })
    expect(shortPrompt.status).toBe(400)
  })

  it('flags moderated prompts without charging', async () => {
    const { token } = await newUser()
    const { status, body } = await call('POST', 'generate', {
      body: { prompt: 'gore violence explicit bloodbath' },
      cookie: token,
    })
    expect(status).toBe(201)
    expect(body.job.status).toBe('moderated')
    expect(body.job.creditsCharged).toBe(0)
    expect(await balanceOf(token)).toBe(1000)
  })

  it('replays idempotent requests without a second charge', async () => {
    const { token } = await newUser()
    const key = `idem-${Math.random()}`
    const first = await call('POST', 'generate', {
      body: { prompt: 'frost creeping over glass', idempotencyKey: key },
      cookie: token,
    })
    const second = await call('POST', 'generate', {
      body: { prompt: 'frost creeping over glass', idempotencyKey: key },
      cookie: token,
    })
    expect(second.body.job.id).toBe(first.body.job.id)
    expect(await balanceOf(token)).toBe(900)
  })

  it('requires auth', async () => {
    const { status } = await call('POST', 'generate', { body: { prompt: 'no auth here' } })
    expect(status).toBe(401)
  })

  it('answers 402 when the balance cannot cover the render', async () => {
    const { token, id } = await newUser()
    await db.user.update({ where: { id }, data: { credits: 10 } })
    const { status, body } = await call('POST', 'generate', {
      body: { prompt: 'expensive dreams', resolution: '1080p' },
      cookie: token,
    })
    expect(status).toBe(402)
    expect(body.error).toBe('insufficient_credits')
  })
})

describe('generate (image)', () => {
  it('creates a prism still job at the flat image rate', async () => {
    const { token } = await newUser()
    const { status, body } = await call('POST', 'image', {
      body: { prompt: 'a still of ember orchids' },
      cookie: token,
    })
    expect(status).toBe(201)
    expect(body.job.kind).toBe('image')
    expect(body.job.model).toBe('prism')
    expect(body.job.durationSec).toBe(0)
    expect(body.job.creditsCharged).toBe(20)
  })
})

// ------------------------------------------------------------------- jobs

describe('jobs', () => {
  it('lists only the session user’s jobs with timeline and assets', async () => {
    const a = await newUser()
    const b = await newUser()
    await call('POST', 'generate', { body: { prompt: 'alpha clip' }, cookie: a.token })
    await call('POST', 'generate', { body: { prompt: 'beta clip' }, cookie: a.token })
    await call('POST', 'generate', { body: { prompt: 'b clip' }, cookie: b.token })

    const list = await call('GET', 'jobs', { cookie: a.token })
    expect(list.status).toBe(200)
    expect(list.body.jobs).toHaveLength(2)
    expect(list.body.jobs.every((j: { prompt: string }) => j.prompt.includes('clip'))).toBe(true)
    expect(list.body.jobs[0].keyframes).toEqual([])

    const detail = await call('GET', `jobs/${list.body.jobs[0].id}`, { cookie: a.token })
    expect(detail.status).toBe(200)
    expect(detail.body.job.id).toBe(list.body.jobs[0].id)
    expect(Array.isArray(detail.body.job.assets)).toBe(true)
  })

  it('hides other users’ jobs (404) and unknown ids (404)', async () => {
    const a = await newUser()
    const b = await newUser()
    const { body } = await call('POST', 'generate', {
      body: { prompt: 'secret clip' },
      cookie: a.token,
    })
    const cross = await call('GET', `jobs/${body.job.id}`, { cookie: b.token })
    expect(cross.status).toBe(404)

    const unknown = await call('GET', 'jobs/does-not-exist', { cookie: a.token })
    expect(unknown.status).toBe(404)
  })
})

// ------------------------------------------------------------- transforms

describe('transforms', () => {
  it('extend seeds a 5s continuation from a completed clip', async () => {
    const { token } = await newUser()
    const job = await completedVideoJob(
      (await call('GET', 'auth/me', { cookie: token })).body.user.id,
      token
    )
    const { status, body } = await call('POST', `jobs/${job.id}/extend`, { cookie: token })
    expect(status).toBe(201)
    expect(body.job.mode).toBe('extend')
    expect(body.job.sourceJobId).toBe(job.id)
    expect(body.job.durationSec).toBe(5)
    expect(body.job.creditsCharged).toBe(100) // extend = 5s base rate
  })

  it('extend on a non-completed job is 409', async () => {
    const { token } = await newUser()
    const { body } = await call('POST', 'generate', {
      body: { prompt: 'still running clip' },
      cookie: token,
    })
    const res = await call('POST', `jobs/${body.job.id}/extend`, { cookie: token })
    expect(res.status).toBe(409)
  })

  it('modify creates a video-to-video child job at 5x', async () => {
    const { token } = await newUser()
    const me = await call('GET', 'auth/me', { cookie: token })
    const job = await completedVideoJob(me.body.user.id, token)
    const { status, body } = await call('POST', `jobs/${job.id}/modify`, {
      body: { instruction: 'make it snow, dreamlike soft light' },
      cookie: token,
    })
    expect(status).toBe(201)
    expect(body.job.mode).toBe('modify')
    expect(body.job.sourceJobId).toBe(job.id)
    expect(body.job.creditsCharged).toBe(500) // modify = 5x base
  })

  it('reframe is idempotent per aspect and charges once', async () => {
    const { token } = await newUser()
    const me = await call('GET', 'auth/me', { cookie: token })
    const job = await completedVideoJob(me.body.user.id, token)
    const before = await balanceOf(token)

    const first = await call('POST', `jobs/${job.id}/reframe`, {
      body: { aspect: '9:16' },
      cookie: token,
    })
    expect(first.status).toBe(200)
    expect(first.body.asset.kind).toBe('reframe')
    expect(first.body.asset.variantKey).toBe('reframe-9:16')
    expect(await balanceOf(token)).toBe(before - 10)

    const second = await call('POST', `jobs/${job.id}/reframe`, {
      body: { aspect: '9:16' },
      cookie: token,
    })
    expect(second.body.asset.id).toBe(first.body.asset.id)
    expect(await balanceOf(token)).toBe(before - 10)
  })

  it('upscale to 4K is a flat 200 and idempotent', async () => {
    const { token } = await newUser()
    const me = await call('GET', 'auth/me', { cookie: token })
    const job = await completedVideoJob(me.body.user.id, token)
    const before = await balanceOf(token)

    const first = await call('POST', `jobs/${job.id}/upscale`, { cookie: token })
    expect(first.status).toBe(200)
    expect(first.body.asset.kind).toBe('upscale')
    expect(first.body.asset.variantKey).toBe('upscale-4k')
    expect(await balanceOf(token)).toBe(before - 200)

    const second = await call('POST', `jobs/${job.id}/upscale`, { cookie: token })
    expect(second.body.asset.id).toBe(first.body.asset.id)
    expect(await balanceOf(token)).toBe(before - 200)
  })
})

// ------------------------------------------------------------------ share

describe('share + ideas feed', () => {
  it('mints an unlisted token, serves the public payload, and revokes', async () => {
    const owner = await newUser()
    const me = await call('GET', 'auth/me', { cookie: owner.token })
    const job = await completedVideoJob(me.body.user.id, owner.token)

    const shared = await call('POST', `jobs/${job.id}/share`, { cookie: owner.token })
    expect(shared.status).toBe(201)
    const token = shared.body.shareToken as string
    expect(token).toMatch(/^[0-9a-f]{32}$/)

    const publicView = await call('GET', `jobs/shared/${token}`)
    expect(publicView.status).toBe(200)
    expect(publicView.body.job.prompt).toBe(job.prompt)
    expect(publicView.body.author.name).toBeTruthy()
    expect(publicView.body.likeCount).toBe(0)

    const revoke = await call('DELETE', `jobs/${job.id}/share`, { cookie: owner.token })
    expect(revoke.status).toBe(200)
    const gone = await call('GET', `jobs/shared/${token}`)
    expect(gone.status).toBe(404)
  })

  it('refuses to share non-completed jobs with 409', async () => {
    const { token } = await newUser()
    const { body } = await call('POST', 'generate', {
      body: { prompt: 'unfinished business' },
      cookie: token,
    })
    const res = await call('POST', `jobs/${body.job.id}/share`, { cookie: token })
    expect(res.status).toBe(409)
  })

  it('likes ride the feed: like → visible → unlike', async () => {
    const owner = await newUser()
    const viewer = await newUser()
    const me = await call('GET', 'auth/me', { cookie: owner.token })
    const job = await completedVideoJob(me.body.user.id, owner.token)
    await call('POST', `jobs/${job.id}/share`, { cookie: owner.token })

    const like = await call('POST', `jobs/${job.id}/like`, { cookie: viewer.token })
    expect(like.status).toBe(200)
    expect(like.body).toEqual({ liked: true, count: 1 })

    const feedViewer = await call('GET', 'ideas', { cookie: viewer.token })
    expect(feedViewer.status).toBe(200)
    const item = feedViewer.body.items.find((i: { id: string }) => i.id === job.id)
    expect(item.likeCount).toBe(1)
    expect(item.likedByMe).toBe(true)

    const feedAnon = await call('GET', 'ideas')
    expect(feedAnon.status).toBe(200)
    const anonItem = feedAnon.body.items.find((i: { id: string }) => i.id === job.id)
    expect(anonItem.likedByMe).toBe(false)

    const unlike = await call('DELETE', `jobs/${job.id}/like`, { cookie: viewer.token })
    expect(unlike.body).toEqual({ liked: false, count: 0 })
  })
})

// ------------------------------------------------------------------ remix

describe('remix', () => {
  it('returns a free prefill from any completed clip', async () => {
    const { token } = await newUser()
    const me = await call('GET', 'auth/me', { cookie: token })
    const job = await completedVideoJob(me.body.user.id, token)
    const before = await balanceOf(token)

    const { status, body } = await call('POST', `jobs/${job.id}/remix`, { cookie: token })
    expect(status).toBe(200)
    expect(body.prompt).toBe(job.prompt)
    expect(body.model).toBe('pulse-3')
    expect(await balanceOf(token)).toBe(before) // remix itself is always free
  })
})

// ----------------------------------------------------------------- boards

describe('boards', () => {
  it('creates, lists, shares and deletes boards', async () => {
    const { token } = await newUser()
    const created = await call('POST', 'boards', {
      body: { name: 'Night studies', description: 'nocturnal experiments' },
      cookie: token,
    })
    expect(created.status).toBe(201)
    expect(created.body.board.name).toBe('Night studies')

    const list = await call('GET', 'boards', { cookie: token })
    expect(list.status).toBe(200)
    expect(list.body.boards).toHaveLength(1)
    expect(list.body.boards[0].jobCount).toBe(0)

    const shared = await call('POST', `boards/${created.body.board.id}/share`, { cookie: token })
    expect(shared.status).toBe(201)
    const publicView = await call('GET', `boards/shared/${shared.body.shareToken}`)
    expect(publicView.status).toBe(200)
    expect(publicView.body.board.name).toBe('Night studies')

    const removed = await call('DELETE', `boards/${created.body.board.id}`, { cookie: token })
    expect(removed.status).toBe(200)
    const after = await call('GET', 'boards', { cookie: token })
    expect(after.body.boards).toHaveLength(0)
  })

  it('rejects empty names with 400', async () => {
    const { token } = await newUser()
    const res = await call('POST', 'boards', { body: { name: '   ' }, cookie: token })
    expect(res.status).toBe(400)
  })
})

// --------------------------------------------------------------- api keys

describe('api keys', () => {
  it('mints sk_somnia keys, authorizes Bearer calls, and revocation kills them', async () => {
    const { token, id } = await newUser()

    const minted = await call('POST', 'keys', { body: { name: 'CI pipeline' }, cookie: token })
    expect(minted.status).toBe(201)
    expect(minted.body.key).toMatch(/^sk_somnia_[0-9a-f]{64}$/)

    const list = await call('GET', 'keys', { cookie: token })
    expect(list.status).toBe(200)
    expect(list.body.keys).toHaveLength(1)
    expect(list.body.keys[0].name).toBe('CI pipeline')
    expect(list.body.keys[0].prefix).toBe(minted.body.key.slice(0, 13))
    expect(list.body.keys[0].hash).toBeUndefined() // never exposed after mint

    const viaKey = await call('GET', 'credits', { bearer: minted.body.key })
    expect(viaKey.status).toBe(200)
    expect(viaKey.body.user.id ?? id).toBeTruthy()

    const revoked = await call('DELETE', `keys/${minted.body.id}`, { cookie: token })
    expect(revoked.status).toBe(200)
    const dead = await call('GET', 'credits', { bearer: minted.body.key })
    expect(dead.status).toBe(401)
  })

  it('requires a key name', async () => {
    const { token } = await newUser()
    const res = await call('POST', 'keys', { body: { name: '' }, cookie: token })
    expect(res.status).toBe(400)
  })
})

// ------------------------------------------------------------------ agents

describe('agents', () => {
  it('plans a run with the plan’s variation cap and dispatches it', async () => {
    const { token } = await newUser()
    const planned = await call('POST', 'agents', {
      body: { goal: 'a paper lantern festival at dusk' },
      cookie: token,
    })
    expect(planned.status).toBe(201)
    expect(planned.body.run.status).toBe('planning')
    expect(planned.body.plan).toHaveLength(2) // trial cap

    const started = await call('POST', `agents/${planned.body.run.id}/start`, { cookie: token })
    expect(started.status).toBe(200)
    expect(started.body.run.status).toBe('completed')
    expect(started.body.run.variations).toBe(2)
    expect(await balanceOf(token)).toBe(800) // 2 x 100 per shot

    const view = await call('GET', `agents/${planned.body.run.id}`, { cookie: token })
    expect(view.status).toBe(200)
    expect(view.body.plan).toHaveLength(2)
  })

  it('refuses dispatch when the balance cannot cover the plan (402)', async () => {
    const { token, id } = await newUser()
    await db.user.update({ where: { id }, data: { credits: 50 } })
    const planned = await call('POST', 'agents', {
      body: { goal: 'underfunded mission' },
      cookie: token,
    })
    const started = await call('POST', `agents/${planned.body.run.id}/start`, { cookie: token })
    expect(started.status).toBe(402)
  })

  it('requires a goal of at least 3 characters (400)', async () => {
    const { token } = await newUser()
    const res = await call('POST', 'agents', { body: { goal: 'no' }, cookie: token })
    expect(res.status).toBe(400)
  })
})

// -------------------------------------------------------------- brainstorm

describe('brainstorm', () => {
  it('suggests style variants for a prompt', async () => {
    const { token } = await newUser()
    const { status, body } = await call('POST', 'brainstorm', {
      body: { prompt: 'a keeper walking a lighthouse spiral' },
      cookie: token,
    })
    expect(status).toBe(200)
    expect(body.variants).toHaveLength(3)
    for (const v of body.variants) {
      expect(typeof v.text).toBe('string')
      expect(v.text.length).toBeGreaterThan(0)
    }
  })

  it('requires auth and a real prompt', async () => {
    const anon = await call('POST', 'brainstorm', { body: { prompt: 'something' } })
    expect(anon.status).toBe(401)

    const { token } = await newUser()
    const bad = await call('POST', 'brainstorm', { body: { prompt: 'ab' }, cookie: token })
    expect(bad.status).toBe(400)
  })
})

// -------------------------------------------------------------- dispatch

describe('dispatch hygiene', () => {
  it('404s unknown routes and wrong methods', async () => {
    const unknown = await call('GET', 'definitely-not-a-route')
    expect(unknown.status).toBe(404)

    const wrongMethod = await call('GET', 'generate')
    expect(wrongMethod.status).toBe(404)
  })

  it('serves provider health publicly', async () => {
    const { status } = await call('GET', 'providers/health')
    expect(status).toBe(200)
  })
})

// -------------------------------------------------------------- insights

describe('insights — the margin lens (T7)', () => {
  it('requires authentication', async () => {
    const anon = await call('GET', 'insights')
    expect(anon.status).toBe(401)
  })

  it('returns the caller-scoped economics snapshot with every lens block', async () => {
    const { id: userId, token } = await newUser()
    await completedVideoJob(userId, token)

    const { status, body } = await call('GET', 'insights', { cookie: token })
    expect(status).toBe(200)

    expect(body.jobs).toMatchObject({ total: 1, completed: 1 })
    expect(body.ledger.granted).toBe(1000)
    expect(body.ledger.spent).toBe(100)
    expect(body.ledger.balance).toBe(900)

    // demo render: no provider cost, trial credits carry no revenue
    expect(body.economics).toMatchObject({
      revenueUsd: 0,
      providerCostUsd: 0,
      grossMarginPct: 0,
    })

    // the completed pulse-3 720p job appears in the tier table
    const tier = body.tiers.find(
      (t: any) => t.model === 'pulse-3' && t.resolution === '720p'
    )
    expect(tier).toMatchObject({ provider: 'demo', jobs: 1, credits: 100, costUsd: 0 })
    expect(tier.avgCostUsdPerJob).toBe(0)

    // cross-check: the lens sees exactly this caller's job
    const other = await newUser()
    const solo = await call('GET', 'insights', { cookie: other.token })
    expect(solo.body.jobs.total).toBe(0)
    expect(solo.body.tiers).toEqual([])
  })

  it('prices consumed credits at the plan rate once the plan is paid', async () => {
    const { id: userId, token } = await newUser()
    // upgrade to spark ($30 / 10,000 credits) — pool lands on the credits read
    await db.user.update({ where: { id: userId }, data: { plan: 'spark' } })
    await call('GET', 'credits', { cookie: token }) // triggers the monthly grant

    const { body } = await call('GET', 'insights', { cookie: token })
    // nothing spent yet: zero revenue, zero cost, margin 0
    expect(body.economics.revenueUsd).toBe(0)
    expect(body.economics.grossMarginPct).toBe(0)

    await completedVideoJob(userId, token) // 100 credits consumed
    const after = await call('GET', 'insights', { cookie: token })
    expect(after.body.economics.revenueUsd).toBeCloseTo(100 * (30 / 10_000), 8)
  })
})
