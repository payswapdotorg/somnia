'use client'

import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { Loader2, Send, Sparkles, Wand2 } from 'lucide-react'
import * as React from 'react'
import type { AgentChatResponse, AgentMessageDto, AgentSuggestionDto } from '@/lib/types'

/**
 * Phase 8: Forge Agent panel — chat-to-create on the home surface.
 *
 * Users describe a vibe; the agent shapes it into a shootable prompt and can
 * attach a launchable recipe (mode / prompt / tier / aspect / duration) that
 * renders with a one-click "Forge this" button.
 */

interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
  suggestion?: AgentSuggestionDto | null
}

const STARTERS = [
  'Make my idea more cinematic',
  'A whale of glass drifting through clouds',
  'Poster for a night-market scene',
] as const

const SUGGESTION_TIER_LABEL: Record<AgentSuggestionDto['tier'], string> = {
  draft: 'Draft',
  quality: 'Quality',
}

export function AgentPanel({
  onLaunch,
  launching,
}: {
  onLaunch: (suggestion: AgentSuggestionDto) => void
  launching: boolean
}) {
  const { toast } = useToast()
  const [turns, setTurns] = React.useState<ChatTurn[]>([])
  const [input, setInput] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const bottomRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [turns, sending])

  const send = React.useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (trimmed.length < 3 || sending) return
      const userTurn: ChatTurn = { role: 'user', content: trimmed.slice(0, 800) }
      const history: AgentMessageDto[] = [...turns, userTurn]
        .map((turn) => ({ role: turn.role, content: turn.content }))
        .slice(-12)
      setTurns((prev) => [...prev, userTurn])
      setInput('')
      setSending(true)
      try {
        const response = await fetch('/api/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history }),
        })
        const data = (await response.json().catch(() => ({}))) as Partial<AgentChatResponse> & {
          error?: string
          message?: string
        }
        if (response.ok && typeof data.reply === 'string') {
          setTurns((prev) => [
            ...prev,
            { role: 'assistant', content: data.reply ?? '', suggestion: data.suggestion ?? null },
          ])
        } else if (response.status === 400 && data.error === 'moderation_refused') {
          toast({
            title: 'Message refused',
            description: 'That message was refused by our safety filter. Try rewording it.',
          })
        } else {
          toast({
            variant: 'destructive',
            title: 'Agent unavailable',
            description: (data.message as string) ?? 'The agent could not answer just now. Try again.',
          })
        }
      } catch {
        toast({
          variant: 'destructive',
          title: 'Network error',
          description: 'Could not reach the studio server. Please try again.',
        })
      } finally {
        setSending(false)
      }
    },
    [sending, toast, turns]
  )

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send(input)
    }
  }

  return (
    <section aria-label="Forge Agent chat" className="mx-auto w-full max-w-3xl">
      <div className="rf-composer rounded-3xl">
        {/* Chat transcript */}
        <div
          className="rf-scroll max-h-[420px] min-h-[220px] space-y-3 overflow-y-auto p-4 sm:p-5"
          aria-live="polite"
        >
          {turns.length === 0 && !sending && (
            <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-4 py-6 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10">
                <Sparkles className="size-6 text-primary" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-semibold">Describe the vibe — the agent shapes the shot.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  It sharpens prompts with cinematic vocabulary and can launch the forge for you.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {STARTERS.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    onClick={() => void send(starter)}
                    className="min-h-11 rounded-full border border-border bg-secondary/60 px-4 text-xs font-medium text-secondary-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    {starter}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((turn, index) => (
            <div key={index} className={`flex ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  turn.role === 'user' ? 'rf-bubble-user' : 'rf-bubble-agent'
                }`}
              >
                <p className="whitespace-pre-wrap">{turn.content}</p>
                {turn.role === 'assistant' && turn.suggestion && (
                  <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                      Ready to forge
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{turn.suggestion.prompt}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="rounded-full border border-border px-2 py-0.5">
                        {turn.suggestion.mode === 'video' ? 'Video' : 'Image'}
                      </span>
                      <span className="rounded-full border border-border px-2 py-0.5">
                        {SUGGESTION_TIER_LABEL[turn.suggestion.tier]}
                      </span>
                      <span className="rounded-full border border-border px-2 py-0.5">
                        {turn.suggestion.aspectRatio}
                      </span>
                      {turn.suggestion.mode === 'video' && (
                        <span className="rounded-full border border-border px-2 py-0.5">
                          {turn.suggestion.durationSec ?? 5}s
                        </span>
                      )}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="mt-3 h-10 gap-2 rounded-full px-4"
                      disabled={launching}
                      onClick={() => onLaunch(turn.suggestion as AgentSuggestionDto)}
                    >
                      {launching ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Wand2 className="size-4" aria-hidden="true" />
                      )}
                      Forge this
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex justify-start">
              <div className="rf-bubble-agent flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Shaping the shot…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input row */}
        <div className="flex items-center gap-2 border-t border-border/70 p-3 sm:p-4">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Tell the agent what you want to see…"
            aria-label="Message the Forge Agent"
            className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-background/60 px-4 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/50"
          />
          <Button
            type="button"
            size="icon"
            className="size-11 shrink-0 rounded-xl"
            aria-label="Send to agent"
            disabled={input.trim().length < 3 || sending}
            onClick={() => void send(input)}
          >
            <Send className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground/70">
        Agent chat is free — credits are only charged when you launch a forge.
      </p>
    </section>
  )
}
