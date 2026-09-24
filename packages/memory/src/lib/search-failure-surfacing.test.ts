/**
 * Search failure surfacing — TD-796's design half (the part #1744 left unshipped).
 *
 * The bug this pins, in one sentence: a memory search that FAILED rendered
 * byte-identically to a memory search that found nothing.
 *
 *   - `searchMemoriesV2` caught its only strategy's error, logged to the MCP
 *     server's stderr (which no agent reads), and returned []. `memory_search`
 *     rendered `total: 0`.
 *   - `assembleSessionContext` computed a `(FAILED)` label in `searchTimings`,
 *     then `memory_context` returned only `promptContext` (TD-889 capped the
 *     payload) — so the label was dropped and agents saw `Total: 0`.
 *
 * On 2026-09-04 traqr-db was unreachable for 5+ hours and this is exactly how it
 * presented to six slots: a calm zero. `bethesda-orient.sh` had been reduced to
 * warning humans not to believe the number, which is a docs-layer patch over a
 * code-layer lie. These tests make the code tell the truth.
 *
 * Hermetic: EMBEDDING_PROVIDER=none (no network) + injected fake provider (no DB).
 * Matches the tsx-script convention of classification-enforcement.integration.test.ts.
 *
 * Run: npx tsx packages/memory/src/lib/search-failure-surfacing.test.ts
 */

// MUST be set before any embedding call (getEmbeddingProvider reads at call-time).
process.env.EMBEDDING_PROVIDER = 'none'

import { searchMemoriesV2 } from './retrieval.js'
import { timedSearch, assembleSessionContext } from './context.js'
import { setVectorDB, resetVectorDB } from '../vectordb/index.js'
import type { VectorDBProvider, MemorySearchResult } from '../vectordb/types.js'

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

const row = (id: string): MemorySearchResult =>
  ({
    id,
    content: `content-${id}`,
    classification: 'public',
    tags: [],
    createdAt: new Date(0),
    currentConfidence: 0.9,
    similarity: 0.5,
    relevanceScore: 0.5,
  }) as unknown as MemorySearchResult

const failingProvider = {
  async search(): Promise<MemorySearchResult[]> {
    throw new Error('connection terminated due to connection timeout')
  },
  async bumpReturned() {},
  async citeMemory() {},
} as unknown as VectorDBProvider

const healthyProvider = {
  async search(): Promise<MemorySearchResult[]> {
    return [row('mem-aaaaaa'), row('mem-bbbbbb')]
  },
  async bumpReturned() {},
  async citeMemory() {},
} as unknown as VectorDBProvider

// ===========================================================================
// 1. searchMemoriesV2 — total strategy failure THROWS, never returns [].
// ===========================================================================
console.log('\n--- searchMemoriesV2: a dead DB must not render as an empty corpus ---')

{
  setVectorDB(failingProvider)
  let threw = false
  let message = ''
  let returned: MemorySearchResult[] | null = null
  try {
    returned = await searchMemoriesV2('any query', { limit: 5 })
  } catch (err) {
    threw = true
    message = err instanceof Error ? err.message : String(err)
  } finally {
    resetVectorDB()
  }

  assert('every strategy failed -> THROWS (did not return a silent [])', threw)
  assert('did not return an array', returned === null)
  assert(
    'message says FAILURE, not empty',
    /FAILURE, not an empty result set/i.test(message),
  )
  assert('message preserves the underlying cause', /connection timeout/i.test(message))
}

// Control: a healthy provider is untouched by the change.
{
  setVectorDB(healthyProvider)
  let results: MemorySearchResult[] = []
  try {
    results = await searchMemoriesV2('any query', { limit: 5 })
  } finally {
    resetVectorDB()
  }
  assert('healthy provider still returns rows (no regression)', results.length === 2)
}

// Control: a genuinely empty corpus still returns [] — it did not fail.
{
  const emptyProvider = {
    async search(): Promise<MemorySearchResult[]> {
      return []
    },
    async bumpReturned() {},
    async citeMemory() {},
  } as unknown as VectorDBProvider

  setVectorDB(emptyProvider)
  let results: MemorySearchResult[] | null = null
  let threw = false
  try {
    results = await searchMemoriesV2('any query', { limit: 5 })
  } catch {
    threw = true
  } finally {
    resetVectorDB()
  }
  assert('genuinely empty result set still returns [] (did NOT throw)', !threw)
  assert('empty means empty', Array.isArray(results) && results.length === 0)
}

// ===========================================================================
// 2. timedSearch — `failed` is a real field, not a "(FAILED)" string suffix.
// ===========================================================================
console.log('\n--- timedSearch: failure is a field, not a label to parse ---')

{
  const alwaysThrows = async (): Promise<MemorySearchResult[]> => {
    throw new Error('cold-fail')
  }
  const out = await timedSearch('principles', 'q', {}, alwaysThrows as never)
  assert('exhausted retries -> failed === true', out.failed === true)
  assert('still returns an empty result list', out.results.length === 0)
  assert('label still carries (FAILED) for the timings view', /\(FAILED\)$/.test(out.timing.query))
}

{
  const ok = async (): Promise<MemorySearchResult[]> => [row('mem-cccccc')]
  const out = await timedSearch('principles', 'q', {}, ok as never)
  assert('success -> failed === false', out.failed === false)
  assert('success returns its rows', out.results.length === 1)
}

// ===========================================================================
// 3. memory_context's promptContext — the ONLY surface an agent actually reads.
// ===========================================================================
console.log('\n--- assembleSessionContext: `Total: 0` must not lie about a dead DB ---')

{
  setVectorDB(failingProvider)
  let promptContext = ''
  try {
    const ctx = await assembleSessionContext({
      slotName: 'feature2',
      taskDescription: 'what is most valuable now',
    })
    promptContext = ctx.promptContext
  } finally {
    resetVectorDB()
  }

  assert('degraded priming is marked DEGRADED on the Total line', /DEGRADED/.test(promptContext))
  assert('names how many searches failed', /\d+\/\d+ searches FAILED/.test(promptContext))
  assert('tells the agent absence is not evidence', /absence here is NOT\s+evidence of absence/i.test(promptContext))
  assert('names the substrate to check', /traqr-db health/i.test(promptContext))
  assert(
    'does NOT emit a bare unqualified "Total: 0 learnings loaded from vector DB"',
    !/Total: 0 learnings loaded from vector DB\s*$/m.test(promptContext),
  )
}

{
  setVectorDB(healthyProvider)
  let promptContext = ''
  try {
    const ctx = await assembleSessionContext({
      slotName: 'feature2',
      taskDescription: 'what is most valuable now',
    })
    promptContext = ctx.promptContext
  } finally {
    resetVectorDB()
  }

  assert('healthy priming is NOT marked degraded', !/DEGRADED/.test(promptContext))
  assert('healthy priming emits the plain Total line', /Total: \d+ learnings loaded from vector DB/.test(promptContext))
  assert('healthy priming emits no WARNING', !/WARNING:/.test(promptContext))
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
