// tests/brainstorm.test.ts — TDD RED first.
// Brainstorm (prompt enhancer): deterministic suggestion engine that turns a
// terse idea into structured, richer prompts. Must be pure — no network, no
// LLM — so it is testable and runs identically in every environment.
import { describe, expect, it } from 'vitest'
import { suggestBrainstorms, enhancePrompt, BRAINSTORM_STYLES } from '@/lib/brainstorm'

describe('brainstorm — suggestions', () => {
  it('returns exactly three distinct variants for a terse prompt', () => {
    const out = suggestBrainstorms('a fox in the snow')
    expect(out).toHaveLength(3)
    expect(new Set(out.map((v) => v.text)).size).toBe(3)
  })

  it('keeps the user subject in every variant', () => {
    const out = suggestBrainstorms('a fox in the snow')
    for (const v of out) expect(v.text.toLowerCase()).toContain('fox')
  })

  it('labels each variant with a style and a blurb', () => {
    const out = suggestBrainstorms('a fox in the snow')
    for (const v of out) {
      expect(v.style.length).toBeGreaterThan(0)
      expect(v.blurb.length).toBeGreaterThan(0)
    }
    const styles = out.map((v) => v.style)
    expect(new Set(styles).size).toBe(3)
  })

  it('handles empty/whitespace input gracefully', () => {
    const out = suggestBrainstorms('   ')
    expect(out).toHaveLength(3)
    for (const v of out) expect(v.text.length).toBeGreaterThan(0)
  })

  it('is deterministic (same input, same output)', () => {
    const a = suggestBrainstorms('neon ramen stand at midnight')
    const b = suggestBrainstorms('neon ramen stand at midnight')
    expect(a).toEqual(b)
  })
})

describe('brainstorm — single enhancement', () => {
  it('enhances with camera, lighting and mood clauses appended', () => {
    const out = enhancePrompt('a fox in the snow', 'cinematic')
    expect(out).not.toBe('a fox in the snow')
    expect(out.toLowerCase()).toContain('fox')
    expect(out.toLowerCase()).toContain('shot') // camera language present
  })

  it('does not double-enhance an already-enhanced prompt (idempotent-ish)', () => {
    const once = enhancePrompt('a fox in the snow', 'cinematic')
    const twice = enhancePrompt(once, 'cinematic')
    expect(twice).toBe(once)
  })

  it('throws on unknown style', () => {
    expect(() => enhancePrompt('x', 'nope' as never)).toThrow()
  })

  it('exposes at least cinematic / vivid / documentary styles', () => {
    expect(BRAINSTORM_STYLES).toContain('cinematic')
    expect(BRAINSTORM_STYLES).toContain('vivid')
    expect(BRAINSTORM_STYLES).toContain('documentary')
  })
})
