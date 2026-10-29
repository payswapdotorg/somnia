// src/lib/brainstorm.ts — Somnia prompt enhancer ("Brainstorm").
//
// A deterministic, pure suggestion engine: no network, no LLM, no randomness,
// so every environment produces identical output and the module is fully
// testable. Terse ideas are expanded into structured prompts with camera,
// lighting and mood language, one variant per style.

export type BrainstormStyle = 'cinematic' | 'vivid' | 'documentary' | 'anime' | 'noir'

export const BRAINSTORM_STYLES: BrainstormStyle[] = [
  'cinematic',
  'vivid',
  'documentary',
  'anime',
  'noir',
]

interface StyleSpec {
  label: string
  blurb: string
  /** Deterministic enhancement suffix: camera, lighting, mood. */
  suffix: string
}

const STYLE_SPECS: Record<BrainstormStyle, StyleSpec> = {
  cinematic: {
    label: 'Cinematic',
    blurb: 'Camera-first storytelling — lens, light and mood choreographed for film feel.',
    suffix:
      ', shot on 35mm film with a slow dolly-in, warm rim light through soft haze, contemplative mood',
  },
  vivid: {
    label: 'Vivid',
    blurb: 'Saturated color pop and golden energy — bold, playful, poster-ready.',
    suffix:
      ', macro color-pop close shot, high-saturation palette in golden-hour sun, playful energetic mood',
  },
  documentary: {
    label: 'Documentary',
    blurb: 'Observational realism — handheld honesty, natural light, muted tones.',
    suffix:
      ', handheld observational shot under natural overcast light, muted earth tones, candid mood',
  },
  anime: {
    label: 'Anime',
    blurb: 'Cel-shaded dynamism — crisp linework, dramatic skies, motion lines.',
    suffix:
      ', cel-shaded anime frame with crisp linework, dramatic cloud-lit sky, sweeping motion lines, adventurous mood',
  },
  noir: {
    label: 'Noir',
    blurb: 'Hard shadows and rain-slick streets — monochrome tension, one hot lamp.',
    suffix:
      ', high-contrast monochrome noir shot, hard shadows on rain-slick streets, a single hot lamp, brooding mood',
  },
}

const DEFAULT_SUBJECT = 'a lone figure by a window at dusk'

function cleanSubject(prompt: string): string {
  const cleaned = prompt.trim().replace(/\s+/g, ' ')
  return cleaned.length > 0 ? cleaned : DEFAULT_SUBJECT
}

/**
 * Enhance a prompt in a given style. Idempotent: enhancing an
 * already-enhanced prompt returns it unchanged.
 */
export function enhancePrompt(prompt: string, style: string): string {
  const spec = STYLE_SPECS[style as BrainstormStyle]
  if (!spec) throw new Error(`unknown brainstorm style: ${style}`)
  const cleaned = prompt.trim().replace(/\s+/g, ' ')
  if (cleaned.length === 0) {
    return cleanSubject(cleaned) + spec.suffix
  }
  if (cleaned.toLowerCase().endsWith(spec.suffix.toLowerCase())) {
    return cleaned
  }
  return cleaned + spec.suffix
}

export interface BrainstormVariant {
  style: string
  label: string
  text: string
  blurb: string
}

/**
 * Suggest exactly three distinct brainstorm variants for a terse idea
 * (cinematic / vivid / documentary), each preserving the user's subject.
 */
export function suggestBrainstorms(prompt: string): BrainstormVariant[] {
  const subject = cleanSubject(prompt)
  const picked: BrainstormStyle[] = ['cinematic', 'vivid', 'documentary']
  return picked.map((style) => {
    const spec = STYLE_SPECS[style]
    return {
      style,
      label: spec.label,
      text: subject + spec.suffix,
      blurb: spec.blurb,
    }
  })
}
