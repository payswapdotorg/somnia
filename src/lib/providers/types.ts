import type { AspectRatio, Tier } from '@/lib/pricing'

/** Everything a provider needs to run one generation job. */
export interface ProviderRunInput {
  jobId: string
  prompt: string
  tier: Tier
  durationSec: number
  aspectRatio: AspectRatio
  startFramePath: string | null
  /** Phase 2: optional pinned end frame (public-relative path). */
  endFramePath: string | null
}

/**
 * Optional result contract: providers that produce a finished video clip
 * return its public-relative path here (and are expected to persist it).
 * Kept optional so queue-style adapters (fal stub) can complete without one.
 */
export interface ProviderRunResult {
  videoPath?: string | null
}

export interface VideoProvider {
  name: string
  configured: boolean
  runJob: (input: ProviderRunInput) => Promise<ProviderRunResult | void>
}
