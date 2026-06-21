/**
 * Classification Enforcement — LIVE-PATH integration + arg-passing contract (TD-885).
 *
 * The TD-810/883 unit tests (classification-ceiling.test.ts) pin the pure
 * helpers in ISOLATION. But BOTH real leaks in that saga were *integration*
 * bugs the helpers-in-isolation structurally cannot catch:
 *
 *   - TD-810 commit-1: bm25/temporal/graph strategies + the getById hydration
 *     of bm25/graph-only hits were classification-BLIND. The helper was correct;
 *     searchMemoriesV2 just didn't invoke a ceiling on those rows. Closed by the
 *     defense-in-depth post-filter at the end of searchMemoriesV2.
 *   - TD-810 commit-2 (f233ff40): PostgresVectorProvider.search() passed only 8
 *     positional args, omitting arg 9 (p_max_classification) → the DB defaulted
 *     it to 'restricted' (= show-all). The helper was never even reached.
 *
 * This file is the live-path regression guard TD-810 acceptance item 4 asked
 * for. Two sections:
 *   1. INTEGRATION — drive searchMemoriesV2 through a fake VectorDBProvider that
 *      yields over-tier rows across the semantic + bm25 + graph paths (the last
 *      two via the classification-blind getById hydration), assert the live path
 *      returns ZERO over-tier rows at the exploration ceiling. Catches commit-1.
 *   2. CONTRACT — capture the positional args PostgresVectorProvider.search()
 *      passes to query() via a fake pool, assert p_max_classification rides in
 *      arg 9 (single-project) / arg 12 (cross-project). Catches commit-2 — no DB.
 *
 * Hermetic: EMBEDDING_PROVIDER=none (no network), fake provider + fake pool
 * (no DB). Matches the tsx-script convention of classification-ceiling.test.ts.
 *
 * Run: npx tsx packages/memory/src/lib/classification-enforcement.integration.test.ts
 */

// MUST be set before any embedding call. getEmbeddingProvider() reads this at
// call-time and returns the network-free NullEmbeddingProvider (embedding: []).
process.env.EMBEDDING_PROVIDER = 'none'

import { searchMemoriesV2 } from './retrieval.js'
import { setVectorDB, resetVectorDB } from '../vectordb/index.js'
import { PostgresVectorProvider, setPostgresPool, resetPostgresPool } from '../vectordb/postgres.js'
import type {
  VectorDBProvider,
  Memory,
  MemorySearchResult,
  MemoryClassification,
} from '../vectordb/types.js'

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

// ---------------------------------------------------------------------------
// Test fixtures: minimal Memory / MemorySearchResult rows by classification.
// ---------------------------------------------------------------------------

function mem(id: string, classification: MemoryClassification): Memory {
  return {
    id,
    content: `content-${id}`,
    classification,
    tags: [],
    contextTags: [],
    sourceType: 'manual',
    sourceProject: 'test',
    originalConfidence: 0.9,
    lastValidated: new Date(0),
    relatedTo: [],
    isContradiction: false,
    isArchived: false,
    durability: 'permanent',
    embeddingModel: 'none',
    embeddingModelVersion: 'v1',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    timesReturned: 0,
    timesCited: 0,
  } as Memory
}

function searchRow(id: string, classification: MemoryClassification): MemorySearchResult {
  return { ...mem(id, classification), currentConfidence: 0.9, similarity: 0.5, relevanceScore: 0.5 }
}

// ===========================================================================
// 1. INTEGRATION — searchMemoriesV2 live path drops over-tier rows (commit-1).
// ===========================================================================
//
// Fake provider yields over-tier rows across all three active strategies:
//   - semantic  → sem-int (internal, kept) + sem-conf (confidential, DROP)
//                 these land in semanticFullResults → hydrated via semanticMap
//   - bm25      → bm25-pub (public, kept) + bm25-restr (restricted, DROP)
//                 NEW ids not in semantic → hydrated via the BLIND getById path
//   - graph     → graph-conf (confidential, DROP)
//                 NEW id → also via the BLIND getById path
// At exploration the ceiling is 'internal', so only public+internal survive.

console.log('\n--- searchMemoriesV2 live-path classification enforcement (TD-885 / TD-810 commit-1) ---')

// Rows that arrive ONLY via bm25/graph must be hydrated by getById (the path
// that was classification-blind in commit-1, now backstopped by the post-filter).
const byId: Record<string, Memory> = {
  'bm25-pub': mem('bm25-pub', 'public'),
  'bm25-restr': mem('bm25-restr', 'restricted'),
  'graph-conf': mem('graph-conf', 'confidential'),
}

const getByIdCalls: string[] = []

// FIDELITY NOTE (TD-885): this fake emits over-tier rows ONLY from the retrieval
// paths searchMemoriesV2 dispatches today — search (semantic), bm25Search,
// graphSearch, and the getById hydration of bm25/graph-only hits. The "0 over-tier
// rows across every path" assertion is only as complete as this fixture. If a new
// retrieval strategy is added to searchMemoriesV2, emit an over-tier row for it
// here too (see the matching note at retrieval.ts step 3) — else this guard passes
// blind to the new path.
const fakeProvider = {
  async search() {
    return [searchRow('sem-int', 'internal'), searchRow('sem-conf', 'confidential')]
  },
  async bm25Search() {
    return [
      { id: 'bm25-pub', content: 'content-bm25-pub', bm25Score: 1 },
      { id: 'bm25-restr', content: 'content-bm25-restr', bm25Score: 1 },
    ]
  },
  async graphSearch() {
    return [{ id: 'graph-conf', content: 'content-graph-conf', graphScore: 1, edgeType: 'related', depth: 1 }]
  },
  async temporalSearch() {
    return []
  },
  async getById(id: string) {
    getByIdCalls.push(id)
    return byId[id] ?? null
  },
  async bumpReturned() {
    /* no-op */
  },
  async citeMemory() {
    /* no-op */
  },
} as unknown as VectorDBProvider

{
  setVectorDB(fakeProvider)
  let results: MemorySearchResult[] = []
  try {
    results = await searchMemoriesV2('classification regression probe', {
      accessLevel: 'exploration',
      strategies: ['semantic', 'bm25', 'graph'], // force all 3 (skip detectStrategies)
      entityIds: ['seed-1'], // non-empty → graph seeds present + skips findEntitiesInQuery (no network)
      limit: 10,
    })
  } finally {
    resetVectorDB()
  }

  const ids = results.map((r) => r.id)
  const overTier = results.filter(
    (r) => r.classification === 'confidential' || r.classification === 'restricted',
  )

  assert('live path returns ZERO over-tier rows at exploration (the leak both fixes closed)', overTier.length === 0)
  assert('in-tier internal row (semantic) survives', ids.includes('sem-int'))
  assert('in-tier public row (bm25, getById-hydrated) survives', ids.includes('bm25-pub'))
  assert('confidential semantic row dropped', !ids.includes('sem-conf'))
  assert('restricted bm25 row dropped (its getById hydration was classification-blind)', !ids.includes('bm25-restr'))
  assert('confidential graph row dropped', !ids.includes('graph-conf'))
  // Prove the blind getById hydration path (commit-1's leak surface) was ACTUALLY
  // exercised — otherwise the test could pass without touching the bug class.
  assert('getById hydration ran for bm25/graph-only hits (commit-1 leak path exercised)', getByIdCalls.length >= 2)
  assert('exactly the two in-tier rows survive', results.length === 2)
}

// ===========================================================================
// 2. CONTRACT — PostgresVectorProvider.search() arg passing (commit-2).
// ===========================================================================
//
// commit-2: the single-project branch passed 8 args, omitting arg 9
// (p_max_classification) → DB defaulted it to 'restricted' = unfiltered.
// We capture the args via a fake pool and assert the security params ride in
// the correct positions. No live DB.

console.log('\n--- PostgresVectorProvider.search() arg-passing contract (TD-885 / TD-810 commit-2) ---')

const captured: { sql: string; params: unknown[] }[] = []
const fakePool = {
  async query(sql: string, params: unknown[]) {
    captured.push({ sql, params })
    return { rows: [] }
  },
  async end() {
    /* no-op */
  },
}

{
  setPostgresPool(fakePool)
  const pg = new PostgresVectorProvider()

  try {
    // -- single-project branch: SELECT * FROM search_memories($1..$10)
    captured.length = 0
    await pg.search('q', { accessLevel: 'exploration' })
    {
      const last = captured[captured.length - 1]
      assert('single-project branch calls search_memories', last.sql.includes('search_memories(') && !last.sql.includes('cross_project'))
      assert('single-project passes 10 positional args (commit-2 bug passed 8)', last.params.length === 10)
      assert('arg 9 (p_max_classification) = internal for exploration', last.params[8] === 'internal')
      assert('arg 10 (p_client_namespace) = null when unset', last.params[9] === null)
    }

    // -- cross-project branch: SELECT * FROM search_memories_cross_project($1..$13)
    captured.length = 0
    await pg.search('q', { accessLevel: 'standard', sourceProject: 'proj-x' })
    {
      const last = captured[captured.length - 1]
      assert('cross-project branch calls search_memories_cross_project', last.sql.includes('search_memories_cross_project('))
      assert('cross-project passes 13 positional args', last.params.length === 13)
      assert('arg 12 (p_max_classification) = confidential for standard', last.params[11] === 'confidential')
      assert('arg 13 (p_client_namespace) = null when unset', last.params[12] === null)
    }

    // -- fail-safe default: no accessLevel → 'restricted' (= byte-identical to the
    //    pre-TD-810 default; the commit-2 fix preserves this for no-ceiling callers).
    captured.length = 0
    await pg.search('q', {})
    {
      const last = captured[captured.length - 1]
      assert('no accessLevel → arg 9 defaults to restricted (fail-safe parity with pre-TD-810)', last.params[8] === 'restricted')
    }

    // -- explicit maxClassification overrides accessLevel in the arg too.
    captured.length = 0
    await pg.search('q', { accessLevel: 'admin', maxClassification: 'internal' })
    {
      const last = captured[captured.length - 1]
      assert('explicit maxClassification overrides accessLevel in arg 9 (admin+internal → internal)', last.params[8] === 'internal')
    }
  } finally {
    resetPostgresPool()
  }
}

// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('CLASSIFICATION-ENFORCEMENT INTEGRATION TESTS FAILED')
  process.exit(1)
} else {
  console.log('All classification-enforcement integration tests passed!')
}
