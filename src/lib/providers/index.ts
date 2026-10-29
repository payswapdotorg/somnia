import { demoProvider } from '@/lib/providers/demo'
import { falStubProvider } from '@/lib/providers/fal-stub'
import { selfHostedProvider } from '@/lib/providers/selfhosted'
import type { ProviderRunInput, ProviderRunResult, VideoProvider } from '@/lib/providers/types'

/**
 * Resolve the active provider. The demo engine is always available; the
 * self-hosted GPU tier and the fal.ai adapter only become selectable once
 * their env vars are configured. Precedence (cost-control tier first, per
 * the architecture blueprint):
 *
 *   1. selfhosted  — SELFHOSTED_URL is set (self-hosted open models)
 *   2. fal         — FAL_KEY is set (hosted API)
 *   3. demo        — always available (local keyframes + ffmpeg composite)
 */
export function resolveProvider(): VideoProvider {
  if (selfHostedProvider.configured) return selfHostedProvider
  if (falStubProvider.configured) return falStubProvider
  return demoProvider
}

export { demoProvider, falStubProvider, selfHostedProvider }
export type { ProviderRunInput, ProviderRunResult, VideoProvider }
