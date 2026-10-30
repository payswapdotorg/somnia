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
/**
 * Floor for the 402 budget retry: a single sanitized shot needs ~60-80
 * tokens plus JSON wrapper, so an affordable budget below this cannot carry
 * a usable answer — decline instead of a doomed truncation.
 */
const MIN_RETRY_TOKENS = 120

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
 *
 * Budget-aware retry: OpenRouter's credit pre-flight reserves max_tokens
 * worth of credit, so a low-balance key rejects e.g. 800 tokens even though
 * the actual generation costs a fraction of it. On a 402 whose remedy hint
 * names an affordable budget ("…can only afford 300") the request is retried
 * ONCE at that budget — below MIN_RETRY_TOKENS, or without the hint, it
 * declines (the heuristic fallback stays the honest floor).
 */
export async function hostedChatCompletion(
  messages: HostedChatMessage[],
  opts: HostedChatOptions = {}
): Promise<string | null> {
  const config = hostedLlmConfig()
  if (!config) return null

  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS
  const temperature = opts.temperature ?? DEFAULT_TEMPERATURE

  const post = (budget: number) =>
    fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: config.model, messages, temperature, max_tokens: budget }),
      signal: AbortSignal.timeout(timeoutFromEnv(opts)),
    })

  try {
    let response = await post(maxTokens)

    if (response.status === 402) {
      const errorText = await response.text().catch(() => '')
      const affordable = /can only afford (\d+)/.exec(errorText)
      const budget = affordable ? Number(affordable[1]) : 0
      if (budget >= MIN_RETRY_TOKENS && budget < maxTokens) {
        response = await post(budget)
      } else {
        console.warn(
          `[llm] hosted chat 402 (credits): retry budget ${budget} unusable, declining`
        )
      }
    }

    if (!response.ok) {
      // Drain/release the error body so the socket is not leaked.
      await response.arrayBuffer().catch(() => undefined)
      console.warn(`[llm] hosted chat declined with status ${response.status}`)
      return null
    }

    const body = (await response.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: unknown } }>
    } | null
    const text = body?.choices?.[0]?.message?.content
    if (typeof text !== 'string' || text.length === 0) return null
    return text
  } catch (error) {
    // Network error, DNS failure, abort on timeout, body read error —
    // every failure mode declines instead of throwing.
    console.warn(
      '[llm] hosted chat unavailable, declining:',
      (error as Error)?.message
    )
    return null
  }
}
