// src/lib/apikeys.ts — Somnia developer API keys.
//
// Keys are minted with a visible prefix (`sk_somnia_…`), returned as
// plaintext exactly once, and stored only as sha256 hashes. Bearer
// resolution touches lastUsedAt; revocation is idempotent and scoped.

import { createHash, randomBytes } from 'node:crypto'
import { db } from '@/lib/db'

const KEY_PREFIX = 'sk_somnia_'

export interface ApiKeyRecord {
  id: string
  name: string
  prefix: string
  lastUsedAt: Date | null
  revokedAt: Date | null
  createdAt: Date
}

/** One-time mint view: carries the stored hash for verification. */
export interface MintedKey {
  key: string
  record: ApiKeyRecord & { hash: string }
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export async function createApiKey(
  userId: string,
  input: { name: string }
): Promise<MintedKey> {
  const name = (input.name ?? '').trim()
  if (name.length === 0) throw new Error('key name is required')
  // 32 random bytes -> 64 hex chars (44 with prefix), well past 40
  const key = `${KEY_PREFIX}${randomBytes(32).toString('hex')}`
  const record = await db.apiKey.create({
    data: {
      userId,
      name,
      prefix: key.slice(0, 13),
      hash: hashKey(key),
    },
  })
  return {
    key,
    record: {
      id: record.id,
      name: record.name,
      prefix: record.prefix,
      hash: record.hash,
      lastUsedAt: record.lastUsedAt,
      revokedAt: record.revokedAt,
      createdAt: record.createdAt,
    },
  }
}

export async function resolveApiKey(
  key: string
): Promise<{ user: { id: string; email: string; plan: string }; lastUsedAt: Date } | null> {
  if (!key || !key.startsWith(KEY_PREFIX)) return null
  const record = await db.apiKey.findUnique({ where: { hash: hashKey(key) } })
  if (!record || record.revokedAt) return null
  const lastUsedAt = new Date()
  await db.apiKey.update({ where: { id: record.id }, data: { lastUsedAt } })
  const user = await db.user.findUniqueOrThrow({
    where: { id: record.userId },
    select: { id: true, email: true, plan: true },
  })
  return { user, lastUsedAt }
}

export async function revokeApiKey(userId: string, keyId: string) {
  const record = await db.apiKey.findFirst({ where: { id: keyId, userId } })
  if (!record) throw new Error('key not found')
  if (record.revokedAt) return // idempotent
  await db.apiKey.update({
    where: { id: record.id },
    data: { revokedAt: new Date() },
  })
}

export async function listApiKeys(userId: string): Promise<ApiKeyRecord[]> {
  const rows = await db.apiKey.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    lastUsedAt: r.lastUsedAt,
    revokedAt: r.revokedAt,
    createdAt: r.createdAt,
  }))
}
