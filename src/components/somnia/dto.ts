// src/components/somnia/dto.ts — client-safe view types for the Somnia API.
//
// Mirrors the JSON the /api routes actually return (Prisma rows serialized
// through Response.json, so dates arrive as strings). Deliberately free of
// server-only imports so every client component can share it.

export type JobStatus =
  | 'queued'
  | 'dispatched'
  | 'running'
  | 'moderated'
  | 'completed'
  | 'failed'

export const TERMINAL_STATUSES: JobStatus[] = ['completed', 'failed', 'moderated']

export interface AssetView {
  id: string
  jobId: string
  kind: string // startFrame | endFrame | frame | video | poster | reframe | upscale
  path: string
  label: string | null
  variantKey: string | null
  createdAt: string
}

export interface KeyframeView {
  id: string
  jobId: string
  order: number
  path: string
  createdAt: string
}

export interface JobView {
  id: string
  kind: 'video' | 'image'
  mode: string
  prompt: string
  model: string
  resolution: string
  aspectRatio: string
  durationSec: number
  hdr: boolean
  loop: boolean
  status: JobStatus
  progress: number
  errorMessage: string | null
  creditsCharged: number
  shareToken: string | null
  sharedAt: string | null
  boardId: string | null
  agentRunId: string | null
  createdAt: string
  keyframes: KeyframeView[]
  assets: AssetView[]
}

/** Recipe returned by POST /api/jobs/:id/remix — free composer prefill. */
export interface RemixPrefill {
  prompt: string
  model: string
  resolution: string
  aspectRatio: string
  durationSec: number
  hdr: boolean
  loop: boolean
  startFramePath: string | null
  endFramePath: string | null
}

export interface FeedItemView {
  id: string
  prompt: string
  model: string
  resolution: string
  aspectRatio: string
  durationSec: number
  loop: boolean
  createdAt: string
  author: { name: string; avatarSeed: string }
  videoPath: string | null
  likeCount: number
  likedByMe: boolean
}

export interface BoardView {
  id: string
  name: string
  description: string | null
  shareToken: string | null
  jobCount: number
}

export interface KeyView {
  id: string
  name: string
  prefix: string
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}

export interface MintedKeyView {
  key: string
  id: string
  name: string
  prefix: string
  createdAt: string
}

export interface PlanView {
  id: string
  label: string
  priceUsd: number
  monthlyCredits: number
  agentMultiplier: number
  agentVariationCap: number
  features: string[]
}

/** The job's main render: video for clips, poster for image jobs. */
export function mainAsset(job: JobView): AssetView | null {
  return job.assets.find((a) => a.variantKey === 'main') ?? null
}

/** Transform variants (reframe / upscale) in creation order. */
export function variantAssets(job: JobView): AssetView[] {
  return job.assets.filter((a) => a.kind === 'reframe' || a.kind === 'upscale')
}

/** Tailwind aspect class covering all seven Somnia ratios. */
export function aspectClass(ratio: string): string {
  switch (ratio) {
    case '9:16':
      return 'aspect-[9/16]'
    case '1:1':
      return 'aspect-square'
    case '4:3':
      return 'aspect-[4/3]'
    case '3:4':
      return 'aspect-[3/4]'
    case '21:9':
      return 'aspect-[21/9]'
    case '9:21':
      return 'aspect-[9/21]'
    case '16:9':
    default:
      return 'aspect-video'
  }
}

/** Plan step rendered by POST /api/agents (deterministic multi-shot plan). */
export interface AgentPlanStepView {
  shot: number
  prompt: string
  note: string
}

/** Agent run view returned by the /api/agents routes. */
export interface AgentRunView {
  id: string
  goal: string
  status: string // planning | running | completed | failed
  variations: number
  creditsBudget: number
  plan: AgentPlanStepView[]
  createdAt: string
  completedAt: string | null
}
