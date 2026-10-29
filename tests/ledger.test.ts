// tests/ledger.test.ts — TDD RED first.
// Per-user credit ledger: signup grant, monthly pool grants (cycle-scoped,
// idempotent), charged spends with idempotency, refunds on failure, and the
// append-only invariant.
import { describe, expect, it, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import {
  balance,
  ensureSignupGrant,
  ensureMonthlyPool,
  spend,
  refund,
  topup,
} from '@/lib/ledger'

const EMAIL = 'ledger-test@somnia.test'

async function seedUser(overrides: Record<string, unknown> = {}) {
  return db.user.create({
    data: { email: EMAIL, name: 'Ledger Tester', credits: 0, ...overrides },
  })
}

beforeEach(async () => {
  await db.user.deleteMany({ where: { email: EMAIL } })
})

describe('ledger — signup grant', () => {
  it('grants trial credits exactly once (idempotent across calls)', async () => {
    const user = await seedUser()
    const first = await ensureSignupGrant(user.id)
    expect(first.balance).toBe(1_000)
    const again = await ensureSignupGrant(user.id)
    expect(again.balance).toBe(1_000)
    const rows = await db.creditTransaction.findMany({
      where: { userId: user.id, kind: 'signup' },
    })
    expect(rows).toHaveLength(1)
  })

  it('tops a legacy balance up to the trial entitlement exactly once', async () => {
    const user = await seedUser({ credits: 42 })
    const res = await ensureSignupGrant(user.id)
    expect(res.balance).toBe(1_000)
    const rows = await db.creditTransaction.findMany({
      where: { userId: user.id, kind: 'signup' },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].amount).toBe(958) // 42 + 958 = 1000
    expect(rows[0].balanceAfter).toBe(1_000)
  })
})

describe('ledger — monthly pool', () => {
  it('grants the plan pool when the cycle rolls over and no grant landed yet', async () => {
    const user = await seedUser({ plan: 'spark' })
    const res = await ensureMonthlyPool(user.id)
    expect(res.balance).toBe(10_000)
    const again = await ensureMonthlyPool(user.id)
    expect(again.balance).toBe(10_000)
    expect(
      await db.creditTransaction.count({ where: { userId: user.id, kind: 'monthly' } })
    ).toBe(1)
  })

  it('re-grants after the cycle window advances', async () => {
    const user = await seedUser({ plan: 'spark' })
    await ensureMonthlyPool(user.id)
    // Age the existing monthly grant past one full cycle.
    const stale = new Date(Date.now() - 32 * 24 * 3600 * 1000)
    await db.creditTransaction.updateMany({
      where: { userId: user.id, kind: 'monthly' },
      data: { createdAt: stale },
    })
    const res = await ensureMonthlyPool(user.id)
    expect(res.balance).toBe(20_000)
    expect(
      await db.creditTransaction.count({ where: { userId: user.id, kind: 'monthly' } })
    ).toBe(2)
  })

  it('trial plan never receives monthly grants', async () => {
    const user = await seedUser({ plan: 'trial' })
    const res = await ensureMonthlyPool(user.id)
    expect(res.balance).toBe(0)
    expect(
      await db.creditTransaction.count({ where: { userId: user.id, kind: 'monthly' } })
    ).toBe(0)
  })
})

describe('ledger — spend', () => {
  it('charges and records balanceAfter atomically', async () => {
    const user = await seedUser({ credits: 500 })
    const res = await spend({
      userId: user.id,
      amount: 120,
      kind: 'spend',
      note: 'pulse-3 720p 5s',
      idempotencyKey: 'job-a',
    })
    expect(res.balance).toBe(380)
    const [row] = await db.creditTransaction.findMany({
      where: { userId: user.id, kind: 'spend' },
    })
    expect(row.amount).toBe(-120)
    expect(row.balanceAfter).toBe(380)
    expect((row as { jobId?: string | null }).jobId ?? row.note).toBeTruthy()
  })

  it('is idempotent under a repeated idempotency key', async () => {
    const user = await seedUser({ credits: 500 })
    const one = await spend({ userId: user.id, amount: 100, kind: 'spend', idempotencyKey: 'job-b' })
    const two = await spend({ userId: user.id, amount: 100, kind: 'spend', idempotencyKey: 'job-b' })
    expect(two.balance).toBe(400)
    expect(two.duplicate).toBe(true)
    expect(one.duplicate).toBe(false)
    expect(await balance(user.id)).toBe(400)
  })

  it('refuses to overdraw (402-style error, no ledger row)', async () => {
    const user = await seedUser({ credits: 50 })
    await expect(
      spend({ userId: user.id, amount: 100, kind: 'spend', idempotencyKey: 'job-c' })
    ).rejects.toThrow(/insufficient credit/i)
    expect(
      await db.creditTransaction.count({ where: { userId: user.id, kind: 'spend' } })
    ).toBe(0)
    expect(await balance(user.id)).toBe(50)
  })
})

describe('ledger — refund & topup', () => {
  it('refunds a failed generation back in full with kind refund', async () => {
    const user = await seedUser({ credits: 500 })
    const job = await db.job.create({
      data: {
        userId: user.id,
        prompt: 'refund probe',
        status: 'failed',
        creditsCharged: 120,
        idempotencyKey: 'refund-job-1',
      },
    })
    const res = await refund({ userId: user.id, jobId: job.id, amount: 120, note: 'generation failed' })
    expect(res.balance).toBe(620)
    const [row] = await db.creditTransaction.findMany({
      where: { userId: user.id, kind: 'refund', jobId: job.id },
    })
    expect(row.amount).toBe(120)
    expect(row.balanceAfter).toBe(620)
  })

  it('topup appends a grant row (manual credit pack purchase)', async () => {
    const user = await seedUser({ credits: 10 })
    const res = await topup({ userId: user.id, amount: 500, note: 'credit pack' })
    expect(res.balance).toBe(510)
    const [row] = await db.creditTransaction.findMany({
      where: { userId: user.id, kind: 'topup' },
    })
    expect(row.amount).toBe(500)
  })
})

describe('ledger — invariants', () => {
  it('never updates or deletes existing rows (append-only by construction)', async () => {
    const user = await seedUser({ credits: 1_000 })
    await spend({ userId: user.id, amount: 40, kind: 'spend', idempotencyKey: 'inv-1' })
    await refund({ userId: user.id, amount: 40, note: 'inv refund' })
    const rows = await db.creditTransaction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    })
    expect(rows).toHaveLength(2)
    // balanceAfter chain is monotonically consistent
    expect(rows[0].balanceAfter).toBe(960)
    expect(rows[1].balanceAfter).toBe(1_000)
    expect(await balance(user.id)).toBe(1_000)
  })
})
