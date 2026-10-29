// src/lib/auth.ts — Somnia accounts & sessions.
//
// Email+password accounts (scrypt hashing with per-account salt, opaque
// session tokens stored only as sha256 hashes) plus an env-gated Google
// OAuth scaffold: the OAuth callback upserts a user by verified email
// without a password hash. Sessions are opaque 256-bit tokens delivered in
// an httpOnly cookie (see the API layer for cookie wiring).

import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  createHash,
} from 'node:crypto'
import { promisify } from 'node:util'
import type { User } from '@prisma/client'
import { db } from '@/lib/db'
import { ensureSignupGrant } from '@/lib/ledger'

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>

export const SESSION_COOKIE = 'somnia_session'
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000
const SCRYPT_KEYLEN = 64
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ---------------------------------------------------------------- passwords

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scrypt(password, salt, SCRYPT_KEYLEN)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const [, saltHex, hashHex] = parts
  try {
    const hash = await scrypt(password, Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN)
    const expected = Buffer.from(hashHex, 'hex')
    return hash.length === expected.length && timingSafeEqual(hash, expected)
  } catch {
    return false
  }
}

// ------------------------------------------------------------- signup/login

export interface SignupInput {
  email: string
  password: string
  name?: string
}

export async function signup(input: SignupInput): Promise<{ user: User }> {
  const email = (input.email ?? '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) throw new Error('invalid email address')
  const password = input.password ?? ''
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('password must be at least 8 characters')
  }
  const fallbackName = email.split('@')[0]
  const name = (input.name ?? '').trim() || fallbackName

  const existing = await db.user.findUnique({ where: { email } })
  if (existing) throw new Error('account already exists for this email')

  const passwordHash = await hashPassword(password)
  const created = await db.user.create({ data: { email, name, passwordHash } })
  await ensureSignupGrant(created.id)
  const user = await db.user.findUniqueOrThrow({ where: { id: created.id } })
  return { user }
}

export async function login(input: {
  email: string
  password: string
}): Promise<{ user: User }> {
  const email = (input.email ?? '').trim().toLowerCase()
  const user = await db.user.findUnique({ where: { email } })
  if (!user || !user.passwordHash) throw new Error('invalid email or password')
  const ok = await verifyPassword(input.password ?? '', user.passwordHash)
  if (!ok) throw new Error('invalid email or password')
  return { user }
}

// ----------------------------------------------------------------- sessions

export interface SessionTokens {
  token: string
  expiresAt: Date
}

export async function createSession(userId: string): Promise<SessionTokens> {
  const token = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await db.session.create({ data: { tokenHash, userId, expiresAt } })
  return { token, expiresAt }
}

export async function getSessionUser(token: string): Promise<User | null> {
  if (!token || typeof token !== 'string') return null
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const session = await db.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  })
  if (!session) return null
  if (session.expiresAt.getTime() <= Date.now()) return null
  return session.user
}

export async function destroySession(token: string): Promise<void> {
  const tokenHash = createHash('sha256').update(token).digest('hex')
  await db.session.deleteMany({ where: { tokenHash } })
}

// ------------------------------------------------------- OAuth (env-gated)

/**
 * Google OAuth scaffold: the provider callback calls this with the verified
 * profile. Creates the account on first link (with the trial grant) and
 * refreshes the profile on re-link — never a second grant, never a password.
 * Actual OAuth HTTP flow is wired in the API layer behind env vars
 * (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) and simply no-ops when unset.
 */
export async function upsertOAuthUser(input: {
  email: string
  name: string
  avatarSeed?: string
}): Promise<User> {
  const email = (input.email ?? '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) throw new Error('invalid email address')
  const existing = await db.user.findUnique({ where: { email } })
  if (existing) {
    return db.user.update({
      where: { id: existing.id },
      data: {
        name: input.name || existing.name,
        avatarSeed: input.avatarSeed ?? existing.avatarSeed,
      },
    })
  }
  const created = await db.user.create({
    data: {
      email,
      name: input.name || email.split('@')[0],
      avatarSeed: input.avatarSeed ?? 'aurora',
    },
  })
  await ensureSignupGrant(created.id)
  return db.user.findUniqueOrThrow({ where: { id: created.id } })
}
