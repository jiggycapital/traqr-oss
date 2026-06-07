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

import { reciprocalRankFusion, detectStrategies, parseTemporalRange } from './retrieval.js'

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

assert('semantic + bm25 always on', (() => {
  const d = detectStrategies('what do we know about caching')
  return d.strategies.includes('semantic') && d.strategies.includes('bm25')
})())

assert('no temporal/graph for a plain query', (() => {
  const d = detectStrategies('how does the daemon work')
  return !d.strategies.includes('temporal') && !d.strategies.includes('graph')
})())

assert('date phrase activates temporal', (() => {
  const d = detectStrategies('what happened last week with the deploy')
  return d.strategies.includes('temporal') && d.temporalRange !== undefined
})())

assert('ISO date activates temporal', detectStrategies('the 2026-03-15 incident').strategies.includes('temporal'))

assert('entityIds activate graph', (() => {
  const d = detectStrategies('AVGO thesis', ['ent-1'])
  return d.strategies.includes('graph') && d.graphSeedIds?.length === 1
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
