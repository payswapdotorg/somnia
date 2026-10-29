// src/hooks/use-session.ts — browser session state on top of /api/auth/*.
//
// The server owns the truth (HttpOnly cookie); this hook just reflects it:
// `refresh()` re-reads /api/auth/me, `signOut()` posts the logout route.
'use client'

import { useCallback, useEffect, useState } from 'react'

export interface SessionUser {
  id: string
  email: string
  name: string
  avatarSeed: string
  plan: string
  credits: number
  createdAt: string
}

export interface SessionState {
  user: SessionUser | null
  loading: boolean
  refresh: () => Promise<SessionUser | null>
  signOut: () => Promise<void>
}

export function useSession(): SessionState {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async (): Promise<SessionUser | null> => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' })
      if (res.ok) {
        const body = (await res.json()) as { user: SessionUser }
        setUser(body.user)
        return body.user
      }
    } catch {
      // network hiccup — keep the last known state
    }
    setUser(null)
    return null
  }, [])

  const signOut = useCallback(async (): Promise<void> => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    } finally {
      setUser(null)
    }
  }, [])

  useEffect(() => {
    void refresh().finally(() => setLoading(false))
  }, [refresh])

  return { user, loading, refresh, signOut }
}
