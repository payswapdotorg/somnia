// src/components/somnia/auth-app.tsx — the sign-in / sign-up screen.
//
// One card, two modes. Talks the exact /api/auth/{login,signup} contract;
// the HttpOnly session cookie is set by the server on success. Client-side
// validation mirrors the server rules (email shape, 8+ char password) so
// obvious mistakes never cost a round trip.
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BRAND } from '@/lib/brand'
import type { SessionUser } from '@/hooks/use-session'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface AuthAppProps {
  onAuthenticated: (user: SessionUser) => void
}

export function AuthApp({ onAuthenticated }: AuthAppProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const isSignup = mode === 'signup'

  function toggleMode() {
    setError(null)
    setMode(isSignup ? 'signin' : 'signup')
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    // ---- client-side guard (mirrors the server's rules) ----
    if (!EMAIL_RE.test(email.trim())) {
      setError('Enter a valid email address.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    setBusy(true)
    try {
      const res = await fetch(isSignup ? '/api/auth/signup' : '/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(
          isSignup
            ? { email: email.trim(), password, name: name.trim() || undefined }
            : { email: email.trim(), password }
        ),
      })
      const body = (await res.json().catch(() => null)) as
        | { user: SessionUser }
        | { error: string; message?: string }
        | null
      if (res.ok && body && 'user' in body) {
        onAuthenticated(body.user)
        return
      }
      setError(
        (body && 'message' in body && body.message) ||
          'Something went wrong — please try again.'
      )
    } catch {
      setError('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-lg font-bold text-white shadow-lg">
          S
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {isSignup ? 'Create your account' : 'Welcome back'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isSignup
            ? `Start dreaming in motion — ${BRAND.tagline}`
            : `Sign in to ${BRAND.name} to keep creating`}
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="auth-email">Email</Label>
          <Input
            id="auth-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        {isSignup && (
          <div className="space-y-2">
            <Label htmlFor="auth-name">Name</Label>
            <Input
              id="auth-name"
              type="text"
              autoComplete="name"
              placeholder="How should we greet you?"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="auth-password">Password</Label>
          <Input
            id="auth-password"
            type="password"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Just a moment…' : isSignup ? 'Create account' : 'Sign in'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {isSignup ? 'Already dreaming with us?' : `New to ${BRAND.name}?`}{' '}
        <button
          type="button"
          onClick={toggleMode}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {isSignup ? 'Sign in' : 'Sign up'}
        </button>
      </p>
    </div>
  )
}
