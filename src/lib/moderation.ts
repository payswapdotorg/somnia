// Reelforge moderation gate — small, real, fail-closed word filter.
// Runs BEFORE any validation side effects or debits. If the checker itself
// fails unexpectedly, we refuse the prompt (fail closed) rather than pass it.

// A compact, genuine blocklist of clearly disallowed request themes.
const BANNED_PATTERNS: RegExp[] = [
  /\bnsfw\b/i,
  /\bnud(e|es|ity)\b/i,
  /\bnaked\b/i,
  /\bporn(ographic)?\b/i,
  /\bsex(ual|ually)?\s+(explicit|content|act)\b/i,
  /\bchild\b[^.]{0,24}\b(sex|nude|naked|porn)\b/i,
  /\b(sex|nude|naked|porn)\b[^.]{0,24}\b(child|minor|toddler|kid)\b/i,
  // Explicit child-sexual-abuse shorthand and adjacent terms — zero tolerance,
  // refused before ANY debit or provider call.
  /\b(csam|csem|child(?:\s|-)?sexual(?:\s|-)?abuse|child(?:\s|-)?sexual(?:\s|-)?exploit)\w*\b/i,
  /\b(loli|shota|cp)\s?(porn|content|pics|images?)\b/i,
  /\bgore\b/i,
  /\bbehead(ing|ed|s)?\b/i,
  /\bdismember(ment|ed|ing)?\b/i,
  /\bhow to (make|build)\b[^.]{0,30}\b(bomb|explosive|nerve agent|bioweapon)\b/i,
  /\bterrorist attack (plan|plot|blueprint)s?\b/i,
  /\bsuicide\b[^.]{0,20}\b(instruction|method|tutorial)\b/i,
]

export interface ModerationResult {
  allowed: boolean
  matched?: string
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, ' ')
    .replace(/[^a-z0-9 .,;:!?'"-]/g, ' ')
    .trim()
}

/** Check a prompt against the blocklist. Throws are converted to refusals (fail closed). */
export function moderatePrompt(prompt: unknown): ModerationResult {
  try {
    if (typeof prompt !== 'string') {
      // Nothing to screen yet — downstream validation will reject malformed input.
      return { allowed: true }
    }
    const normalized = normalize(prompt)
    for (const pattern of BANNED_PATTERNS) {
      const match = normalized.match(pattern)
      if (match) {
        return { allowed: false, matched: match[0] }
      }
    }
    return { allowed: true }
  } catch {
    // Fail closed: any internal error means refusal, never a silent pass.
    return { allowed: false }
  }
}

export const MODERATION_REFUSAL_MESSAGE =
  'This prompt was refused by our safety filter'
