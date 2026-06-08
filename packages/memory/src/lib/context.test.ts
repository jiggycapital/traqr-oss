/**
 * Context — timedSearch retry tests (TD-796).
 *
 * Pins the bounded-retry that absorbs transient cold-start blips in the priming
 * path (memory_context). Before the fix, timedSearch returned [] on the FIRST
 * throw, so a transient embedding/DB error surfaced to every agent's Phase 0 as
 * a silent "Total: 0" — indistinguishable from a genuinely empty result.
 *
 * Pure/deterministic: the searcher is injected, so no live DB or embedding
 * provider is required. Matches the tsx-script convention of retrieval.test.ts.
 *
 * Run: npx tsx packages/memory/src/lib/context.test.ts
 */

import { timedSearch } from './context.js'
import type { MemorySearchResult } from '../vectordb/types.js'

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

// Minimal fake result — only id is read by callers in these tests.
const fakeResult = { id: 'mem-abc123' } as unknown as MemorySearchResult

// Builds a searcher that throws for its first `failTimes` calls, then succeeds.
function flakySearcher(failTimes: number) {
  let calls = 0
  const fn = async (): Promise<MemorySearchResult[]> => {
    calls++
    if (calls <= failTimes) throw new Error(`transient cold-fail #${calls}`)
    return [fakeResult]
  }
  return Object.assign(fn, { callCount: () => calls })
}

console.log('\n--- timedSearch retry (TD-796) ---')

// 1. Happy path: success on first attempt → no retry, plain label.
{
  const searcher = flakySearcher(0)
  const out = await timedSearch('principles', 'q', {}, searcher as never)
  assert('first-try success returns results', out.results.length === 1)
  assert('first-try makes exactly one call', searcher.callCount() === 1)
  assert('first-try label is unannotated', out.timing.query === 'principles')
}

// 2. The bug fix: one transient throw then success → retry recovers (was [] before).
{
  const searcher = flakySearcher(1)
  const out = await timedSearch('task-relevant', 'q', {}, searcher as never)
  assert('transient blip recovers via retry', out.results.length === 1)
  assert('retry makes exactly two calls', searcher.callCount() === 2)
  assert('retry is observable in timing label', out.timing.query === 'task-relevant (retry 1)')
}

// 3. Persistent failure → falls through to the same empty + FAILED contract as before.
{
  const searcher = flakySearcher(99)
  const out = await timedSearch('gotchas', 'q', {}, searcher as never)
  assert('persistent failure returns empty (unchanged contract)', out.results.length === 0)
  assert('persistent failure stops at max attempts (2)', searcher.callCount() === 2)
  assert('persistent failure labelled FAILED', out.timing.query === 'gotchas (FAILED)')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
