// tests/llm.test.ts — hosted LLM provider wiring for agent planning (T13).
//
// The z-ai sandbox SDK cannot initialize on Vercel, so production agent runs
// fell back to the deterministic heuristic planner. T13 wires a real hosted
// LLM — any OpenAI-compatible chat endpoint, OpenRouter by default — behind
// the same env contract as every other provider knob:
//
//   OPENROUTER_API_KEY  activates the hosted client (lazily re-read)
//   LLM_BASE_URL        overrides https://openrouter.ai/api/v1
//   LLM_MODEL           overrides the default model id
//   LLM_TIMEOUT_MS      overrides the request timeout
//
// Unconfigured = byte-for-byte the pre-T13 behavior. The client NEVER throws
// — an LLM outage must never block planning (the module contract the
// heuristic fallback depends on). Hermetic: a local OpenAI-compatible
// gateway serves every completion; no real network is touched.
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { db } from '@/lib/db'
import { signup } from '@/lib/auth'
import { planAgentRun } from '@/lib/agents'
import { getProviderHealth } from '@/lib/health'
import {
  hostedLlmConfig,
  hostedChatCompletion,
  DEFAULT_LLM_MODEL,
} from '@/lib/llm'
import { plannerViaHosted, llmPlanner } from '@/lib/planner'

const ENV_KEYS = [
  'OPENROUTER_API_KEY',
  'LLM_BASE_URL',
  'LLM_MODEL',
  'LLM_TIMEOUT_MS',
  'SOMNIA_TEST',
] as const

const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  gateway.script = [] // any unconsumed scripted answers must not leak into the next spec
})

// ------------------------------------------------------------ fake LLM gateway

interface ObservedRequest {
  url: string
  method: string
  authorization: string | null
  contentType: string | null
  body: Record<string, unknown>
}

/**
 * Minimal OpenAI-compatible chat endpoint: every POST /chat/completions is
 * recorded and answered from `script` (status + content) — defaulting to a
 * valid two-shot plan.
 */
class FakeLlmGateway {
  server: http.Server
  port = 0
  calls: ObservedRequest[] = []
  /** Each entry answers one request ({ status, content, body, delayMs }); default answers are valid two-shot plans. */
  script: Array<{ status?: number; content?: string; body?: unknown; delayMs?: number }> = []

  constructor() {
    this.server = http.createServer((req, res) => {
      void this.handle(req, res)
    })
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}/v1`
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = req.url ?? '/'
    const method = req.method ?? 'GET'

    if (method === 'POST' && url === '/v1/chat/completions') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      let body: Record<string, unknown> = {}
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        body = {}
      }
      this.calls.push({
        url,
        method,
        authorization: req.headers.authorization ?? null,
        contentType: req.headers['content-type'] ?? null,
        body,
      })
      const next =
        this.script.shift() ?? {
          content: JSON.stringify({
            shots: [
              { prompt: 'anamorphic dusk cityscape, neon reflections in wet asphalt', note: 'establishing' },
              { prompt: 'close on a paper lantern swaying, shallow focus', note: 'detail insert' },
            ],
          }),
        }
      if (next.delayMs) await new Promise((r) => setTimeout(r, next.delayMs))
      const status = next.status ?? 200
      res.writeHead(status, { 'content-type': 'application/json' })
      if (next.body !== undefined) res.end(JSON.stringify(next.body))
      else
        res.end(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: next.content ?? '' } }],
          })
        )
      return
    }

    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  }

  async start(): Promise<this> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve))
    this.port = (this.server.address() as AddressInfo).port
    return this
  }

  async close(): Promise<void> {
    // fetch keep-alive sockets would otherwise hold close() open.
    this.server.closeIdleConnections()
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }
}

let gateway: FakeLlmGateway

beforeAll(async () => {
  gateway = await new FakeLlmGateway().start()
})

afterAll(async () => {
  await gateway.close()
})

// ------------------------------------------------------------ config detection

describe('llm — hostedLlmConfig', () => {
  it('is null without OPENROUTER_API_KEY (the no-key default is the old behavior)', () => {
    expect(hostedLlmConfig()).toBeNull()
  })

  it('re-reads the env lazily per call', () => {
    expect(hostedLlmConfig()).toBeNull()
    process.env.OPENROUTER_API_KEY = 'or-test-key'
    expect(hostedLlmConfig()).not.toBeNull()
    delete process.env.OPENROUTER_API_KEY
    expect(hostedLlmConfig()).toBeNull()
  })

  it('defaults to the OpenRouter base URL and the default model', () => {
    process.env.OPENROUTER_API_KEY = 'or-test-key'
    const config = hostedLlmConfig()!
    expect(config.baseUrl).toBe('https://openrouter.ai/api/v1')
    expect(config.apiKey).toBe('or-test-key')
    expect(config.model).toBe(DEFAULT_LLM_MODEL)
  })

  it('honors LLM_BASE_URL (trailing slash trimmed) and LLM_MODEL overrides', () => {
    process.env.OPENROUTER_API_KEY = 'or-test-key'
    process.env.LLM_BASE_URL = `${gateway.url}/`
    process.env.LLM_MODEL = 'deepseek/deepseek-chat'
    const config = hostedLlmConfig()!
    expect(config.baseUrl).toBe(gateway.url)
    expect(config.model).toBe('deepseek/deepseek-chat')
  })
})

// ------------------------------------------------------------ completion client

describe('llm — hostedChatCompletion', () => {
  it('returns null without any HTTP traffic when unconfigured', async () => {
    const callsBefore = gateway.calls.length
    expect(await hostedChatCompletion([{ role: 'user', content: 'hi' }])).toBeNull()
    expect(gateway.calls.length).toBe(callsBefore)
  })

  it('POSTs the OpenAI-compatible shape and returns the message content', async () => {
    process.env.OPENROUTER_API_KEY = 'or-test-key'
    process.env.LLM_BASE_URL = gateway.url
    process.env.LLM_MODEL = 'meta-llama/llama-3.3-70b-instruct'

    const text = await hostedChatCompletion(
      [
        { role: 'system', content: 'sys-prompt' },
        { role: 'user', content: 'user-goal' },
      ],
      { temperature: 0.7, maxTokens: 800 }
    )

    expect(text).toBeTruthy()
    expect(gateway.calls.length).toBe(1)
    const request = gateway.calls[0]!
    expect(request.method).toBe('POST')
    expect(request.url).toBe('/v1/chat/completions')
    expect(request.authorization).toBe('Bearer or-test-key')
    expect(request.contentType).toBe('application/json')
    expect(request.body.model).toBe('meta-llama/llama-3.3-70b-instruct')
    expect(request.body.messages).toEqual([
      { role: 'system', content: 'sys-prompt' },
      { role: 'user', content: 'user-goal' },
    ])
    expect(request.body.temperature).toBe(0.7)
    expect(request.body.max_tokens).toBe(800)
  })

  it('never throws on a non-2xx gateway answer — null instead', async () => {
    process.env.OPENROUTER_API_KEY = 'or-test-key'
    process.env.LLM_BASE_URL = gateway.url
    gateway.script = [{ status: 500, body: { error: { message: 'provider exploded' } } }]
    expect(await hostedChatCompletion([{ role: 'user', content: 'x' }])).toBeNull()
    gateway.script = [{ status: 401, body: { error: { message: 'bad key' } } }]
    expect(await hostedChatCompletion([{ role: 'user', content: 'x' }])).toBeNull()
    gateway.script = []
  })

  it('never throws on malformed JSON bodies or missing content', async () => {
    process.env.OPENROUTER_API_KEY = 'or-test-key'
    process.env.LLM_BASE_URL = gateway.url
    gateway.script = [{ status: 200, body: 'not-json' }]
    expect(await hostedChatCompletion([{ role: 'user', content: 'x' }])).toBeNull()
    gateway.script = [{ status: 200, body: { choices: [] } }]
    expect(await hostedChatCompletion([{ role: 'user', content: 'x' }])).toBeNull()
    gateway.script = [{ status: 200, body: { choices: [{ message: {} }] } }]
    expect(await hostedChatCompletion([{ role: 'user', content: 'x' }])).toBeNull()
    gateway.script = [{ status: 200, body: { choices: [{ message: { content: '' } }] } }]
    expect(await hostedChatCompletion([{ role: 'user', content: 'x' }])).toBeNull()
    gateway.script = []
  })

  it('never throws on a network error (unreachable endpoint)', async () => {
    // A port that was open, then closed — guaranteed connection refused.
    const dead = await new FakeLlmGateway().start()
    const deadUrl = dead.url
    await dead.close()

    process.env.OPENROUTER_API_KEY = 'or-test-key'
    process.env.LLM_BASE_URL = deadUrl
    expect(await hostedChatCompletion([{ role: 'user', content: 'x' }])).toBeNull()
  })

  it('gives up at LLM_TIMEOUT_MS instead of blocking planning forever', async () => {
    process.env.OPENROUTER_API_KEY = 'or-test-key'
    process.env.LLM_BASE_URL = gateway.url
    process.env.LLM_TIMEOUT_MS = '150'
    gateway.script = [{ content: 'late answer', delayMs: 1200 }]
    expect(await hostedChatCompletion([{ role: 'user', content: 'x' }])).toBeNull()
    gateway.script = []
  })
})

// ------------------------------------------------------------------- planner

describe('llm — plannerViaHosted', () => {
  it('parses a clean JSON answer into sanitized numbered shots', async () => {
    process.env.OPENROUTER_API_KEY = 'or-test-key'
    process.env.LLM_BASE_URL = gateway.url
    const shots = await plannerViaHosted('a goal', 2)
    expect(shots).not.toBeNull()
    expect(shots!.length).toBe(2)
    expect(shots![0]!.shot).toBe(1)
    expect(shots![0]!.prompt).toContain('anamorphic dusk cityscape')
    expect(shots![1]!.shot).toBe(2)
  })

  it('strips markdown fences some models wrap their JSON in', async () => {
    process.env.OPENROUTER_API_KEY = 'or-test-key'
    process.env.LLM_BASE_URL = gateway.url
    gateway.script = [
      { content: '```json\n{"shots":[{"prompt":"foggy harbor at first light","note":"wide"}]}\n```' },
    ]
    const shots = await plannerViaHosted('a goal', 1)
    expect(shots).not.toBeNull()
    expect(shots![0]!.prompt).toBe('foggy harbor at first light')
    gateway.script = []
  })

  it('declines (null) on prose, feeding the heuristic fallback', async () => {
    process.env.OPENROUTER_API_KEY = 'or-test-key'
    process.env.LLM_BASE_URL = gateway.url
    gateway.script = [{ content: 'Sure! Here is a plan: first we...' }]
    expect(await plannerViaHosted('a goal', 2)).toBeNull()
    gateway.script = []
  })

  it('declines (null) without traffic when unconfigured', async () => {
    const callsBefore = gateway.calls.length
    expect(await plannerViaHosted('a goal', 2)).toBeNull()
    expect(gateway.calls.length).toBe(callsBefore)
  })
})

describe('llm — llmPlanner chain', () => {
  it('stays hermetic under SOMNIA_TEST even when a key is configured', async () => {
    process.env.SOMNIA_TEST = '1'
    process.env.OPENROUTER_API_KEY = 'or-test-key'
    process.env.LLM_BASE_URL = gateway.url
    const callsBefore = gateway.calls.length
    expect(await llmPlanner('a goal', 2)).toBeNull()
    expect(gateway.calls.length).toBe(callsBefore)
  })

  it('answers through the hosted tier first when not under test', async () => {
    delete process.env.SOMNIA_TEST // restored by afterEach
    process.env.OPENROUTER_API_KEY = 'or-test-key'
    process.env.LLM_BASE_URL = gateway.url
    const shots = await llmPlanner('a goal', 2)
    expect(shots).not.toBeNull()
    expect(shots![0]!.prompt).toContain('anamorphic dusk cityscape')
    expect(gateway.calls.length).toBeGreaterThan(0)
  })
})

// ------------------------------------------------------------------- health

describe('llm — health surface', () => {
  it('reports llmConfigured=false / llmModel=null unconfigured', async () => {
    const health = await getProviderHealth()
    expect(health.llmConfigured).toBe(false)
    expect(health.llmModel).toBeNull()
  })

  it('reports llmConfigured=true with the model as a display string when wired', async () => {
    process.env.OPENROUTER_API_KEY = 'or-test-key'
    process.env.LLM_MODEL = 'meta-llama/llama-3.3-70b-instruct'
    const health = await getProviderHealth()
    expect(health.llmConfigured).toBe(true)
    expect(health.llmModel).toBe('meta-llama/llama-3.3-70b-instruct')
  })
})

// --------------------------------------------------- agent-run integration

describe('llm — agent run planned by the hosted tier', () => {
  it('records planner "llm" with sanitized, capped shots from the gateway', async () => {
    process.env.OPENROUTER_API_KEY = 'or-test-key'
    process.env.LLM_BASE_URL = gateway.url
    // The trial plan caps variations at 2 — the gateway offers 3, the run
    // must keep the first two and renumber.
    gateway.script = [
      {
        content: JSON.stringify({
          shots: [
            { prompt: 'crane shot over a copper desert at dawn', note: 'establishing' },
            { prompt: 'macro of dew on a widow spider web', note: 'detail' },
            { prompt: 'silhouette entering a doorway of light', note: 'payoff' },
          ],
        }),
      },
    ]

    const { user } = await signup({
      email: `llm${Date.now()}@somnia.test`,
      password: 'password123',
    })
    const { run, plan } = await planAgentRun(user.id, 'a copper desert morning', {
      planner: plannerViaHosted,
    })

    expect(run.planner).toBe('llm')
    expect(plan.length).toBe(2) // trial cap
    expect(plan[0]!.shot).toBe(1)
    expect(plan[0]!.prompt).toContain('crane shot over a copper desert')
    expect(plan[1]!.shot).toBe(2)
    expect(plan[1]!.prompt).toContain('dew on a widow spider web')

    const stored = await db.agentRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(stored.planner).toBe('llm')
    expect(JSON.parse(stored.planJson!).length).toBe(2)
    gateway.script = []
  })
})
