// Shared DTO types for the Reelforge API — safe to import from client components.

import type { AspectRatio, Tier } from '@/lib/pricing'

// Re-exported so client components can import shared DTO value types from a
// single module (the pricing module stays server-oriented).
export type { AspectRatio, Tier }

export type JobStatus =
  | 'queued'
  | 'dispatched'
  | 'running'
  | 'moderated'
  | 'completed'
  | 'failed'

export const TERMINAL_STATUSES: JobStatus[] = ['completed', 'failed']

export type JobKind = 'video' | 'image'

export interface JobDto {
  id: string
  prompt: string
  /** Phase 8: creation surface — 'video' renders an MP4, 'image' a single still. */
  kind: JobKind
  tier: Tier
  durationSec: number
  aspectRatio: AspectRatio
  startFramePath: string | null
  endFramePath: string | null
  board: string | null
  status: JobStatus
  progress: number
  errorMessage: string | null
  creditsCharged: number
  providerCostUsd: number
  provider: string
  frames: string[]
  videoPath: string | null
  /** Phase 3: edit-thread lineage — the job this edit was cut from (if any). */
  parentJobId: string | null
  /** Phase 3: the raw edit instruction that created this child job. */
  editInstruction: string | null
  /** Phase 3: 1-based position in its edit thread (1 = original, 2 = first edit…). */
  editVersion: number
  /** Phase 3: derived clips (re-crops, camera moves) attached to this job. */
  variants: JobVariantDto[]
  /** Phase 5: opaque token of the public /share/<token> link (null = unshared). */
  shareToken: string | null
  /** Phase 5: when the share link was enabled (null = unshared). */
  sharedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface JobVariantDto {
  kind: 'reframe' | 'camera' | 'restyle'
  /** Human label, e.g. "9:16 crop" or "Push in". */
  label: string | null
  path: string
  /** Present on reframe variants — the variant's own aspect ratio. */
  aspectRatio: AspectRatio | null
}

export interface CreditTransactionDto {
  id: string
  amount: number
  /** Phase 9: 'daily-grant' = per-UTC-day free refill append. */
  kind: 'grant' | 'daily-grant' | 'generation' | 'refund' | 'transform'
  balanceAfter: number
  jobId: string | null
  createdAt: string
}

/** Phase 9 (N6): daily free-refill state surfaced with the balance. */
export interface DailyGrantDto {
  amount: number
  /** Next UTC midnight — when the next daily grant unlocks (ISO string). */
  nextRefillAt: string
  /** True when THIS read appended the grant (first touch of the UTC day). */
  justGranted: boolean
}

export interface CreditsDto {
  balance: number
  transactions: CreditTransactionDto[]
  dailyGrant?: DailyGrantDto
}

export interface GenerateResponse {
  jobId: string
  creditsCharged: number
  balanceAfter: number
  idempotentReplay?: boolean
}

// ── Phase 8: Forge Agent (chat-to-create) ────────────────────────────

export interface AgentMessageDto {
  role: 'user' | 'assistant'
  content: string
}

/** A launchable creation recipe the agent proposes at the end of a reply. */
export interface AgentSuggestionDto {
  mode: 'video' | 'image'
  prompt: string
  tier: 'draft' | 'quality'
  aspectRatio: AspectRatio
  /** Video suggestions only — 5..15s. Absent for image suggestions. */
  durationSec?: number
}

export interface AgentChatResponse {
  reply: string
  suggestion: AgentSuggestionDto | null
}

/** Phase 3: response of a reframe/camera transform (flat-credit clip edit). */
export interface TransformResponse {
  variant: JobVariantDto
  creditsCharged: number
  balanceAfter: number
  /** True when an identical variant already existed and NO new charge was made. */
  alreadyExisted: boolean
}

export interface ApiError {
  error: string
  message: string
  required?: number
  balance?: number
}

// ── Phase 4: Ops & Insights (read-only aggregations) ──────────────────

export interface InsightsTotalsDto {
  jobsTotal: number
  jobsCompleted: number
  jobsFailed: number
  /** Completed jobs that actually delivered an MP4 (Generation.videoPath set). */
  jobsWithVideo: number
  /** jobsWithVideo / jobsTotal, 0..1 (0 when no jobs yet). */
  acceptanceRate: number
  creditsBalance: number
  /** Sum of positive ledger amounts (grants). */
  creditsGranted: number
  /** Absolute sum of negative ledger amounts (generation + transform charges). */
  creditsSpent: number
  providerCostUsdTotal: number
  /**
   * Retail-proxy revenue: creditsSpent × $0.01/credit, derived from the
   * report's draft pricing table (50 credits = $0.50). Play-money proxy —
   * no real billing exists in this build.
   */
  revenueUsdProxy: number
  /** (revenue − providerCost) / revenue × 100; null when revenue is 0. */
  grossMarginPct: number | null
}

export interface InsightsTierStatsDto {
  jobs: number
  credits: number
  providerCostUsd: number
  avgCostUsdPerJob: number
}

export interface InsightsDayCountDto {
  /** UTC calendar day, YYYY-MM-DD. */
  date: string
  count: number
}

export interface InsightsKindStatsDto {
  count: number
  /** Signed credit sum for the kind (grants positive, charges negative). */
  credits: number
}

export interface InsightsBoardUsageDto {
  /** Board name; "(no board)" for jobs without one. */
  board: string
  jobs: number
}

export interface InsightsLedgerEntryDto {
  kind: string
  amount: number
  balanceAfter: number
  jobId: string | null
  createdAt: string
}

export interface InsightsDto {
  totals: InsightsTotalsDto
  perTier: Record<Tier, InsightsTierStatsDto>
  /** Last 14 UTC days, zero-filled. */
  jobsPerDay: InsightsDayCountDto[]
  /** Kinds present in the ledger (grant / generation / transform / refund). */
  ledgerByKind: Record<string, InsightsKindStatsDto>
  /** Top boards by job count (max 8). */
  boardUsage: InsightsBoardUsageDto[]
  /** Latest 15 ledger rows. */
  recentLedger: InsightsLedgerEntryDto[]
  statusBreakdown: Record<JobStatus, number>
}

export interface ProviderHealthDto {
  /** Active engine name — 'demo', 'fal' or 'selfhosted'. */
  activeProvider: string
  /** FAL_KEY present? Boolean only — the value itself is never exposed. */
  falConfigured: boolean
  /** SELFHOSTED_URL present? Boolean only — the value itself is never exposed. */
  selfHostedConfigured: boolean
  /** Display string for the configured self-hosted model id (or null). */
  selfHostedModel: string | null
  ffmpegAvailable: boolean
  /** Parsed from `ffmpeg -version` (first line); null when unavailable. */
  ffmpegVersion: string | null
  lastJobAt: string | null
  /** Job activity in the trailing 5-minute window (by Job.createdAt). */
  last5m: { submitted: number; completed: number; failed: number }
  /** Multi-user Somnia: registered accounts (balances are per-user). */
  registeredUsers: number
  checkedAt: string
}
