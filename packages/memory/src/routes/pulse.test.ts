/**
 * POST /pulse — a search that FAILED must not render as a search that found nothing.
 *
 * TD-1385. The route's search half used to be:
 *
 *   searchMemories(q, …).catch((err) => { console.warn(…); return [] })
 *
 * so a dead DB, a statement timeout, or a 42P01 reached the HTTP caller as
 * `searchResults: []` — byte-identical to a verified zero-match search. The MCP
 * twin was fixed twice (TD-1069/#3441 for memory_pulse, #4519 for memory_search /
 * memory_context); this pins the same contract on the HTTP route:
 *
 *   - search rejects  -> `searchFailed: true`, `searchError: <message>`, NO `searchResults`
 *   - search resolves -> `searchResults: [...]` (possibly `[]`), no `searchFailed`
 *   - captures in the same request are UNAFFECTED by a search failure
 *
 * Hermetic: EMBEDDING_PROVIDER=none (no network) + injected fake VectorDBProvider
 * (no DB) via the TD-885 setVectorDB seam. The route is exercised through Hono's
 * in-process app.request(), so no port is opened.
 *
 * Run: npx tsx packages/memory/src/routes/pulse.test.ts
 */

// MUST be set before any embedding call (getEmbeddingProvider reads at call-time).
process.env.EMBEDDING_PROVIDER = 'none'

import app from './pulse.js'
import { setVectorDB, resetVectorDB } from '../vectordb/index.js'
import type {
  VectorDBProvider,
  MemorySearchResult,
  MemoryInput,
  Memory,
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

// A capture that clears passesIngestionGate (>=30 chars, >=2 specificity markers,
// no advisory/fluff phrasing) so it reaches storeWithDedup -> db.store().
const CAPTURE_CONTENT =
  'packages/memory/src/routes/pulse.ts: searchMemories() rejection sets searchFailed=true ' +
  'because `return []` rendered a dead DB as a verified empty (TD-1385).'

const SEARCH_ERROR = 'connection terminated due to connection timeout'

interface FakeProvider extends VectorDBProvider {
  storeCalls: number
}

/**
 * Build a fake provider. `search` behaves per `searchMode`; `store` always
 * succeeds and counts calls, so the captures half can be graded independently.
 * triageAndStore catches its own dedup-search failure and stores anyway, which
 * is exactly the "captures unaffected" path this test needs to exercise.
 */
function makeProvider(searchMode: 'throw' | 'empty' | 'rows'): FakeProvider {
  const provider = {
    storeCalls: 0,
    async search(): Promise<MemorySearchResult[]> {
      if (searchMode === 'throw') throw new Error(SEARCH_ERROR)
      if (searchMode === 'rows') return [row('mem-aaaaaa'), row('mem-bbbbbb')]
      return []
    },
    async store(input: MemoryInput): Promise<Memory> {
      provider.storeCalls++
      return {
        id: `mem-stored-${provider.storeCalls}`,
        ...input,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      } as unknown as Memory
    },
    async bumpReturned() {},
    async citeMemory() {},
  }
  return provider as unknown as FakeProvider
}

async function pulse(body: Record<string, unknown>) {
  const res = await app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as Record<string, unknown>
  return { status: res.status, json }
}

// ===========================================================================
// 1. NEGATIVE — a rejecting search must be reported, never folded to [].
// ===========================================================================
console.log('\n--- search rejects: response says FAILED, does not claim a verified empty ---')

{
  setVectorDB(makeProvider('throw'))
  let out: Awaited<ReturnType<typeof pulse>> | null = null
  try {
    out = await pulse({ slot: 'pulse-test', search: 'anything at all' })
  } finally {
    resetVectorDB()
  }

  assert('HTTP status is still 200 (search failure is reported, not a 500)', out!.status === 200)
  assert('searchFailed === true', out!.json.searchFailed === true)
  assert(
    'searchError carries the underlying message',
    typeof out!.json.searchError === 'string' && (out!.json.searchError as string).includes(SEARCH_ERROR),
  )
  assert(
    'no `searchResults` key — nothing claims a verified empty',
    !('searchResults' in out!.json),
  )
}

// ===========================================================================
// 2. POSITIVE CONTROL — a genuinely empty search still reads as empty.
// ===========================================================================
console.log('\n--- search resolves []: verified empty, no failure flag ---')

{
  setVectorDB(makeProvider('empty'))
  let out: Awaited<ReturnType<typeof pulse>> | null = null
  try {
    out = await pulse({ slot: 'pulse-test', search: 'anything at all' })
  } finally {
    resetVectorDB()
  }

  assert('HTTP status is 200', out!.status === 200)
  assert(
    'searchResults is []',
    Array.isArray(out!.json.searchResults) && (out!.json.searchResults as unknown[]).length === 0,
  )
  assert('searchFailed is absent', !('searchFailed' in out!.json))
  assert('searchError is absent', !('searchError' in out!.json))
}

// Non-empty control: a healthy provider's rows still come through unchanged.
{
  setVectorDB(makeProvider('rows'))
  let out: Awaited<ReturnType<typeof pulse>> | null = null
  try {
    out = await pulse({ slot: 'pulse-test', search: 'anything at all' })
  } finally {
    resetVectorDB()
  }

  const results = out!.json.searchResults as Array<{ shortCode: string }> | undefined
  assert('healthy search returns its rows (no regression)', Array.isArray(results) && results.length === 2)
  assert('rows are formatted as before (shortCode MEM-xxxxxx)', results?.[0]?.shortCode === 'MEM-mem-aa')
  assert('searchFailed is absent on a healthy search', !('searchFailed' in out!.json))
}

// Not-requested control: no search in the body -> neither key appears.
{
  setVectorDB(makeProvider('throw'))
  let out: Awaited<ReturnType<typeof pulse>> | null = null
  try {
    out = await pulse({ slot: 'pulse-test' })
  } finally {
    resetVectorDB()
  }

  assert('no search requested -> no searchResults', !('searchResults' in out!.json))
  assert('no search requested -> no searchFailed (provider never asked)', !('searchFailed' in out!.json))
}

// ===========================================================================
// 3. Captures half is UNAFFECTED when the search half fails.
// ===========================================================================
console.log('\n--- captures + failing search in one request: captures store, search reports ---')

{
  const provider = makeProvider('throw')
  setVectorDB(provider)
  let out: Awaited<ReturnType<typeof pulse>> | null = null
  try {
    out = await pulse({
      slot: 'pulse-test',
      search: 'anything at all',
      captures: [{ content: CAPTURE_CONTENT, tags: ['td-1385'] }],
    })
  } finally {
    resetVectorDB()
  }

  assert('HTTP status is 200', out!.status === 200)
  assert('capture was not filtered by the ingestion gate', !('filtered' in out!.json))
  assert('db.store() was called exactly once', provider.storeCalls === 1)
  assert('captured === 1', out!.json.captured === 1)
  assert('searchFailed === true alongside the successful capture', out!.json.searchFailed === true)
  assert('no `searchResults` key', !('searchResults' in out!.json))
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
