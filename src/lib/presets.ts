// Reelforge Phase 3 — shared camera-move preset metadata (client + server).
// Preset ids are the single source of truth: the API validates against them,
// video.ts maps them to zoompan parameters, and the Studio picker renders them.

export const CAMERA_PRESET_IDS = ['push-in', 'pull-back', 'drift-left', 'drift-right'] as const
export type CameraPresetId = (typeof CAMERA_PRESET_IDS)[number]

export interface CameraPresetMeta {
  id: CameraPresetId
  label: string
  blurb: string
}

export const CAMERA_PRESET_META: readonly CameraPresetMeta[] = [
  { id: 'push-in', label: 'Push in', blurb: 'Slow glide toward the subject' },
  { id: 'pull-back', label: 'Pull back', blurb: 'Ease outward to reveal the scene' },
  { id: 'drift-left', label: 'Drift left', blurb: 'Steady sideways glide to the left' },
  { id: 'drift-right', label: 'Drift right', blurb: 'Steady sideways glide to the right' },
]

export function cameraPresetLabel(id: CameraPresetId): string {
  return CAMERA_PRESET_META.find((preset) => preset.id === id)?.label ?? id
}
