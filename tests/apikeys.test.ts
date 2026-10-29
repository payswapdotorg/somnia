// tests/apikeys.test.ts — TDD RED first.
// Developer API keys: mint (shown once, stored hashed), Bearer resolution
// with lastUsedAt touch, revocation, and idempotency of the public generate
// contract via key auth.
import { describe, expect, it, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import {
  createApiKey,
  resolveApiKey,
  revokeApiKey,
  listApiKeys,
} from '@/lib/apikeys'

const EMAIL = 'apikey-test@somnia.test'

async function seedUser(credits = 10_000) {
  return db.user.create({ data: { email: EMAIL, name: 'Key Tester', credits } })
}

beforeEach(async () => {
  await db.user.deleteMany({ where: { email: EMAIL } })
})

describe('apikeys — minting', () => {
  it('returns a prefixed plaintext key exactly once and stores only its hash', async () => {
    const user = await seedUser()
    const { key, record } = await createApiKey(user.id, { name: 'CI pipeline' })
    expect(key.startsWith('sk_somnia_')).toBe(true)
    expect(key.length).toBeGreaterThan(40)
    expect(record.hash).not.toBe(key)
    expect(record.hash).toHaveLength(64) // sha256 hex
    expect(record.prefix).toBe(key.slice(0, 13))
    expect(record.revokedAt).toBeNull()
  })

  it('lists keys without ever exposing the hash or plaintext', async () => {
    const user = await seedUser()
    await createApiKey(user.id, { name: 'One' })
    await createApiKey(user.id, { name: 'Two' })
    const keys = await listApiKeys(user.id)
    expect(keys).toHaveLength(2)
    for (const k of keys) {
      expect(k.name).toBeTruthy()
      expect(k.prefix).toMatch(/^sk_somnia_/)
      expect(k.hash).toBeUndefined()
    }
  })
})

describe('apikeys — Bearer resolution', () => {
  it('resolves the owning user and touches lastUsedAt', async () => {
    const user = await seedUser()
    const { key } = await createApiKey(user.id, { name: 'Bearer test' })
    const resolved = await resolveApiKey(key)
    expect(resolved?.user.id).toBe(user.id)
    expect(resolved?.lastUsedAt).toBeTruthy()
  })

  it('rejects unknown, malformed and revoked keys', async () => {
    const user = await seedUser()
    expect(await resolveApiKey('sk_somnia_nope')).toBeNull()
    expect(await resolveApiKey('garbage')).toBeNull()
    expect(await resolveApiKey('')).toBeNull()
    const { key, record } = await createApiKey(user.id, { name: 'Doomed' })
    await revokeApiKey(user.id, record.id)
    expect(await resolveApiKey(key)).toBeNull()
  })

  it('revocation is idempotent and scoped to the owner', async () => {
    const user = await seedUser()
    const other = await db.user.create({
      data: { email: 'other@somnia.test', name: 'Other' },
    })
    const { record } = await createApiKey(user.id, { name: 'Mine' })
    await expect(revokeApiKey(other.id, record.id)).rejects.toThrow(/not found/i)
    await revokeApiKey(user.id, record.id)
    await revokeApiKey(user.id, record.id) // no-op, no throw
    const rows = await db.apiKey.findMany({ where: { userId: user.id } })
    expect(rows[0].revokedAt).toBeTruthy()
  })
})
