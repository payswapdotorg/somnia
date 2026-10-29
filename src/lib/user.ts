import { db } from '@/lib/db'
import { DAILY_GRANT_CREDITS, DEFAULT_CREDITS, DEMO_USER_ID } from '@/lib/pricing'

/**
 * Reelforge Phase 1 has a single implicit studio user.
 * The singleton row ('demo') is seeded on the first API hit, together with an
 * append-only 'grant' ledger entry for the starting balance.
 */
export async function getOrCreateDemoUser() {
  const existing = await db.user.findUnique({ where: { id: DEMO_USER_ID } })
  if (existing) return existing

  return db.user.upsert({
    where: { id: DEMO_USER_ID },
    update: {},
    create: {
      id: DEMO_USER_ID,
      credits: DEFAULT_CREDITS,
    },
  }).then(async (user) => {
    // Seed the opening grant into the append-only ledger (idempotent-ish: if the
    // user row already existed we skip, otherwise this is the first creation).
    const alreadyGranted = await db.creditTransaction.findFirst({
      where: { userId: user.id, kind: 'grant' },
      select: { id: true },
    })
    if (!alreadyGranted) {
      await db.creditTransaction.create({
        data: {
          userId: user.id,
          amount: DEFAULT_CREDITS,
          kind: 'grant',
          balanceAfter: DEFAULT_CREDITS,
        },
      })
    }
    return user
  })
}

/** Start of the current UTC calendar day. */
function utcDayStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

export interface DailyGrantState {
  granted: boolean
  balance: number
  /** Next UTC midnight — when the next daily grant unlocks. */
  nextRefillAt: Date
}

/**
 * Phase 9 (N6): daily free refill.
 *
 * Appends a 'daily-grant' ledger row (+DAILY_GRANT_CREDITS) the first time
 * the balance is touched in a UTC day, inside one transaction that also bumps
 * User.credits — the ledger stays append-only and consistent. Safe to call
 * from every credits read; repeat calls the same day are cheap no-ops.
 */
export async function ensureDailyGrant(): Promise<DailyGrantState> {
  const user = await getOrCreateDemoUser()
  const dayStart = utcDayStart()
  const nextRefillAt = new Date(dayStart.getTime() + 24 * 3600 * 1000)

  const grantedToday = await db.creditTransaction.findFirst({
    where: {
      userId: user.id,
      kind: 'daily-grant',
      createdAt: { gte: dayStart },
    },
    select: { id: true },
  })
  if (grantedToday) {
    return { granted: false, balance: user.credits, nextRefillAt }
  }

  const updated = await db.$transaction(async (tx) => {
    // Re-check inside the transaction so concurrent readers can't double-grant.
    const already = await tx.creditTransaction.findFirst({
      where: {
        userId: user.id,
        kind: 'daily-grant',
        createdAt: { gte: dayStart },
      },
      select: { id: true },
    })
    if (already) {
      return tx.user.findUniqueOrThrow({ where: { id: user.id } })
    }
    const fresh = await tx.user.update({
      where: { id: user.id },
      data: { credits: { increment: DAILY_GRANT_CREDITS } },
    })
    await tx.creditTransaction.create({
      data: {
        userId: user.id,
        amount: DAILY_GRANT_CREDITS,
        kind: 'daily-grant',
        balanceAfter: fresh.credits,
      },
    })
    return fresh
  })

  return { granted: true, balance: updated.credits, nextRefillAt }
}
