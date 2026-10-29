import { InvalidRequestError, ModerationRefusalError } from '@/lib/errors'
import { moderatePrompt } from '@/lib/moderation'
import { DURATIONS } from '@/lib/pricing'
import type { AgentChatResponse, AgentSuggestionDto } from '@/lib/types'
import { z } from 'zod'

/**
 * Phase 8: Forge Agent — chat-to-create.
 *
 * A server-side assistant that helps users craft prompts and, when they are
 * ready, attaches a launchable creation recipe (mode / prompt / tier / aspect
 * / duration) as a JSON block the client can render with a one-click Forge
 * button. The chat itself is free; the launch charges through the normal
 * /api/generate or /api/image path.
 */

const MAX_HISTORY = 12
const MAX_MESSAGE_CHARS = 800

const AgentMessagesSchema = z
  .array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
    })
  )
  .min(1, 'At least one message is required')
  .max(MAX_HISTORY + 1, `At most ${MAX_HISTORY + 1} messages can be sent at once`)

const SuggestionSchema = z.object({
  mode: z.enum(['video', 'image']),
  prompt: z.string().trim().min(3).max(800),
  tier: z.enum(['draft', 'quality']),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']),
  durationSec: z.number().int().min(5).max(15).optional(),
})

const SYSTEM_PROMPT = `You are the Forge Agent inside Reelforge, an AI video and image studio. You help users turn rough ideas into vivid, shootable prompts.

Your style:
- Warm, direct, concise — replies under 110 words unless the user asks for more.
- Speak in concrete cinematic vocabulary: subject, action, framing, lens, motion, light, mood, palette.
- When an idea is vague, ask ONE sharp question or offer two contrasting directions.
- Improve prompts by adding specific visual detail, never by adding brand names or artist names.

When the user is ready to create (or explicitly asks you to forge/generate/make it), end your reply with a JSON code block on its own line:
\`\`\`json
{"mode": "video", "prompt": "...", "tier": "draft", "aspectRatio": "16:9", "durationSec": 5}
\`\`\`
Rules for the block: mode is "video" or "image"; prompt is the full polished prompt (not a fragment); tier "draft" for quick passes, "quality" for final looks; aspectRatio one of "16:9", "9:16", "1:1"; durationSec 5-15 for video only (omit for image). Include the block only when launching makes sense, never mid-brainstorm.`

/** Parse a trailing ```json fenced block out of a reply. */
function extractSuggestion(reply: string): { cleanReply: string; suggestion: AgentSuggestionDto | null } {
  const match = /```json\s*([\s\S]*?)\s*```\s*$/i.exec(reply.trim())
  if (!match) return { cleanReply: reply.trim(), suggestion: null }
  try {
    const parsed = SuggestionSchema.safeParse(JSON.parse(match[1]))
    if (!parsed.success) return { cleanReply: reply.trim(), suggestion: null }
    const suggestion: AgentSuggestionDto = {
      mode: parsed.data.mode,
      prompt: parsed.data.prompt,
      tier: parsed.data.tier,
      aspectRatio: parsed.data.aspectRatio,
      durationSec:
        parsed.data.mode === 'video' && DURATIONS.includes(parsed.data.durationSec as never)
          ? parsed.data.durationSec
          : parsed.data.mode === 'video'
            ? 5
            : undefined,
    }
    const cleanReply = reply.replace(/```json[\s\S]*?```\s*$/i, '').trim()
    return { cleanReply, suggestion }
  } catch {
    return { cleanReply: reply.trim(), suggestion: null }
  }
}

const FALLBACK_REPLY =
  "I could not reach the language model just now. Describe your idea in a sentence — subject, mood and motion — and I will shape it into a prompt when I am back. You can also forge directly from the Video or Image tab meanwhile."

export async function chatAgent(messages: unknown): Promise<AgentChatResponse> {
  const parsed = AgentMessagesSchema.safeParse(messages)
  if (!parsed.success) {
    throw new InvalidRequestError(parsed.error.issues[0]?.message ?? 'Invalid request')
  }
  const history = parsed.data

  // Moderation gate on the LATEST user message — fail closed, before any SDK call.
  const lastUser = [...history].reverse().find((message) => message.role === 'user')
  if (lastUser) {
    const moderation = moderatePrompt(lastUser.content)
    if (!moderation.allowed) {
      throw new ModerationRefusalError()
    }
  }

  let rawReply: string | null = null
  try {
    const { default: ZAI } = await import('z-ai-web-dev-sdk')
    const zai = await ZAI.create()
    const response = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.slice(-MAX_HISTORY).map((message) => ({ role: message.role, content: message.content })),
      ],
    })
    rawReply = response?.choices?.[0]?.message?.content ?? null
  } catch (error) {
    console.warn('[agent] chat SDK call failed:', (error as Error)?.message)
    rawReply = null
  }

  const reply = typeof rawReply === 'string' && rawReply.trim().length > 0 ? rawReply.trim() : FALLBACK_REPLY
  const { cleanReply, suggestion } = extractSuggestion(reply)
  return { reply: cleanReply, suggestion }
}
