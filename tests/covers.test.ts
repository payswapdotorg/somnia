// tests/covers.test.ts — board cover stills + share posters (T9).
//
// The cover rule, pinned: a completed dream's still is its poster asset
// when one exists (image jobs), else the middle keyframe of its pinned
// timeline (video jobs — the most representative frame). A board's cover
// is the newest completed dream's still; boards with nothing completed
// have no cover (null, never a fake). The public payloads surface the
// same stills: per-job posterPath plus a board-level coverPath for OG.
import { describe, expect, it, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import {
  createBoard,
  listBoards,
  shareBoard,
  getSharedBoard,
  shareJob,
  getSharedJob,
} from '@/lib/social'

const OWNER = 'covers-owner@somnia.test'
const OTHER = 'covers-other@somnia.test'

async function seedUser(email: string) {
  return db.user.create({ data: { email, name: email.split('@')[0] } })
}

async function seedJob(
  userId: string,
  overrides: Record<string, unknown> = {}
) {
  return db.job.create({
    data: {
      userId,
      prompt: 'a paper boat down a neon gutter',
      status: 'completed',
      progress: 100,
      idempotencyKey: `cov-${Math.random().toString(36).slice(2)}`,
      ...overrides,
    },
  })
}

async function addPoster(jobId: string) {
  return db.asset.create({
    data: { jobId, kind: 'poster', path: `/generated/${jobId}-poster.png`, variantKey: 'main' },
  })
}

/** Pinned timeline keyframes with the given orders (1-based). */
async function addKeyframes(jobId: string, orders: number[]) {
  await db.keyframe.createMany({
    data: orders.map((order) => ({ jobId, order, path: `/generated/${jobId}-k${order}.png` })),
  })
}

beforeEach(async () => {
  await db.user.deleteMany({ where: { email: { in: [OWNER, OTHER] } } })
})

describe('covers — board cover stills', () => {
  it('a board cover is the newest completed dream’s poster still', async () => {
    const user = await seedUser(OWNER)
    const board = await createBoard(user.id, { name: 'Night Market' })

    const older = await seedJob(user.id, { boardId: board.id, createdAt: new Date('2026-10-01') })
    await addPoster(older.id)
    const newer = await seedJob(user.id, { boardId: board.id, createdAt: new Date('2026-10-02') })
    await addPoster(newer.id)

    const boards = await listBoards(user.id)
    expect(boards).toHaveLength(1)
    expect(boards[0].coverPath).toBe(`/generated/${newer.id}-poster.png`)
  })

  it('video dreams fall back to the middle keyframe of the pinned timeline', async () => {
    const user = await seedUser(OWNER)
    const board = await createBoard(user.id, { name: 'Frames' })
    const job = await seedJob(user.id, { boardId: board.id })
    await db.asset.create({
      data: { jobId: job.id, kind: 'video', path: `/generated/${job.id}.mp4`, variantKey: 'main' },
    })
    // orders 1..3 — the middle (order 2) is the cover
    await addKeyframes(job.id, [1, 2, 3])

    const boards = await listBoards(user.id)
    expect(boards[0].coverPath).toBe(`/generated/${job.id}-k2.png`)
  })

  it('a single keyframe is its own middle; the poster still wins over keyframes', async () => {
    const user = await seedUser(OWNER)
    const board = await createBoard(user.id, { name: 'Solo' })

    const solo = await seedJob(user.id, { boardId: board.id, createdAt: new Date('2026-10-01') })
    await addKeyframes(solo.id, [1])
    const pinned = await seedJob(user.id, { boardId: board.id, createdAt: new Date('2026-10-05') })
    await addKeyframes(pinned.id, [1, 2])
    await addPoster(pinned.id)

    const boards = await listBoards(user.id)
    // newest job wins, and its poster beats its keyframes
    expect(boards[0].coverPath).toBe(`/generated/${pinned.id}-poster.png`)
  })

  it('boards with nothing completed have no cover (null, never a fake)', async () => {
    const user = await seedUser(OWNER)
    const empty = await createBoard(user.id, { name: 'Empty' })
    const queuedBoard = await createBoard(user.id, { name: 'Queued' })
    await db.job.create({
      data: {
        userId: user.id,
        prompt: 'still rendering',
        status: 'running',
        idempotencyKey: 'cov-running',
        boardId: queuedBoard.id,
      },
    })

    const boards = await listBoards(user.id)
    const byName = new Map(boards.map((b) => [b.name, b]))
    expect(byName.get('Empty')!.coverPath).toBeNull()
    expect(byName.get('Queued')!.coverPath).toBeNull()
  })

  it('covers come only from the caller’s own dreams', async () => {
    const mine = await seedUser(OWNER)
    const other = await seedUser(OTHER)
    const myBoard = await createBoard(mine.id, { name: 'Mine' })
    const otherBoard = await createBoard(other.id, { name: 'Theirs' })
    const foreign = await seedJob(other.id, { boardId: otherBoard.id })
    await addPoster(foreign.id)
    // a job of MINE parked on a board id belonging to OTHER must not leak
    await seedJob(mine.id, { boardId: otherBoard.id })

    const boards = await listBoards(mine.id)
    expect(boards).toHaveLength(1)
    expect(boards[0].name).toBe('Mine')
    expect(boards[0].coverPath).toBeNull()
  })
})

describe('covers — public share payloads', () => {
  it('getSharedJob exposes the posterPath (poster, then middle keyframe)', async () => {
    const user = await seedUser(OWNER)

    const withPoster = await seedJob(user.id)
    await addPoster(withPoster.id)
    const { token: tokenPoster } = await shareJob(user.id, withPoster.id)
    const served = await getSharedJob(tokenPoster)
    expect(served!.posterPath).toBe(`/generated/${withPoster.id}-poster.png`)

    const videoOnly = await seedJob(user.id)
    await addKeyframes(videoOnly.id, [1, 2, 3])
    const { token: tokenVideo } = await shareJob(user.id, videoOnly.id)
    const servedVideo = await getSharedJob(tokenVideo)
    expect(servedVideo!.posterPath).toBe(`/generated/${videoOnly.id}-k2.png`)

    const bare = await seedJob(user.id)
    const { token: tokenBare } = await shareJob(user.id, bare.id)
    const servedBare = await getSharedJob(tokenBare)
    expect(servedBare!.posterPath).toBeNull()
  })

  it('getSharedBoard exposes per-job posterPath and a board-level coverPath', async () => {
    const user = await seedUser(OWNER)
    const board = await createBoard(user.id, { name: 'Public Reel' })

    const older = await seedJob(user.id, { boardId: board.id, createdAt: new Date('2026-10-01') })
    await addKeyframes(older.id, [1, 2, 3])
    const newer = await seedJob(user.id, { boardId: board.id, createdAt: new Date('2026-10-02') })
    await addPoster(newer.id)

    const { token } = await shareBoard(user.id, board.id)
    const served = await getSharedBoard(token)

    expect(served!.coverPath).toBe(`/generated/${newer.id}-poster.png`)
    expect(served!.jobs).toHaveLength(2)
    const byAge = new Map(served!.jobs.map((j) => [j.id, j.posterPath]))
    expect(byAge.get(newer.id)).toBe(`/generated/${newer.id}-poster.png`)
    expect(byAge.get(older.id)).toBe(`/generated/${older.id}-k2.png`)
  })

  it('a shared board with no stills has coverPath null and jobs render without posters', async () => {
    const user = await seedUser(OWNER)
    const board = await createBoard(user.id, { name: 'Bare' })
    await seedJob(user.id, { boardId: board.id })

    const { token } = await shareBoard(user.id, board.id)
    const served = await getSharedBoard(token)
    expect(served!.coverPath).toBeNull()
    expect(served!.jobs[0].posterPath).toBeNull()
  })
})
