// src/components/somnia/boards-app.tsx — board management (T4b).
//
// The filing cabinet: GET /api/boards lists boards with honest job counts,
// POST creates, DELETE removes (jobs survive, detached), and
// POST /api/boards/:id/share mints the public board link surfaced as
// /boards/<token>.
'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SignInInvitation } from '@/components/somnia/bits'
import type { BoardView } from '@/components/somnia/dto'
import type { SessionUser } from '@/hooks/use-session'

export interface BoardsAppProps {
  user: SessionUser | null
}

export function BoardsApp({ user }: BoardsAppProps) {
  const [boards, setBoards] = useState<BoardView[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    try {
      const res = await fetch('/api/boards', { credentials: 'same-origin' })
      if (!res.ok) return
      const body = (await res.json()) as { boards: BoardView[] }
      setBoards(body.boards)
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

  async function createBoard(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed.length < 1) {
      setError('Name the board first.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/boards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name: trimmed, description: description.trim() || undefined }),
      })
      const body = (await res.json().catch(() => null)) as
        | { board: BoardView }
        | { message?: string }
        | null
      if (!res.ok) {
        const message = body && 'message' in body && typeof body.message === 'string' ? body.message : null
        setError(message ?? 'The board could not be created.')
        return
      }
      setName('')
      setDescription('')
      await refresh()
    } catch {
      setError('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function removeBoard(board: BoardView) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/boards/${board.id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      if (!res.ok) {
        setError('The board could not be deleted.')
        return
      }
      await refresh()
    } catch {
      setError('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function shareBoard(board: BoardView) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/boards/${board.id}/share`, {
        method: 'POST',
        credentials: 'same-origin',
      })
      const body = (await res.json().catch(() => null)) as { shareToken?: string } | null
      const token = body?.shareToken
      if (!res.ok || !token) {
        setError('The share link could not be minted.')
        return
      }
      setBoards((prev) => prev.map((b) => (b.id === board.id ? { ...b, shareToken: token } : b)))
    } catch {
      setError('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!user) {
    return (
      <div className="py-16">
        <SignInInvitation what="organize your boards" />
      </div>
    )
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      {/* -------------------------------------------------------- boards */}
      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />)
        ) : boards.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
            No boards yet — file finished dreams here to keep them findable.
          </div>
        ) : (
          boards.map((board) => (
            <article
              key={board.id}
              className="rounded-xl border border-border/60 bg-card/60 p-4 transition hover:border-primary/30"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-medium tracking-tight">{board.name}</h3>
                  {board.description && (
                    <p className="mt-0.5 text-sm text-muted-foreground">{board.description}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {board.jobCount} {board.jobCount === 1 ? 'dream' : 'dreams'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {board.shareToken ? (
                    <span className="flex items-center gap-2">
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-500">
                        shared
                      </span>
                      <a
                        href={`/boards/${board.shareToken}`}
                        className="max-w-40 truncate text-xs text-primary underline-offset-4 hover:underline"
                      >
                        /boards/{board.shareToken}
                      </a>
                    </span>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => void shareBoard(board)} disabled={busy}>
                      Share
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void removeBoard(board)}
                    disabled={busy}
                    title="Delete — the dreams survive, detached"
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </article>
          ))
        )}
      </div>

      {/* ------------------------------------------------------ creation */}
      <form onSubmit={createBoard} className="space-y-4 rounded-2xl border border-border/60 bg-card/70 p-5">
        <h2 className="font-semibold tracking-tight">New board</h2>
        <div className="space-y-2">
          <Label htmlFor="board-name">Board name</Label>
          <Input
            id="board-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Neon Nocturnes"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="board-description">Description</Label>
          <Input
            id="board-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="night city moods"
          />
        </div>
        {error && (
          <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Working…' : 'Create board'}
        </Button>
        <p className="text-xs text-muted-foreground">
          Deleting a board never deletes the dreams — they detach and stay in history.
        </p>
      </form>
    </div>
  )
}
