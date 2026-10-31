// src/lib/models.ts — per-model render profiles (T19).
//
// The routing layer (routing.ts) decides WHICH tier serves a model; the
// profile here decides HOW the renderers composite it. Until T19 the model
// id died at the adapter boundary — pulse-3 and pulse-flash priced ~2.4x
// apart but rendered byte-identically. Now:
//
//   - pulse-3 (the flagship, 60/100/400cr) gets a deeper Ken Burns travel
//     and a denser storyboard;
//   - pulse-flash (the fast tier, 25/40/160cr) gets a tight travel, a lean
//     storyboard and a coarser encode — quicker to render, smaller on disk;
//   - unknown or missing model ids keep the ORIGINAL T14 constants, so
//     older rotators and the rotation self-test's gateway model name stay
//     byte-compatible with every prior rotation.
//
// The E2B gateway (scripts/e2b/gateway.mjs) mirrors this table — keep the
// two in sync when touching profiles.

export interface ModelRenderProfile {
  /** Ken Burns zoom ceiling for fresh generations (segment travel 1.0 → this). */
  kenBurnsMaxZoom: number
  /** Storyboard beat count for a prompt-only generation of this duration. */
  beatCount: (durationSec: number) => number
  /** x264 CRF adjustment — positive = quicker, coarser encode. */
  crfDelta: number
}

/** The original T14 render behavior — the profile for every unknown model id. */
export const DEFAULT_RENDER_PROFILE: ModelRenderProfile = {
  kenBurnsMaxZoom: 1.1,
  beatCount: (durationSec) => (durationSec >= 10 ? 5 : 3),
  crfDelta: 0,
}

const PROFILES: Record<string, ModelRenderProfile> = {
  // The flagship render: deeper motion, richer storyboard.
  'pulse-3': {
    kenBurnsMaxZoom: 1.18,
    beatCount: (durationSec) => (durationSec >= 10 ? 5 : 4),
    crfDelta: 0,
  },
  // The fast/cheap tier: tight travel, lean storyboard, quicker encode.
  'pulse-flash': {
    kenBurnsMaxZoom: 1.06,
    beatCount: (durationSec) => (durationSec >= 10 ? 3 : 2),
    crfDelta: 2,
  },
}

/**
 * The render profile for a Somnia model id. Unknown ids (stills, transforms,
 * foreign gateway model names) get the original constants — a routing knob
 * must never change render behavior for callers that never opted in.
 */
export function renderProfileFor(model: string | null | undefined): ModelRenderProfile {
  if (model && PROFILES[model]) return PROFILES[model]
  return DEFAULT_RENDER_PROFILE
}

/**
 * T19 — storyboard density for a model + duration. Model-aware successor of
 * the old beatCount(durationSec); the E2B gateway mirrors this exactly.
 */
export function beatCountFor(model: string | null | undefined, durationSec: number): number {
  return renderProfileFor(model).beatCount(durationSec)
}
