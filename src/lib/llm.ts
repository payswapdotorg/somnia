// src/lib/llm.ts — hosted LLM client, OpenAI-compatible (T13).
//
// The sandbox z-ai SDK cannot initialize on Vercel, so production agent runs
// fell back to the deterministic heuristic planner. This module wires a REAL
// hosted LLM instead: any OpenAI-compatible /chat/completions endpoint,
// OpenRouter by default — the same env-gated, lazily-re-read contract as
// every other provider knob in the tree:
//
//   OPENROUTER_API_KEY  activates the hosted client
//   LLM_BASE_URL        overrides https://openrouter.ai/api/v1 (any
//                       OpenAI-compatible gateway works)
//   LLM_MODEL           overrides the default model id
//   LLM_TIMEOUT_MS      overrides the request timeout
//
// Without OPENROUTER_API_KEY every function is a no-op — local dev and the
// hermetic suite keep byte-for-byte the pre-T13 behavior. The client NEVER
// throws: an LLM outage must never block planning (the module contract the
// heuristic fallback in agents.ts depends on).

/** Shippable default: verified answering strict JSON on the wired account. */
export const DEFAULT_LLM_MODEL = 'meta-llama/llama-3.3-70b-instruct'

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_MAX_TOKENS = 800
const DEFAULT_TEMPERATURE = 0.7

export interface HostedLlmConfig {
  /** API root without a trailing slash (…/v1). */
  baseUrl: string
  apiKey: string
  model: string
}

/** The hosted LLM configuration, re-read from the env on every call. */
export function hostedLlmConfig(): HostedLlmConfig | null {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null
  const baseUrl = (process.env.LLM_BASE_URL ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, '')
  const model = (process.env.LLM_MODEL ?? DEFAULT_LLM_MODEL).trim()
  return { baseUrl, apiKey, model }
}

export interface HostedChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface HostedChatOptions {
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
}

function timeoutFromEnv(opts: HostedChatOptions): number {
  if (typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0) return opts.timeoutMs
  const raw = Number(process.env.LLM_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS
}

/**
 * One chat completion against the hosted tier. Returns the assistant
 * message text, or null on ANY failure (unconfigured, network error,
 * timeout, non-2xx, malformed body, missing content) — never throws, so
 * callers can fall through to the next planner in the chain.
 */
export async function hostedChatCompletion(
  messages: HostedChatMessage[],
  opts: HostedChatOptions = {}
): Promise<string | null> {
  const config = hostedLlmConfig()
  if (!config) return null

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
        max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      }),
      signal: AbortSignal.timeout(timeoutFromEnv(opts)),
    })

    if (!response.ok) {
      // Drain/release the error body so the socket is not leaked.
      await response.arrayBuffer().catch(() => undefined)
      return null
    }

    const body = (await response.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: unknown } }>
    } | null
    const text = body?.choices?.[0]?.message?.content
    if (typeof text !== 'string' || text.length === 0) return null
    return text
  } catch {
    // Network error, DNS failure, abort on timeout, body read error —
    // every failure mode declines instead of throwing.
    return null
  }
}
