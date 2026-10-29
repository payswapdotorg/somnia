// src/lib/ledger.ts — Somnia per-user credit ledger.
//
// The ledger is APPEND-ONLY: every signup grant, monthly pool grant, charged
// spend, refund and topup lands as one row carrying the post-transaction
// balance, so the whole history replays to the current balance. User.credits
// is the authoritative balance, mutated only inside the same transaction that
// appends the row. Spends are idempotent via a unique idempotencyKey.

import { db } from '@/lib/db'
import { PLANS, TRIAL_CREDITS, type PlanId } from '@/lib/plans'

/** Monthly pool cycle length. A new pool grant is due once the last one is
 *  older than this window (mirrors a billing month). */
const CYCLE_MS = 30 * 24 * 3600 * 1000

export interface LedgerResult {
  balance: number
  granted: boolean
}

export async function balance(userId: string): Promise<number> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { credits: true },
  })
  return user.credits
}

/**
 * One-time trial grant per account. Idempotent: exactly one 'signup' row is
 * ever recorded. A legacy/imported balance is topped UP TO the trial
 * entitlement (never exceeded, never reduced).
 */
export async function ensureSignupGrant(userId: string): Promise<LedgerResult> {
  const existing = await db.creditTransaction.findFirst({
    where: { userId, kind: 'signup' },
    select: { id: true },
  })
  if (existing) {
    const user = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { credits: true },
    })
    return { balance: user.credits, granted: false }
  }

  return db.$transaction(async (tx) => {
    // Re-check inside the transaction so concurrent callers can't double-grant.
    const again = await tx.creditTransaction.findFirst({
      where: { userId, kind: 'signup' },
      select: { id: true },
    })
    if (again) {
      const u = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { credits: true },
      })
      return { balance: u.credits, granted: false }
    }
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { credits: true },
    })
    const delta = Math.max(0, TRIAL_CREDITS - user.credits)
    const updated = await tx.user.update({
      where: { id: userId },
      data: { credits: { increment: delta } },
    })
    await tx.creditTransaction.create({
      data: {
        userId,
        amount: delta,
        kind: 'signup',
        note: 'trial signup grant',
        balanceAfter: updated.credits,
      },
    })
    return { balance: updated.credits, granted: true }
  })
}

/**
 * Monthly plan pool. Paid plans receive their pool when no grant has landed
 * in the current cycle window; repeat calls inside the window are no-ops.
 * Trial never receives monthly grants.
 */
export async function ensureMonthlyPool(userId: string): Promise<LedgerResult> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } })
  const spec = PLANS[user.plan as PlanId]
  if (!spec || spec.id === 'trial') {
    return { balance: user.credits, granted: false }
  }

  const last = await db.creditTransaction.findFirst({
    where: { userId, kind: 'monthly' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  if (last && Date.now() - last.createdAt.getTime() < CYCLE_MS) {
    return { balance: user.credits, granted: false }
  }

  return db.$transaction(async (tx) => {
    const reLast = await tx.creditTransaction.findFirst({
      where: { userId, kind: 'monthly' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })
    if (reLast && Date.now() - reLast.createdAt.getTime() < CYCLE_MS) {
      const u = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { credits: true },
      })
      return { balance: u.credits, granted: false }
    }
    const pool = spec.monthlyCredits
    const updated = await tx.user.update({
      where: { id: userId },
      data: { credits: { increment: pool } },
    })
    await tx.creditTransaction.create({
      data: {
        userId,
        amount: pool,
        kind: 'monthly',
        note: `${spec.label} monthly pool`,
        balanceAfter: updated.credits,
      },
    })
    return { balance: updated.credits, granted: true }
  })
}

export interface SpendArgs {
  userId: string
  amount: number
  kind?: string
  note?: string
  jobId?: string
  /** Unique dedupe key — a repeated spend with the same key is a no-op. */
  idempotencyKey?: string
}

export interface SpendResult {
  balance: number
  duplicate: boolean
}

/** Charge credits. Throws on overdraft (nothing is written). Idempotent by key. */
export async function spend(args: SpendArgs): Promise<SpendResult> {
  const kind = args.kind ?? 'spend'
  if (!Number.isFinite(args.amount) || args.amount <= 0) {
    throw new Error('spend amount must be a positive number')
  }

  const dup = args.idempotencyKey
    ? await db.creditTransaction.findUnique({
        where: { idempotencyKey: args.idempotencyKey },
        select: { id: true },
      })
    : null
  if (dup) {
    const user = await db.user.findUniqueOrThrow({
      where: { id: args.userId },
      select: { credits: true },
    })
    return { balance: user.credits, duplicate: true }
  }

  return db.$transaction(async (tx) => {
    if (args.idempotencyKey) {
      const again = await tx.creditTransaction.findUnique({
        where: { idempotencyKey: args.idempotencyKey },
        select: { id: true },
      })
      if (again) {
        const u = await tx.user.findUniqueOrThrow({
          where: { id: args.userId },
          select: { credits: true },
        })
        return { balance: u.credits, duplicate: true }
      }
    }
    const user = await tx.user.findUniqueOrThrow({
      where: { id: args.userId },
      select: { credits: true },
    })
    if (user.credits < args.amount) {
      throw new Error(
        `insufficient credits: balance ${user.credits} < ${args.amount}`
      )
    }
    const updated = await tx.user.update({
      where: { id: args.userId },
      data: { credits: { decrement: args.amount } },
    })
    await tx.creditTransaction.create({
      data: {
        userId: args.userId,
        jobId: args.jobId ?? null,
        amount: -args.amount,
        kind,
        note: args.note ?? null,
        balanceAfter: updated.credits,
        idempotencyKey: args.idempotencyKey ?? null,
      },
    })
    return { balance: updated.credits, duplicate: false }
  })
}

export interface RefundArgs {
  userId: string
  jobId?: string
  amount: number
  note?: string
  idempotencyKey?: string
}

/** Refund credits back (failed generations refund in full). */
export async function refund(args: RefundArgs): Promise<{ balance: number }> {
  if (!Number.isFinite(args.amount) || args.amount <= 0) {
    throw new Error('refund amount must be a positive number')
  }
  if (args.idempotencyKey) {
    const dup = await db.creditTransaction.findUnique({
      where: { idempotencyKey: args.idempotencyKey },
      select: { id: true },
    })
    if (dup) {
      const user = await db.user.findUniqueOrThrow({
        where: { id: args.userId },
        select: { credits: true },
      })
      return { balance: user.credits }
    }
  }
  return db.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: args.userId },
      data: { credits: { increment: args.amount } },
    })
    await tx.creditTransaction.create({
      data: {
        userId: args.userId,
        jobId: args.jobId ?? null,
        amount: args.amount,
        kind: 'refund',
        note: args.note ?? null,
        balanceAfter: updated.credits,
        idempotencyKey: args.idempotencyKey ?? null,
      },
    })
    return { balance: updated.credits }
  })
}

/** Manual credit pack purchase. */
export async function topup(args: {
  userId: string
  amount: number
  note?: string
}): Promise<{ balance: number }> {
  if (!Number.isFinite(args.amount) || args.amount <= 0) {
    throw new Error('topup amount must be a positive number')
  }
  return db.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: args.userId },
      data: { credits: { increment: args.amount } },
    })
    await tx.creditTransaction.create({
      data: {
        userId: args.userId,
        amount: args.amount,
        kind: 'topup',
        note: args.note ?? null,
        balanceAfter: updated.credits,
      },
    })
    return { balance: updated.credits }
  })
}
