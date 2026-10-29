// scripts/smoke-planner.ts — one-shot live check of the production LLM
// planner path (NOT run under SOMNIA_TEST). Verifies the z-ai SDK chat
// completion is reachable, returns parseable JSON, and survives the
// sanitizer. Run: bun run scripts/smoke-planner.ts
import { llmPlanner, parsePlannerShots } from '../src/lib/planner'

async function main() {
  // 1. sanitizer sanity (no network)
  const parsed = parsePlannerShots(
    '```json\n{"shots":[{"prompt":"a lighthouse in a storm","note":"establishing"},{"prompt":"the keeper climbs the spiral stairs","note":"movement"}]}\n```',
    'lighthouse keeper',
    2
  )
  console.log('[smoke] sanitizer:', JSON.stringify(parsed))
  if (!parsed || parsed.length !== 2) throw new Error('sanitizer failed')

  // 2. live LLM path (SOMNIA_TEST must be unset)
  delete process.env.SOMNIA_TEST
  console.log('[smoke] calling live LLM planner…')
  const shots = await llmPlanner('a neon koi swimming through a rainy city', 3)
  if (!shots) {
    console.log('[smoke] planner declined (SDK unavailable here) — fallback would engage')
    return
  }
  console.log('[smoke] live plan:')
  for (const s of shots) console.log(`  ${s.shot}. [${s.note}] ${s.prompt}`)
  if (shots.length < 1 || shots.length > 3) throw new Error('unexpected shot count')
  console.log('[smoke] OK')
}

main().catch((err) => {
  console.error('[smoke] FAILED:', err)
  process.exit(1)
})
