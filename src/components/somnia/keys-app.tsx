// src/components/somnia/keys-app.tsx — sk_somnia API key management (T4b).
//
// The developer surface: GET /api/keys lists records (prefixes only —
// secrets are hashed at rest), POST /api/keys mints a key whose plaintext
// is shown exactly once, DELETE /api/keys/:id revokes. Key rows surface
// last-used and revoked state honestly.
'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SignInInvitation } from '@/components/somnia/bits'
import type { KeyView, MintedKeyView } from '@/components/somnia/dto'
import type { SessionUser } from '@/hooks/use-session'

export interface KeysAppProps {
  user: SessionUser | null
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function KeysApp({ user }: KeysAppProps) {
  const [keys, setKeys] = useState<KeyView[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [minted, setMinted] = useState<MintedKeyView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    try {
      const res = await fetch('/api/keys', { credentials: 'same-origin' })
      if (!res.ok) return
      const body = (await res.json()) as { keys: KeyView[] }
      setKeys(body.keys)
    } catch {
      // transient — the next action refreshes
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!user) {
      setLoading(false)
      return
    }
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  async function mintKey(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed.length < 1) {
      setError('Name the key first — future-you will thank you.')
      return
    }
    setBusy(true)
    setError(null)
    setMinted(null)
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name: trimmed }),
      })
      const body = (await res.json().catch(() => null)) as MintedKeyView | { message?: string } | null
      if (!res.ok || !body || !('key' in body)) {
        const message = body && 'message' in body && typeof body.message === 'string' ? body.message : null
        setError(message ?? 'The key could not be minted.')
        return
      }
      setMinted(body)
      setName('')
      await refresh()
    } catch {
      setError('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function revokeKey(key: KeyView) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/keys/${key.id}`, { method: 'DELETE', credentials: 'same-origin' })
      if (!res.ok) {
        setError('The key could not be revoked.')
        return
      }
      await refresh()
    } catch {
      setError('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!user) {
    return (
      <div className="py-16">
        <SignInInvitation what="manage API keys" />
      </div>
    )
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      {/* --------------------------------------------------------- keys */}
      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)
        ) : keys.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
            No keys yet — mint one to drive Somnia from your own scripts.
          </div>
        ) : (
          keys.map((key) => (
            <article
              key={key.id}
              className={`rounded-xl border p-4 ${
                key.revokedAt ? 'border-border/40 bg-muted/30 opacity-70' : 'border-border/60 bg-card/60'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-medium tracking-tight">{key.name}</h3>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">{key.prefix}…</p>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>created {formatDate(key.createdAt)}</span>
                  <span>last used {formatDate(key.lastUsedAt)}</span>
                  {key.revokedAt ? (
                    <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-400">
                      revoked
                    </span>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => void revokeKey(key)} disabled={busy}>
                      Revoke
                    </Button>
                  )}
                </div>
              </div>
            </article>
          ))
        )}
      </div>

      {/* -------------------------------------------------------- minting */}
      <div className="space-y-4">
        <form onSubmit={mintKey} className="space-y-4 rounded-2xl border border-border/60 bg-card/70 p-5">
          <h2 className="font-semibold tracking-tight">Mint a key</h2>
          <div className="space-y-2">
            <Label htmlFor="key-name">Key name</Label>
            <Input
              id="key-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="nightly sync"
              required
            />
          </div>
          {error && (
            <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Minting…' : 'Mint key'}
          </Button>
        </form>

        {minted && (
          <div className="space-y-2 rounded-2xl border border-primary/40 bg-primary/5 p-5">
            <p className="text-xs font-medium text-primary">
              sk_somnia key minted — the secret is only shown once, copy it now:
            </p>
            <code className="block overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs">
              {minted.key}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void navigator.clipboard?.writeText(minted.key).catch(() => {})}
            >
              Copy
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Use it as <span className="font-mono">Authorization: Bearer &lt;key&gt;</span> on every /api route.
              Secrets are hashed at rest — Somnia can never show it again.
            </p>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Every /api route accepts session cookies or a Bearer key — the same credits, the same honest pricing.
        </p>
      </div>
    </div>
  )
}
