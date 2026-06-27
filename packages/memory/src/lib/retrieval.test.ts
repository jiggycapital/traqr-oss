/**
 * Retrieval — RRF Fusion + Strategy Detection + Temporal Parsing tests.
 *
 * Covers the pure, deterministic core of searchMemoriesV2 (TD-158/159/160):
 * reciprocalRankFusion, detectStrategies, parseTemporalRange. The Cohere rerank
 * + DB-backed strategies are exercised separately (they require a live provider
 * + COHERE_API_KEY); these tests pin the fusion math + routing that run on every
 * memory search fleet-wide.
 *
 * Run: npx tsx packages/memory/src/lib/retrieval.test.ts
 */

import {
  reciprocalRankFusion,
  detectStrategies,
  parseTemporalRange,
  extractExactIdTokens,
  findExactIdMatches,
  appendExactIdMatches,
} from './retrieval.js'

let passed = 0
let failed = 0

function assert(label: string, condition: boolean) {
  if (condition) {
    console.log(`  PASS  ${label}`)
    passed++
  } else {
    console.log(`  FAIL  ${label}`)
    failed++
  }
}

// ============================================================
// reciprocalRankFusion
// ============================================================
console.log('\n--- reciprocalRankFusion ---')

// Empty input → empty output
assert('empty strategies → []', reciprocalRankFusion([]).length === 0)

// Single strategy, single item: score = 1/(k+rank) = 1/(60+1)
{
  const fused = reciprocalRankFusion([{ strategy: 'semantic', items: [{ id: 'a', rank: 1 }] }])
  assert('single item present', fused.length === 1 && fused[0].id === 'a')
  assert('RRF formula 1/(k+rank)', Math.abs(fused[0].rrfScore - 1 / 61) < 1e-9)
  assert('top item normalizedScore === 1', fused[0].normalizedScore === 1)
  assert('strategies tracked', fused[0].strategies.join() === 'semantic')
}

// Multi-strategy: an item in BOTH strategies outranks an item in only one
{
  const fused = reciprocalRankFusion([
    { strategy: 'semantic', items: [{ id: 'x', rank: 1 }, { id: 'y', rank: 2 }] },
    { strategy: 'bm25', items: [{ id: 'x', rank: 1 }, { id: 'z', rank: 2 }] },
  ])
  const x = fused.find((f) => f.id === 'x')!
  const y = fused.find((f) => f.id === 'y')!
  assert('item in 2 strategies ranks first', fused[0].id === 'x')
  assert('cross-strategy item accumulates both', x.strategies.length === 2)
  assert('cross-strategy score > single-strategy score', x.rrfScore > y.rrfScore)
  assert('normalization: top === 1, others < 1', x.normalizedScore === 1 && y.normalizedScore < 1)
}

// topN slicing
{
  const items = Array.from({ length: 50 }, (_, i) => ({ id: `id${i}`, rank: i + 1 }))
  const fused = reciprocalRankFusion([{ strategy: 'semantic', items }], 60, 5)
  assert('topN caps result length', fused.length === 5)
  assert('topN keeps best-ranked', fused[0].id === 'id0')
}

// Lower rank (better position) yields higher score
{
  const fused = reciprocalRankFusion([{ strategy: 'semantic', items: [{ id: 'first', rank: 1 }, { id: 'tenth', rank: 10 }] }])
  assert('rank 1 scores above rank 10', fused[0].id === 'first' && fused[0].rrfScore > fused[1].rrfScore)
}

// ============================================================
// detectStrategies
// ============================================================
console.log('\n--- detectStrategies ---')

// TD-894 Path B (Sean-approved 2026-06-22): the auto-detected default is now
// SEMANTIC-ONLY. bm25/temporal/graph are dead in prod (42P01) and no longer
// auto-activate; they stay reachable only via an explicit options.strategies
// override (exercised by classification-enforcement.integration.test.ts).
assert('default is semantic-only (no auto bm25/temporal/graph)', (() => {
  const d = detectStrategies('what do we know about caching')
  return (
    d.strategies.includes('semantic') &&
    !d.strategies.includes('bm25') &&
    !d.strategies.includes('temporal') &&
    !d.strategies.includes('graph')
  )
})())

assert('date phrase no longer auto-activates the dead temporal leg', (() => {
  const d = detectStrategies('what happened last week with the deploy')
  return !d.strategies.includes('temporal')
})())

assert('date phrase still parses a temporalRange (for override callers)', (() => {
  const d = detectStrategies('what happened last week with the deploy')
  return d.temporalRange !== undefined
})())

assert('entityIds no longer auto-activate the dead graph leg', (() => {
  const d = detectStrategies('AVGO thesis', ['ent-1'])
  return !d.strategies.includes('graph') && d.graphSeedIds?.length === 1
})())

// ============================================================
// parseTemporalRange
// ============================================================
console.log('\n--- parseTemporalRange ---')

assert('"yesterday" → ~1 day window', (() => {
  const { start, end } = parseTemporalRange('yesterday')
  const days = (end.getTime() - start.getTime()) / 86_400_000
  return days >= 0.5 && days <= 2
})())

assert('"last month" → ~30 day window', (() => {
  const { start, end } = parseTemporalRange('last month')
  return start < end && (end.getTime() - start.getTime()) > 20 * 86_400_000
})())

assert('"3 days ago" → 3-day lookback', (() => {
  const { start, end } = parseTemporalRange('something 3 days ago')
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000)
  return days === 3
})())

assert('"March 2026" → month start', (() => {
  const { start } = parseTemporalRange('the March 2026 print')
  return start.getFullYear() === 2026 && start.getMonth() === 2 && start.getDate() === 1
})())

assert('ISO "2026-03-15" → that day', (() => {
  const { start } = parseTemporalRange('on 2026-03-15')
  return start.getFullYear() === 2026 && start.getMonth() === 2 && start.getDate() === 15
})())

assert('no date pattern → 30-day default', (() => {
  const { start, end } = parseTemporalRange('no temporal words here')
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000)
  return days === 30
})())

// ============================================================
// extractExactIdTokens (TD-906 Slice B)
// ============================================================
console.log('\n--- extractExactIdTokens ---')

assert('single ticket ID', extractExactIdTokens('TD-865').join() === 'TD-865')
assert('multiple IDs across prose', (() => {
  const t = extractExactIdTokens('how does TD-865 relate to JGC-294 here')
  return t.includes('TD-865') && t.includes('JGC-294')
})())
assert('acronym extracted (>=3 upper chars)', extractExactIdTokens('the HNSW index for search').includes('HNSW'))
assert('ID captured but its bare team-prefix dropped (MTQ ⊄ tokens)', (() => {
  const t = extractExactIdTokens('MTQ-129 cron fix')
  return t.includes('MTQ-129') && !t.includes('MTQ')
})())
assert('conceptual lower-case query → NO tokens (the no-op guard)',
  extractExactIdTokens('how does Sean think about concentration versus diversification').length === 0)
assert('all-caps function words are not acronyms', extractExactIdTokens('AND THE FOR WITH').length === 0)
assert('lower-case ticket id is not extracted (upper-case convention)', extractExactIdTokens('the td-865 fix').length === 0)
assert('two-letter acronym is below the >=3 bar (precision)', extractExactIdTokens('SE and MA today').length === 0)

// ============================================================
// findExactIdMatches (TD-906 Slice B)
// ============================================================
console.log('\n--- findExactIdMatches ---')

const pool = [
  { id: 'p1', content: 'the TD-865 fix landed', summary: '', tags: [] },
  { id: 'p2', content: 'unrelated note about caching', summary: '', tags: [] },
  { id: 'p3', content: 'see ref TD-8655 elsewhere', summary: '', tags: [] }, // must NOT match TD-865
  { id: 'p4', content: 'no id here', summary: 'mentions HNSW in summary', tags: [] },
  { id: 'p5', content: 'plain', summary: '', tags: ['TD-865', 'misc'] },
]

assert('matches a whole-token ID in content', (() => {
  const m = findExactIdMatches(pool, ['TD-865'], new Set())
  return m.length === 2 && m[0].id === 'p1' && m[1].id === 'p5'
})())
assert('does NOT match an ID inside a longer token (TD-865 ⊄ TD-8655)', (() => {
  const m = findExactIdMatches(pool, ['TD-865'], new Set())
  return !m.some((r) => r.id === 'p3')
})())
assert('matches an acronym in summary', findExactIdMatches(pool, ['HNSW'], new Set()).some((r) => r.id === 'p4'))
assert('excludeIds removes already-returned rows', (() => {
  const m = findExactIdMatches(pool, ['TD-865'], new Set(['p1']))
  return m.length === 1 && m[0].id === 'p5'
})())
assert('preserves pool order', (() => {
  const m = findExactIdMatches(pool, ['TD-865', 'HNSW'], new Set())
  return m.map((r) => r.id).join() === 'p1,p4,p5'
})())
assert('no tokens → no matches', findExactIdMatches(pool, [], new Set()).length === 0)

// ============================================================
// appendExactIdMatches (TD-906 Slice B) — augment-not-rerank
// ============================================================
console.log('\n--- appendExactIdMatches ---')

const head10 = Array.from({ length: 10 }, (_, i) => ({ id: `h${i}` }))
const head3 = Array.from({ length: 3 }, (_, i) => ({ id: `h${i}` }))

assert('empty matches → head unchanged (copy)', (() => {
  const r = appendExactIdMatches(head3, [], 10)
  return r.length === 3 && r.map((x) => x.id).join() === 'h0,h1,h2'
})())
assert('room to spare → appends below without displacing head', (() => {
  const r = appendExactIdMatches(head3, [{ id: 'm0' }, { id: 'm1' }], 10)
  return r.map((x) => x.id).join() === 'h0,h1,h2,m0,m1'
})())
assert('full head → displaces only the weakest head rows for the tail', (() => {
  const r = appendExactIdMatches(head10, [{ id: 'm0' }, { id: 'm1' }], 10)
  return r.length === 10 && r.map((x) => x.id).join() === 'h0,h1,h2,h3,h4,h5,h6,h7,m0,m1'
})())
assert('tail never overflows topN (matches capped)', (() => {
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}` }))
  const r = appendExactIdMatches(head3, many, 5)
  return r.length === 5 && r[r.length - 1].id === 'm4' && !r.some((x) => x.id.startsWith('h'))
})())

// ============================================================
// Summary
// ============================================================
console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('RETRIEVAL TESTS FAILED')
  process.exit(1)
} else {
  console.log('All retrieval tests passed!')
}
