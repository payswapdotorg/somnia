// tests/social.test.ts — TDD RED first.
// Boards, public sharing, likes, the ideas feed, and remix prefill.
import { describe, expect, it, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import {
  createBoard,
  listBoards,
  deleteBoard,
  shareBoard,
  getSharedBoard,
  shareJob,
  revokeShareJob,
  getSharedJob,
  likeJob,
  unlikeJob,
  listIdeas,
  remixJob,
} from '@/lib/social'

const OWNER = 'social-owner@somnia.test'
const OTHER = 'social-other@somnia.test'
const VIEWER = 'social-viewer@somnia.test'

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
      idempotencyKey: `soc-${Math.random().toString(36).slice(2)}`,
      ...overrides,
    },
  })
}

async function addVideoAsset(jobId: string) {
  return db.asset.create({
    data: { jobId, kind: 'video', path: `/generated/${jobId}.mp4`, variantKey: 'main' },
  })
}

beforeEach(async () => {
  await db.user.deleteMany({ where: { email: { in: [OWNER, OTHER, VIEWER] } } })
})

describe('social — boards', () => {
  it('creates and lists boards with job counts', async () => {
    const user = await seedUser(OWNER)
    const board = await createBoard(user.id, { name: 'Night Market' })
    expect(board.name).toBe('Night Market')
    await seedJob(user.id, { boardId: board.id })
    const boards = await listBoards(user.id)
    expect(boards).toHaveLength(1)
    expect(boards[0].jobCount).toBe(1)
  })

  it('deleting a board keeps its jobs (detached, unfiltered)', async () => {
    const user = await seedUser(OWNER)
    const board = await createBoard(user.id, { name: 'Doomed' })
    const job = await seedJob(user.id, { boardId: board.id })
    await deleteBoard(user.id, board.id)
    const surviving = await db.job.findUniqueOrThrow({ where: { id: job.id } })
    expect(surviving.boardId).toBeNull()
  })

  it('shares a board with an idempotent token and serves it publicly', async () => {
    const user = await seedUser(OWNER)
    const board = await createBoard(user.id, { name: 'Public Reel' })
    const job = await seedJob(user.id, { boardId: board.id })
    await addVideoAsset(job.id)
    const first = await shareBoard(user.id, board.id)
    const second = await shareBoard(user.id, board.id)
    expect(second.token).toBe(first.token)
    const served = await getSharedBoard(first.token)
    expect(served!.board.name).toBe('Public Reel')
    expect(served!.jobs).toHaveLength(1)
  })
})

describe('social — job sharing', () => {
  it('mints an idempotent share token on completed jobs only', async () => {
    const user = await seedUser(OWNER)
    const job = await seedJob(user.id)
    const first = await shareJob(user.id, job.id)
    expect(first.token).toHaveLength(32)
    const again = await shareJob(user.id, job.id)
    expect(again.token).toBe(first.token)

    const live = await db.job.create({
      data: { userId: user.id, prompt: 'running', status: 'running', idempotencyKey: 'soc-live' },
    })
    await expect(shareJob(user.id, live.id)).rejects.toThrow(/completed/i)
  })

  it('revocation kills the link; re-sharing mints a fresh token', async () => {
    const user = await seedUser(OWNER)
    const job = await seedJob(user.id)
    const { token } = await shareJob(user.id, job.id)
    await revokeShareJob(user.id, job.id)
    expect(await getSharedJob(token)).toBeNull()
    const renewed = await shareJob(user.id, job.id)
    expect(renewed.token).not.toBe(token)
    expect(await getSharedJob(renewed.token)).toBeTruthy()
  })

  it('serves a public payload with author info and like count', async () => {
    const user = await seedUser(OWNER)
    const viewer = await seedUser(VIEWER)
    const job = await seedJob(user.id)
    await addVideoAsset(job.id)
    const { token } = await shareJob(user.id, job.id)
    await likeJob(viewer.id, job.id)
    const payload = await getSharedJob(token)
    expect(payload!.job.prompt).toContain('paper boat')
    expect(payload!.author.name).toBe(user.name)
    expect(payload!.likeCount).toBe(1)
    expect(payload!.videoPath).toBe(`/generated/${job.id}.mp4`)
  })
})

describe('social — likes', () => {
  it('likes once (unique), unlikes cleanly', async () => {
    const owner = await seedUser(OWNER)
    const viewer = await seedUser(VIEWER)
    const job = await seedJob(owner.id)
    const first = await likeJob(viewer.id, job.id)
    expect(first).toMatchObject({ liked: true, count: 1 })
    const dup = await likeJob(viewer.id, job.id)
    expect(dup).toMatchObject({ liked: true, count: 1 })
    const off = await unlikeJob(viewer.id, job.id)
    expect(off).toMatchObject({ liked: false, count: 0 })
    const offAgain = await unlikeJob(viewer.id, job.id)
    expect(offAgain.count).toBe(0)
  })
})

describe('social — ideas feed', () => {
  it('lists shared completed jobs newest-first with like state', async () => {
    const owner = await seedUser(OWNER)
    const other = await seedUser(OTHER)
    const viewer = await seedUser(VIEWER)
    const old = await seedJob(owner.id, {
      createdAt: new Date(Date.now() - 3000),
      shareToken: 'tok-old-0000000000000000000000',
    })
    const fresh = await seedJob(owner.id, {
      createdAt: new Date(Date.now() - 1000),
      shareToken: 'tok-new-0000000000000000000000',
    })
    // unshared + incomplete jobs must never appear
    await seedJob(owner.id, { createdAt: new Date(Date.now() - 500) })
    await seedJob(other.id, { status: 'queued', shareToken: 'tok-q-0000000000000000000000' })
    await likeJob(viewer.id, fresh.id)

    const feed = await listIdeas({ viewerId: viewer.id })
    expect(feed.items.map((i: { id: string }) => i.id)).toEqual([fresh.id, old.id])
    const freshItem = feed.items[0] as { likeCount: number; likedByMe: boolean }
    expect(freshItem.likeCount).toBe(1)
    expect(freshItem.likedByMe).toBe(true)
    expect(feed.items[1].likedByMe).toBe(false)
  })

  it('paginates with limit + offset', async () => {
    const owner = await seedUser(OWNER)
    for (let i = 0; i < 5; i++) {
      await seedJob(owner.id, {
        createdAt: new Date(Date.now() - (5 - i) * 1000),
        shareToken: `tok-p${i}-${'0'.repeat(20)}`,
      })
    }
    const page1 = await listIdeas({ limit: 2, offset: 0 })
    const page2 = await listIdeas({ limit: 2, offset: 2 })
    expect(page1.items).toHaveLength(2)
    expect(page2.items).toHaveLength(2)
    expect(page1.items[0].id).not.toBe(page2.items[0].id)
    expect(page1.total).toBe(5)
  })
})

describe('social — remix', () => {
  it('returns a prefill payload without creating a job or charging', async () => {
    const viewer = await seedUser(VIEWER)
    const job = await seedJob(viewer.id, {
      model: 'pulse-flash',
      resolution: '1080p',
      durationSec: 10,
      loop: true,
      endFramePath: '/generated/seed-end.png',
    })
    const before = await db.job.count({ where: { userId: viewer.id } })
    const prefill = await remixJob(viewer.id, job.id)
    expect(prefill.prompt).toContain('paper boat')
    expect(prefill.model).toBe('pulse-flash')
    expect(prefill.resolution).toBe('1080p')
    expect(prefill.durationSec).toBe(10)
    expect(prefill.loop).toBe(true)
    expect(prefill.startFramePath).toBe('/generated/seed-end.png')
    expect(await db.job.count({ where: { userId: viewer.id } })).toBe(before)
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: viewer.id } })).credits
    ).toBe(0)
  })

  it('allows remixing another user\u2019s shared job but not their private one', async () => {
    const owner = await seedUser(OWNER)
    const viewer = await seedUser(VIEWER)
    const shared = await seedJob(owner.id, { shareToken: 'tok-r-0000000000000000000000' })
    const privateJob = await seedJob(owner.id)
    expect((await remixJob(viewer.id, shared.id)).prompt).toBeTruthy()
    await expect(remixJob(viewer.id, privateJob.id)).rejects.toThrow(/not found|shared/i)
  })
})
