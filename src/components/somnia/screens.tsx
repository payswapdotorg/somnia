// src/components/somnia/screens.tsx — client page shells (T4b).
//
// Every Somnia page is a thin server component with metadata that mounts
// one of these client screens; each screen owns the session (useSession),
// wraps the AppShell navigation and hands the user down to its app. The
// create screen also consumes the one-shot remix prefill hand-off from the
// history surface.
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/hooks/use-session'
import { AppShell } from '@/components/somnia/app-shell'
import { CreateApp } from '@/components/somnia/create-app'
import { ExploreApp } from '@/components/somnia/explore-app'
import { HistoryApp } from '@/components/somnia/history-app'
import { BoardsApp } from '@/components/somnia/boards-app'
import { KeysApp } from '@/components/somnia/keys-app'
import { PlansApp } from '@/components/somnia/plans-app'
import { AgentsApp } from '@/components/somnia/agents-app'
import { LandingApp } from '@/components/somnia/landing'
import type { RemixPrefill } from '@/components/somnia/dto'

const REMIX_STORAGE_KEY = 'somnia:remix'

/** One-shot hand-off: the history surface parks the remix prefill here. */
function useRemixPrefill(): RemixPrefill | null {
  const [prefill, setPrefill] = useState<RemixPrefill | null>(null)
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(REMIX_STORAGE_KEY)
      if (raw) {
        window.sessionStorage.removeItem(REMIX_STORAGE_KEY)
        setPrefill(JSON.parse(raw) as RemixPrefill)
      }
    } catch {
      // malformed hand-off — ignore it
    }
  }, [])
  return prefill
}

function PageHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  )
}

export function CreateScreen() {
  const { user, loading, refresh, signOut } = useSession()
  const router = useRouter()
  const prefill = useRemixPrefill()

  // Signed-out visitors get the marketing landing (hero, pillars, public
  // plan catalogue) instead of the composer. While the session probe is in
  // flight the app shell skeleton shows — no landing flash for signed-in
  // makers, no composer flash for strangers.
  if (!loading && !user) return <LandingApp />

  return (
    <AppShell
      user={user}
      loading={loading}
      current="create"
      signOut={() => {
        void signOut().then(() => router.push('/'))
      }}
    >
      {prefill && (
        <p className="mb-4 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm text-primary">
          Remix loaded into the composer — adjust the recipe and dream it yourself. Nothing is charged until you submit.
        </p>
      )}
      <PageHeading
        title="What will you dream today?"
        subtitle="Prompt to clip with a 16-keyframe timeline, or a prism still — honest credits, refunds on failure."
      />
      <CreateApp user={user} prefill={prefill} onCreditsChanged={() => void refresh()} />
    </AppShell>
  )
}

export function ExploreScreen() {
  const { user, loading, signOut } = useSession()
  return (
    <AppShell user={user} loading={loading} current="explore">
      <PageHeading
        title="Explore the ideas feed"
        subtitle="Shared dreams from the community — hover to play, like what moves you, remix anything."
      />
      <ExploreApp viewer={user} />
    </AppShell>
  )
}

export function HistoryScreen() {
  const { user, loading, signOut } = useSession()
  return (
    <AppShell user={user} loading={loading} current="history">
      <PageHeading
        title="Your history"
        subtitle="Every dream with its recipe — extend, modify, reframe, upscale, share unlisted or remix."
      />
      <HistoryApp user={user} />
    </AppShell>
  )
}

export function BoardsScreen() {
  const { user, loading, signOut } = useSession()
  const router = useRouter()
  return (
    <AppShell
      user={user}
      loading={loading}
      current="boards"
      signOut={() => {
        void signOut().then(() => router.push('/'))
      }}
    >
      <PageHeading
        title="Boards"
        subtitle="File finished dreams into boards, share a board with one unlisted link."
      />
      <BoardsApp user={user} />
    </AppShell>
  )
}

export function KeysScreen() {
  const { user, loading, signOut } = useSession()
  const router = useRouter()
  return (
    <AppShell
      user={user}
      loading={loading}
      current="keys"
      signOut={() => {
        void signOut().then(() => router.push('/'))
      }}
    >
      <PageHeading
        title="API keys"
        subtitle="Drive Somnia from your own scripts — sk_somnia keys, hashed at rest, revocable any time."
      />
      <KeysApp user={user} />
    </AppShell>
  )
}

export function PlansScreen() {
  const { user, loading, signOut } = useSession()
  const router = useRouter()
  return (
    <AppShell
      user={user}
      loading={loading}
      current="plans"
      signOut={() => {
        void signOut().then(() => router.push('/'))
      }}
    >
      <PlansApp user={user} />
    </AppShell>
  )
}

export function AgentsScreen() {
  const { user, loading, refresh, signOut } = useSession()
  const router = useRouter()
  return (
    <AppShell
      user={user}
      loading={loading}
      current="agents"
      signOut={() => {
        void signOut().then(() => router.push('/'))
      }}
    >
      <PageHeading
        title="Agents"
        subtitle="Describe a goal — the agent plans the shots, you dispatch them, the credits stay honest."
      />
      <AgentsApp user={user} onCreditsChanged={() => void refresh()} />
    </AppShell>
  )
}
