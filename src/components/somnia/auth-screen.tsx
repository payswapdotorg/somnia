// src/components/somnia/auth-screen.tsx — page shell around AuthApp.
//
// Centers the card over a quiet gradient backdrop and routes home on
// success (the app surfaces read the session cookie from there).
'use client'

import { useRouter } from 'next/navigation'
import { AuthApp } from '@/components/somnia/auth-app'
import { BRAND } from '@/lib/brand'

export function AuthScreen() {
  const router = useRouter()

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background px-4">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(99,102,241,0.15),transparent)]"
      />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-border/60 bg-card/80 p-8 shadow-xl backdrop-blur">
        <AuthApp
          onAuthenticated={() => {
            router.push('/')
            router.refresh()
          }}
        />
        <p className="mt-8 text-center text-xs text-muted-foreground">
          {BRAND.name} — {BRAND.tagline}
        </p>
      </div>
    </main>
  )
}
