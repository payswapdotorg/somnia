// tests/auth.test.ts — TDD RED first.
// Accounts & sessions: scrypt password hashing, signup/login, opaque session
// tokens stored hashed, expiry, per-user data isolation, and an env-gated
// Google OAuth scaffold (upsert-by-email, no password).
import { describe, expect, it, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import {
  hashPassword,
  verifyPassword,
  signup,
  login,
  createSession,
  getSessionUser,
  destroySession,
  upsertOAuthUser,
  SESSION_COOKIE,
} from '@/lib/auth'

const EMAIL = 'auth-test@somnia.test'
const PASS = 'correct horse battery staple'

beforeEach(async () => {
  await db.user.deleteMany({ where: { email: EMAIL } })
  await db.session.deleteMany({})
})

describe('auth — password hashing', () => {
  it('hashes with scrypt + unique salt (never plaintext, never equal twice)', async () => {
    const a = await hashPassword(PASS)
    const b = await hashPassword(PASS)
    expect(a).not.toBe(PASS)
    expect(a).not.toBe(b)
    expect(a.startsWith('scrypt$')).toBe(true)
  })

  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await hashPassword(PASS)
    expect(await verifyPassword(PASS, hash)).toBe(true)
    expect(await verifyPassword('wrong password', hash)).toBe(false)
    expect(await verifyPassword('', hash)).toBe(false)
  })
})

describe('auth — signup & login', () => {
  it('signup creates the user and seeds the trial grant via the ledger', async () => {
    const { user } = await signup({ email: EMAIL, password: PASS, name: 'Auth Tester' })
    expect(user.email).toBe(EMAIL)
    expect(user.plan).toBe('trial')
    expect(user.credits).toBe(1_000)
    expect(
      await db.creditTransaction.count({ where: { userId: user.id, kind: 'signup' } })
    ).toBe(1)
  })

  it('rejects duplicate signup (409-style)', async () => {
    await signup({ email: EMAIL, password: PASS, name: 'Auth Tester' })
    await expect(
      signup({ email: EMAIL, password: 'another-pass-123', name: 'Dup' })
    ).rejects.toThrow(/already|exists|taken/i)
  })

  it('rejects weak passwords and malformed emails', async () => {
    await expect(signup({ email: 'not-an-email', password: PASS, name: 'X' })).rejects.toThrow(/email/i)
    await expect(signup({ email: EMAIL, password: 'short', name: 'X' })).rejects.toThrow(/password/i)
  })

  it('login returns the user on valid credentials and fails cleanly otherwise', async () => {
    await signup({ email: EMAIL, password: PASS, name: 'Auth Tester' })
    const ok = await login({ email: EMAIL, password: PASS })
    expect(ok.user.email).toBe(EMAIL)
    await expect(login({ email: EMAIL, password: 'nope' })).rejects.toThrow(/invalid/i)
    await expect(login({ email: 'ghost@somnia.test', password: PASS })).rejects.toThrow(/invalid/i)
  })
})

describe('auth — sessions', () => {
  it('creates a session whose stored token is hashed, not plaintext', async () => {
    const { user } = await signup({ email: EMAIL, password: PASS, name: 'Auth Tester' })
    const { token } = await createSession(user.id)
    expect(token.length).toBeGreaterThanOrEqual(32)
    const stored = await db.session.findFirst({ where: { userId: user.id } })
    expect(stored).toBeTruthy()
    expect(stored!.tokenHash).not.toBe(token)
    expect(stored!.tokenHash).toHaveLength(64) // sha256 hex
  })

  it('getSessionUser resolves the user from a valid token', async () => {
    const { user } = await signup({ email: EMAIL, password: PASS, name: 'Auth Tester' })
    const { token } = await createSession(user.id)
    const resolved = await getSessionUser(token)
    expect(resolved?.id).toBe(user.id)
    expect(resolved?.email).toBe(EMAIL)
  })

  it('rejects unknown / expired tokens', async () => {
    expect(await getSessionUser('totally-unknown-token')).toBeNull()
    const { user } = await signup({ email: EMAIL, password: PASS, name: 'Auth Tester' })
    const { token } = await createSession(user.id)
    await db.session.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    expect(await getSessionUser(token)).toBeNull()
  })

  it('destroySession removes the row (logout)', async () => {
    const { user } = await signup({ email: EMAIL, password: PASS, name: 'Auth Tester' })
    const { token } = await createSession(user.id)
    await destroySession(token)
    expect(await getSessionUser(token)).toBeNull()
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0)
  })

  it('exposes the canonical cookie name', () => {
    expect(SESSION_COOKIE).toBe('somnia_session')
  })
})

describe('auth — per-user data isolation', () => {
  it('one user never sees another user\u2019s jobs in listing', async () => {
    const alice = await signup({ email: 'alice@somnia.test', password: PASS, name: 'Alice' })
    const bob = await signup({ email: 'bob@somnia.test', password: PASS, name: 'Bob' })
    await db.job.create({
      data: { userId: alice.user.id, prompt: 'alice secret', idempotencyKey: 'iso-a' },
    })
    await db.job.create({
      data: { userId: bob.user.id, prompt: 'bob secret', idempotencyKey: 'iso-b' },
    })
    const aliceJobs = await db.job.findMany({ where: { userId: alice.user.id } })
    expect(aliceJobs).toHaveLength(1)
    expect(aliceJobs[0].prompt).toBe('alice secret')
  })
})

describe('auth — OAuth scaffold (env-gated)', () => {
  it('upserts a Google user by email without a password hash', async () => {
    const u1 = await upsertOAuthUser({ email: EMAIL, name: 'Google User', avatarSeed: 'gg' })
    expect(u1.email).toBe(EMAIL)
    expect(u1.passwordHash).toBeNull()
    expect(u1.credits).toBe(1_000)
    const u2 = await upsertOAuthUser({ email: EMAIL, name: 'Google User v2', avatarSeed: 'gg' })
    expect(u2.id).toBe(u1.id)
    expect(u2.name).toBe('Google User v2')
    expect(u2.credits).toBe(1_000) // no double grant on re-link
  })
})
