// src/components/somnia/explore-app.tsx — the public ideas feed (T4b).
//
// Everyone's shared, completed renders in one scroll: GET /api/ideas with
// page-based offset pagination, hover-to-play video cards with author and
// like state, and the session-aware like/unlike contract (signed-out likes
// invite sign-in instead of hitting the API).
'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { AvatarBlob, MetaChip } from '@/components/somnia/bits'
import { aspectClass, type FeedItemView } from '@/components/somnia/dto'
import type { SessionUser } from '@/hooks/use-session'

const PAGE_SIZE = 24

export interface ExploreAppProps {
  /** Signed-in viewer (enables likes); null renders the public feed. */
  viewer?: SessionUser | null
}

export function ExploreApp({ viewer }: ExploreAppProps) {
  const [items, setItems] = useState<FeedItemView[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [signInPrompt, setSignInPrompt] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const page = useRef(0)

  async function loadPage(target: number, append: boolean): Promise<void> {
    const offset = target * PAGE_SIZE
    try {
      const res = await fetch(`/api/ideas?limit=${PAGE_SIZE}&offset=${offset}`, {
        credentials: 'same-origin',
      })
      if (!res.ok) throw new Error('feed unavailable')
      const body = (await res.json()) as { items: FeedItemView[]; total: number }
      setTotal(body.total)
      setItems((prev) => (append ? [...prev, ...body.items] : body.items))
      page.current = target
      setError(null)
    } catch {
      setError('The ideas feed could not be loaded — please retry.')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    void loadPage(0, false)
  }, [])

  async function toggleLike(item: FeedItemView) {
    if (!viewer) {
      setSignInPrompt(true)
      return
    }
    const liked = item.likedByMe
    // optimistic flip — the server count reconciles on response
    setItems((prev) =>
      prev.map((it) =>
        it.id === item.id
          ? { ...it, likedByMe: !liked, likeCount: it.likeCount + (liked ? -1 : 1) }
          : it
      )
    )
    try {
      const res = await fetch(`/api/jobs/${item.id}/like`, {
        method: liked ? 'DELETE' : 'POST',
        credentials: 'same-origin',
      })
      if (!res.ok) throw new Error('like failed')
      const body = (await res.json()) as { liked: boolean; count: number }
      setItems((prev) =>
        prev.map((it) =>
          it.id === item.id ? { ...it, likedByMe: body.liked, likeCount: body.count } : it
        )
      )
    } catch {
      // revert on failure
      setItems((prev) =>
        prev.map((it) =>
          it.id === item.id
            ? { ...it, likedByMe: liked, likeCount: it.likeCount + (liked ? 1 : -1) }
            : it
        )
      )
    }
  }

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-video animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    )
  }

  if (error && !items.length) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        {error}{' '}
        <Button variant="outline" size="sm" onClick={() => void loadPage(0, false)}>
          Retry
        </Button>
      </div>
    )
  }

  if (!items.length) {
    return (
      <div className="py-16 text-center">
        <h2 className="text-lg font-semibold tracking-tight">The feed is quiet — for now</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Share a finished dream from your history and it will land here for everyone to find.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {signInPrompt && (
        <p className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm">
          <Link href="/signin" className="font-medium text-primary underline-offset-4 hover:underline">
            Sign in to like
          </Link>{' '}
          dreams and keep your favorites.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <article
            key={item.id}
            className="group overflow-hidden rounded-xl border border-border/60 bg-card/60 transition hover:border-primary/40"
          >
            <div className={`relative ${aspectClass(item.aspectRatio)} bg-black`}>
              {item.videoPath && (
                <video
                  data-testid="feed-video"
                  src={item.videoPath}
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  className="size-full cursor-pointer object-cover opacity-90 transition group-hover:opacity-100"
                  onMouseEnter={(e) => {
                    const el = e.currentTarget
                    if (typeof el.play === 'function') void el.play().catch(() => {})
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget
                    if (typeof el.pause === 'function') el.pause()
                  }}
                />
              )}
            </div>
            <div className="space-y-3 p-4">
              <p className="line-clamp-2 text-sm">{item.prompt}</p>
              <div className="flex flex-wrap gap-2">
                <MetaChip>{item.model}</MetaChip>
                <MetaChip>{item.aspectRatio}</MetaChip>
                {item.durationSec > 0 && <MetaChip>{item.durationSec}s</MetaChip>}
                {item.loop && <MetaChip>loop</MetaChip>}
                {item.placeholderRender && <MetaChip>simulated render</MetaChip>}
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <AvatarBlob seed={item.author.avatarSeed} name={item.author.name} size="sm" />
                  {item.author.name}
                </span>
                <button
                  type="button"
                  onClick={() => void toggleLike(item)}
                  aria-pressed={item.likedByMe}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition ${
                    item.likedByMe
                      ? 'bg-rose-500/15 text-rose-400'
                      : 'border border-border/60 text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span aria-hidden="true">{item.likedByMe ? '♥' : '♡'}</span>
                  <span>{item.likedByMe ? 'Unlike' : 'Like'}</span>
                  <span>{item.likeCount}</span>
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {items.length < total && (
        <div className="text-center">
          <Button
            variant="outline"
            onClick={() => {
              setLoadingMore(true)
              void loadPage(page.current + 1, true)
            }}
            disabled={loadingMore}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  )
}
