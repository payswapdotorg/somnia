// src/lib/planner.ts — LLM shot planning for agent runs (T7).
//
// Production planning decomposes a creative goal into a shot list through
// the hosted LLM tier (T13: any OpenAI-compatible endpoint, OpenRouter by
// default — src/lib/llm.ts) with the sandbox z-ai SDK as the dev-sandbox
// second chance; environments where neither initializes fall straight
// through to the deterministic angle builder in agents.ts — an LLM outage
// must never block planning. The model is asked for strict JSON, and
// parsePlannerShots treats its output as untrusted: fences are stripped,
// the outer object is located defensively, entries are shape-checked,
// prompt length is bounded, and shots are renumbered. Anything that does
// not survive becomes null -> heuristic fallback.

import { hostedChatCompletion, hostedLlmConfig } from '@/lib/llm'

export interface PlannerShot {
  shot: number
  prompt: string
  note: string
}

/** A planner produces sanitized shots (numbered on acceptance); null = decline. */
export type LlmPlanner = (goal: string, count: number) => Promise<PlannerShot[] | null>

const PROMPT_MIN = 3
const PROMPT_MAX = 500
const NOTE_MAX = 60

/** Strip markdown code fences the model may wrap its JSON in. */
function stripFences(text: string): string {
  return text
    .replace(/^\s*```[a-zA-Z]*\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim()
}

/** Locate the outermost JSON object in free-form model output. */
function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Sanitize model output into numbered shots. Returns null whenever the
 * output is not a {"shots":[{prompt,note},...]} object with at least one
 * usable entry — callers fall back to the deterministic planner.
 */
export function parsePlannerShots(
  text: string,
  _goal: string,
  _count: number
): PlannerShot[] | null {
  if (typeof text !== 'string' || text.trim().length === 0) return null
  const root = extractJsonObject(stripFences(text))
  if (!root) return null

  const rawShots: unknown = root.shots
  if (!Array.isArray(rawShots) || rawShots.length === 0) return null

  const shots: PlannerShot[] = []
  for (const entry of rawShots) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : ''
    if (prompt.length < PROMPT_MIN || prompt.length > PROMPT_MAX) continue
    const note =
      typeof record.note === 'string' && record.note.trim().length > 0
        ? record.note.trim().slice(0, NOTE_MAX)
        : 'shot'
    shots.push({ shot: shots.length + 1, prompt, note })
  }
  return shots.length > 0 ? shots : null
}

const SYSTEM_PROMPT = (count: number) =>
  'You plan cinematic AI video shot lists. Reply with ONLY JSON, no prose, ' +
  `of the exact shape {"shots":[{"prompt":"...","note":"..."}]} containing ` +
  `exactly ${count} shots. Each prompt is one dense sentence describing a ` +
  'distinct, filmable shot that serves the user goal; each note is a 1-3 ' +
  'word camera/beat label. Vary angles and pacing across shots.'

/**
 * The hosted-tier planner (T13): the OpenAI-compatible endpoint when
 * OPENROUTER_API_KEY is configured, null without traffic when not — the
 * no-key default keeps byte-for-byte the pre-T13 behavior. Exported so the
 * suite can drive it against a local gateway and inject it into
 * planAgentRun as a production-shaped planner.
 */
export async function plannerViaHosted(
  goal: string,
  count: number
): Promise<PlannerShot[] | null> {
  if (!hostedLlmConfig()) return null
  const text = await hostedChatCompletion(
    [
      { role: 'system', content: SYSTEM_PROMPT(count) },
      { role: 'user', content: goal },
    ],
    { temperature: 0.7, maxTokens: 800 }
  )
  if (!text) return null
  return parsePlannerShots(text, goal, count)
}

/** The dev-sandbox planner: dynamic z-ai SDK import, sanitized identically. */
async function plannerViaSdk(
  goal: string,
  count: number
): Promise<PlannerShot[] | null> {
  try {
    const { default: ZAI } = await import('z-ai-web-dev-sdk')
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT(count) },
        { role: 'user', content: goal },
      ],
      temperature: 0.7,
    })
    const text = completion?.choices?.[0]?.message?.content
    if (typeof text !== 'string' || text.length === 0) return null
    return parsePlannerShots(text, goal, count)
  } catch (error) {
    console.warn(
      '[planner] LLM planning unavailable, using heuristic fallback:',
      (error as Error)?.message
    )
    return null
  }
}

/**
 * The production planner: hosted LLM first, the sandbox SDK as a second
 * chance, strictly sanitized at every step. Returns null on any failure —
 * never throws. Hermetic under SOMNIA_TEST so test suites exercise the
 * fallback deterministically.
 */
export const llmPlanner: LlmPlanner = async (goal, count) => {
  if (process.env.SOMNIA_TEST) return null
  return (await plannerViaHosted(goal, count)) ?? (await plannerViaSdk(goal, count))
}
