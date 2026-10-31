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
  /** Newest completed dream's still — poster, else middle keyframe. */
  coverPath: string | null
}

function newToken(): string {
  return randomBytes(16).toString('hex')
}

/**
 * A dream's still: its poster asset when one exists (image dreams), else
 * the middle keyframe of the pinned timeline (video dreams — the most
 * representative frame). Nothing completed renders no still, ever a fake.
 */
function stillFor(job: {
  assets: { kind: string; path: string }[]
  keyframes: { order: number; path: string }[]
}): string | null {
  const poster = job.assets.find((a) => a.kind === 'poster')?.path
  if (poster) return poster
  const ordered = [...job.keyframes].sort((a, b) => a.order - b.order)
  return ordered.length > 0 ? ordered[Math.floor((ordered.length - 1) / 2)].path : null
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
  const [boards, counts, completed] = await Promise.all([
    db.board.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    }),
    // T18: count only COMPLETED dreams — a failed render refunds its credits
    // and produces nothing, so it must not inflate a board's dream count
    // (the cover logic below already filters to completed; the counts now
    // agree with it, and with the public /boards/<token> view).
    db.job.groupBy({
      by: ['boardId'],
      where: { userId, status: 'completed' },
      _count: { _all: true },
    }),
    // the caller's completed, still-filed dreams, newest first — one walk
    // builds every board cover (first job with a still wins per board)
    db.job.findMany({
      where: { userId, boardId: { not: null }, status: 'completed' },
      orderBy: { createdAt: 'desc' },
      select: {
        boardId: true,
        assets: { where: { kind: 'poster' }, select: { kind: true, path: true } },
        keyframes: { select: { order: true, path: true } },
      },
    }),
  ])
  const countMap = new Map(
    counts.map((c) => [c.boardId ?? '', c._count._all] as const)
  )
  const coverMap = new Map<string, string>()
  for (const job of completed) {
    const boardId = job.boardId
    if (!boardId || coverMap.has(boardId)) continue
    const still = stillFor(job)
    if (still) coverMap.set(boardId, still)
  }
  return boards.map((b) => ({
    id: b.id,
    name: b.name,
    description: b.description,
    shareToken: b.shareToken,
    jobCount: countMap.get(b.id) ?? 0,
    coverPath: coverMap.get(b.id) ?? null,
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
    include: { assets: true, keyframes: true },
  })
  const mapped = jobs.map((j) => ({
    id: j.id,
    prompt: j.prompt,
    model: j.model,
    resolution: j.resolution,
    aspectRatio: j.aspectRatio,
    loop: j.loop,
    createdAt: j.createdAt,
    videoPath:
      j.assets.find((a) => a.kind === 'video' && a.variantKey === 'main')?.path ?? null,
    posterPath: stillFor(j),
  }))
  return {
    board: {
      id: board.id,
      name: board.name,
      description: board.description,
      sharedAt: board.sharedAt,
    },
    /** Newest dream's still — the board's OG image. */
    coverPath: mapped[0]?.posterPath ?? null,
    jobs: mapped,
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
      keyframes: true,
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
      // T14 render truth — public honesty: simulated imagery says so
      placeholderRender: job.placeholderRender,
    },
    author: { name: job.user.name, avatarSeed: job.user.avatarSeed },
    likeCount,
    videoPath:
      job.assets.find((a) => a.kind === 'video' && a.variantKey === 'main')?.path ?? null,
    /** The dream's still — its OG image and the video poster. */
    posterPath: stillFor(job),
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
  /** T14 render truth — the imagery is placeholder art (demo tier). */
  placeholderRender: boolean
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
    placeholderRender: j.placeholderRender,
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
