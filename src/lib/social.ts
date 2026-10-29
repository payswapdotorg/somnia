// src/lib/social.ts — Somnia social layer.
//
// Boards (with shareable public links), per-job public sharing, likes, the
// ideas feed (shared completed creations, newest first), and remix prefill
// (opens the composer seeded from another creation — never charges).

import { randomBytes } from 'node:crypto'
import { db } from '@/lib/db'

export interface BoardSummary {
  id: string
  name: string
  description: string | null
  shareToken: string | null
  jobCount: number
}

function newToken(): string {
  return randomBytes(16).toString('hex')
}

// ------------------------------------------------------------------- boards

export async function createBoard(
  userId: string,
  input: { name: string; description?: string }
) {
  const name = (input.name ?? '').trim()
  if (name.length === 0) throw new Error('board name is required')
  return db.board.create({
    data: { userId, name, description: input.description?.trim() || null },
  })
}

export async function listBoards(userId: string): Promise<BoardSummary[]> {
  const boards = await db.board.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  })
  const counts = await db.job.groupBy({
    by: ['boardId'],
    where: { userId },
    _count: { _all: true },
  })
  const countMap = new Map(
    counts.map((c) => [c.boardId ?? '', c._count._all] as const)
  )
  return boards.map((b) => ({
    id: b.id,
    name: b.name,
    description: b.description,
    shareToken: b.shareToken,
    jobCount: countMap.get(b.id) ?? 0,
  }))
}

/** Delete a board; its jobs survive, detached (boardId nulled). */
export async function deleteBoard(userId: string, boardId: string) {
  const board = await db.board.findFirst({ where: { id: boardId, userId } })
  if (!board) throw new Error('board not found')
  await db.job.updateMany({ where: { boardId }, data: { boardId: null } })
  await db.board.delete({ where: { id: board.id } })
}

export async function shareBoard(userId: string, boardId: string) {
  const board = await db.board.findFirst({ where: { id: boardId, userId } })
  if (!board) throw new Error('board not found')
  if (board.shareToken) return { token: board.shareToken }
  const token = newToken()
  await db.board.update({
    where: { id: board.id },
    data: { shareToken: token, sharedAt: new Date() },
  })
  return { token }
}

export async function getSharedBoard(token: string) {
  const board = await db.board.findUnique({ where: { shareToken: token } })
  if (!board) return null
  const jobs = await db.job.findMany({
    where: { boardId: board.id, status: 'completed' },
    orderBy: { createdAt: 'desc' },
    include: { assets: true },
  })
  return {
    board: {
      id: board.id,
      name: board.name,
      description: board.description,
      sharedAt: board.sharedAt,
    },
    jobs: jobs.map((j) => ({
      id: j.id,
      prompt: j.prompt,
      model: j.model,
      resolution: j.resolution,
      aspectRatio: j.aspectRatio,
      loop: j.loop,
      createdAt: j.createdAt,
      videoPath:
        j.assets.find((a) => a.kind === 'video' && a.variantKey === 'main')?.path ?? null,
    })),
  }
}

// ------------------------------------------------------------------ sharing

export async function shareJob(userId: string, jobId: string) {
  const job = await db.job.findFirst({ where: { id: jobId, userId } })
  if (!job) throw new Error('job not found')
  if (job.status !== 'completed') {
    throw new Error('only completed jobs can be shared')
  }
  if (job.shareToken) return { token: job.shareToken }
  const token = newToken()
  await db.job.update({
    where: { id: job.id },
    data: { shareToken: token, sharedAt: new Date() },
  })
  return { token }
}

export async function revokeShareJob(userId: string, jobId: string) {
  const job = await db.job.findFirst({ where: { id: jobId, userId } })
  if (!job) throw new Error('job not found')
  await db.job.update({
    where: { id: job.id },
    data: { shareToken: null, sharedAt: null },
  })
}

export async function getSharedJob(token: string) {
  const job = await db.job.findUnique({
    where: { shareToken: token },
    include: {
      user: { select: { name: true, avatarSeed: true } },
      assets: true,
    },
  })
  if (!job) return null
  const likeCount = await db.like.count({ where: { jobId: job.id } })
  return {
    job: {
      id: job.id,
      prompt: job.prompt,
      model: job.model,
      resolution: job.resolution,
      aspectRatio: job.aspectRatio,
      durationSec: job.durationSec,
      loop: job.loop,
      hdr: job.hdr,
      createdAt: job.createdAt,
    },
    author: { name: job.user.name, avatarSeed: job.user.avatarSeed },
    likeCount,
    videoPath:
      job.assets.find((a) => a.kind === 'video' && a.variantKey === 'main')?.path ?? null,
  }
}

// -------------------------------------------------------------------- likes

export async function likeJob(userId: string, jobId: string) {
  const existing = await db.like.findFirst({ where: { userId, jobId } })
  if (!existing) {
    await db.like.create({ data: { userId, jobId } })
  }
  const count = await db.like.count({ where: { jobId } })
  return { liked: true, count }
}

export async function unlikeJob(userId: string, jobId: string) {
  await db.like.deleteMany({ where: { userId, jobId } })
  const count = await db.like.count({ where: { jobId } })
  return { liked: false, count }
}

// -------------------------------------------------------------- ideas feed

export interface FeedItem {
  id: string
  prompt: string
  model: string
  resolution: string
  aspectRatio: string
  durationSec: number
  loop: boolean
  createdAt: Date
  author: { name: string; avatarSeed: string }
  videoPath: string | null
  likeCount: number
  likedByMe: boolean
}

export async function listIdeas(opts: {
  viewerId?: string
  limit?: number
  offset?: number
}): Promise<{ items: FeedItem[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 24, 1), 48)
  const offset = Math.max(opts.offset ?? 0, 0)
  const where = { status: 'completed', shareToken: { not: null } } as const

  const [total, jobs] = await Promise.all([
    db.job.count({ where: { ...where } }),
    db.job.findMany({
      where: { ...where },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
      include: {
        user: { select: { name: true, avatarSeed: true } },
        assets: true,
      },
    }),
  ])

  const ids = jobs.map((j) => j.id)
  const counts = ids.length
    ? await db.like.groupBy({ by: ['jobId'], where: { jobId: { in: ids } }, _count: { _all: true } })
    : []
  const countMap = new Map(counts.map((c) => [c.jobId, c._count._all] as const))
  const likedSet = new Set(
    opts.viewerId && ids.length
      ? (
          await db.like.findMany({
            where: { userId: opts.viewerId, jobId: { in: ids } },
            select: { jobId: true },
          })
        ).map((l) => l.jobId)
      : []
  )

  const items: FeedItem[] = jobs.map((j) => ({
    id: j.id,
    prompt: j.prompt,
    model: j.model,
    resolution: j.resolution,
    aspectRatio: j.aspectRatio,
    durationSec: j.durationSec,
    loop: j.loop,
    createdAt: j.createdAt,
    author: { name: j.user.name, avatarSeed: j.user.avatarSeed },
    videoPath:
      j.assets.find((a) => a.kind === 'video' && a.variantKey === 'main')?.path ?? null,
    likeCount: countMap.get(j.id) ?? 0,
    likedByMe: likedSet.has(j.id),
  }))
  return { items, total }
}

// -------------------------------------------------------------------- remix

export interface RemixPrefill {
  prompt: string
  model: string
  resolution: string
  aspectRatio: string
  durationSec: number
  hdr: boolean
  loop: boolean
  startFramePath: string | null
  endFramePath: string | null
}

/**
 * Remix prefill: seeds the composer from any completed job the viewer owns
 * or that is publicly shared. Charges nothing and creates nothing — the
 * user decides whether to forge.
 */
export async function remixJob(userId: string, jobId: string): Promise<RemixPrefill> {
  const job = await db.job.findFirst({
    where: {
      id: jobId,
      OR: [{ userId }, { shareToken: { not: null } }],
    },
  })
  if (!job) throw new Error('job not found or not shared')
  if (job.status !== 'completed') throw new Error('only completed jobs can be remixed')
  return {
    prompt: job.prompt,
    model: job.model,
    resolution: job.resolution,
    aspectRatio: job.aspectRatio,
    durationSec: job.durationSec,
    hdr: job.hdr,
    loop: job.loop,
    // carry the source's closing imagery forward as the opening frame
    startFramePath: job.endFramePath ?? job.startFramePath ?? null,
    endFramePath: null,
  }
}
