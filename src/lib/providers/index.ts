// src/lib/providers/index.ts — hosted provider resolution (T6a).
//
// Precedence (cost-control tier first, per the architecture blueprint):
//
//   1. selfhosted  — SELFHOSTED_URL is set (self-hosted open models)
//   2. fal         — FAL_KEY is set (hosted API)
//   3. null        — no hosted tier: the local demo pipeline renders
//                    (FrameSource keyframes + ffmpeg Ken Burns composite)
//
// `configured` is a dynamic getter on both adapters, so resolution re-reads
// the environment every call — tests (and runtime env changes) toggle tiers
// without module reloads.

import { selfHostedProvider } from '@/lib/providers/selfhosted'
import { falProvider } from '@/lib/providers/fal'
import type { HostedVideoProvider } from '@/lib/providers/types'

/** The active hosted tier, or null when renders stay local (demo pipeline). */
export function resolveVideoProvider(): HostedVideoProvider | null {
  if (selfHostedProvider.configured) return selfHostedProvider
  if (falProvider.configured) return falProvider
  return null
}

export { selfHostedProvider, falProvider }
export type {
  HostedRenderInput,
  HostedRenderOptions,
  HostedRenderResult,
  HostedVideoProvider,
} from '@/lib/providers/types'
