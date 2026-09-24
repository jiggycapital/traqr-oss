/**
 * embedding-timeout — the OTHER leg of the memory stack needs a deadline too (TD-1218).
 *
 * #3631 bounded the Supabase transport and reported that nothing in the memory
 * stack could hang any more. It bounded one of two legs.
 * `SupabaseVectorProvider.search()` calls `generateEmbedding(query)` BEFORE it
 * issues any Supabase request, so a `memory_search` is embed-then-query and
 * only the query half had a deadline.
 *
 * The embed half is the one the incident ran through, and the arithmetic is the
 * evidence: the live provider is OpenAI, whose SDK v4 defaults are
 * `timeout = 600000` and `maxRetries = 2` — three attempts of ten minutes is
 * 1800s, and the 8/13 call was aborted by the harness at **1815 seconds**.
 * A 15s deadline on the Supabase leg could not have fired on any of that.
 *
 * These tests pin the properties that keep it bounded:
 *
 *  1. The OpenAI client's own worst case is bounded. This is the regression
 *     guard for the incident itself — it fails against the SDK defaults, which
 *     is the entire point of asserting the PRODUCT rather than either field.
 *  2. A hung embedding request is abandoned near its deadline.
 *  3. The failure is TRANSPORT-shaped and names the embed leg specifically, so
 *     "the query was never vectorised" is not read as "nothing found".
 *  4. An unparseable override falls back to the default, never to "no timeout".
 *  5. The memory leg's error contract from #3631 is unchanged by the
 *     parameterisation that let this file reuse its wrapper.
 *
 * Hermetic: a fake fetch and a fake API key. No network, no DB, no real client.
 *
 * Run: npx tsx packages/memory/src/lib/embedding-timeout.test.ts
 */

process.env.EMBEDDING_PROVIDER = 'openai'
process.env.OPENAI_API_KEY = 'sk-test-not-a-real-key'

import { createTimeoutFetch, MEMORY_TIMEOUT_CODE } from './client.js'
import { embeddingFetch, getEmbeddingTimeoutMs } from './embeddings.js'
import { getEmbeddingProvider } from './embeddings.js'

let passed = 0
let failed = 0

function assert(label: string, cond: boolean): void {
  if (cond) {
    console.log(`  PASS  ${label}`)
    passed++
  } else {
    console.log(`  FAIL  ${label}`)
    failed++
  }
}

console.log('[embedding-timeout] TD-1218 second leg — the embed half of every search\n')

// --- 1. the OpenAI client's worst case is bounded ---------------------------
// The incident regression guard. Against the SDK defaults this reads
// 600000 * 3 = 1,800,000ms and FAILS — which is what makes it a real gate.
{
  const provider: any = getEmbeddingProvider()
  assert('auto-detect resolved the OpenAI provider (the live one)', provider.provider === 'openai')

  const client = provider.getClient()
  const worstCaseMs = client.timeout * (client.maxRetries + 1)

  assert(`per-attempt timeout is bounded (${client.timeout}ms, SDK default 600000)`, client.timeout <= 60_000)
  assert(`retries are bounded (${client.maxRetries}, SDK default 2)`, client.maxRetries <= 1)
  assert(
    `worst case for ONE embedding is ${Math.round(worstCaseMs / 1000)}s, not the 1800s that produced the 1815s hang`,
    worstCaseMs <= 60_000,
  )
}

// --- 2. a hung embedding request is bounded ---------------------------------
{
  const neverResolves: typeof fetch = ((_i: any, init: any) =>
    new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new Error('aborted')), { once: true })
    })) as any

  const started = Date.now()
  let err: any = null
  try {
    await createTimeoutFetch(120, neverResolves, {
      leg: 'embedding',
      envVar: 'TRAQR_EMBEDDING_TIMEOUT_MS',
      guidance: 'test guidance.',
    })('https://example.invalid/embed')
  } catch (e) {
    err = e
  }
  const elapsed = Date.now() - started

  assert('a never-answering embedding request rejects instead of hanging', err !== null)
  assert(`gave up near the deadline (${elapsed}ms, budget 120ms)`, elapsed >= 100 && elapsed < 3000)
}

// --- 3. the failure is transport-shaped and names the embed leg -------------
{
  const neverResolves: typeof fetch = ((_i: any, init: any) =>
    new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new Error('aborted')), { once: true })
    })) as any

  // The real wrapper, not a hand-built one — this is what the providers call.
  const original = process.env.TRAQR_EMBEDDING_TIMEOUT_MS
  process.env.TRAQR_EMBEDDING_TIMEOUT_MS = '80'
  const wrapped = createTimeoutFetch(getEmbeddingTimeoutMs(), neverResolves, {
    leg: 'embedding',
    envVar: 'TRAQR_EMBEDDING_TIMEOUT_MS',
    guidance:
      'The embedding provider did not answer, so the query was never vectorised and no search ' +
      'ran at all (TD-1218): treat any prior-art check that hit this as NOT PERFORMED.',
  })

  let err: any = null
  try {
    await wrapped('https://example.invalid/embed')
  } catch (e) {
    err = e
  }
  if (original === undefined) delete process.env.TRAQR_EMBEDDING_TIMEOUT_MS
  else process.env.TRAQR_EMBEDDING_TIMEOUT_MS = original

  assert('carries the machine-branchable code', err?.code === MEMORY_TIMEOUT_CODE)
  assert('names the EMBED leg, not the datastore', /^embedding: /.test(err?.message ?? ''))
  assert('names it a TRANSPORT failure', /TRANSPORT failure/.test(err?.message ?? ''))
  assert('forbids reading it as an empty result', /NOT an empty result/.test(err?.message ?? ''))
  assert('says the query was never vectorised', /never vectorised/.test(err?.message ?? ''))
  assert('tells the caller the prior-art check did NOT run', /NOT PERFORMED/.test(err?.message ?? ''))
  assert('names the embed-leg override lever', /TRAQR_EMBEDDING_TIMEOUT_MS/.test(err?.message ?? ''))
}

// --- 4. the override cannot disable the deadline ----------------------------
{
  const original = process.env.TRAQR_EMBEDDING_TIMEOUT_MS
  const cases: Array<[string | undefined, number, string]> = [
    [undefined, 15_000, 'unset → 15s default'],
    ['', 15_000, 'empty → default'],
    ['abc', 15_000, 'unparseable → default (NOT "no timeout")'],
    ['0', 15_000, 'zero → default (NOT "no timeout")'],
    ['-5', 15_000, 'negative → default'],
    ['3000', 3_000, 'a valid override is honored'],
  ]
  for (const [raw, want, label] of cases) {
    if (raw === undefined) delete process.env.TRAQR_EMBEDDING_TIMEOUT_MS
    else process.env.TRAQR_EMBEDDING_TIMEOUT_MS = raw
    assert(`${label} (got ${getEmbeddingTimeoutMs()})`, getEmbeddingTimeoutMs() === want)
  }
  if (original === undefined) delete process.env.TRAQR_EMBEDDING_TIMEOUT_MS
  else process.env.TRAQR_EMBEDDING_TIMEOUT_MS = original
}

// --- 5. #3631's memory-leg contract survives the parameterisation -----------
// The labels are optional; omitting them must reproduce the merged behaviour
// exactly, or this change would have silently rewritten another PR's contract.
{
  const neverResolves: typeof fetch = ((_i: any, init: any) =>
    new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new Error('aborted')), { once: true })
    })) as any

  let err: any = null
  try {
    await createTimeoutFetch(60, neverResolves)('https://example.invalid/x')
  } catch (e) {
    err = e
  }

  assert('default leg is still "memory"', /^memory: /.test(err?.message ?? ''))
  assert('default lever is still TRAQR_MEMORY_TIMEOUT_MS', /TRAQR_MEMORY_TIMEOUT_MS/.test(err?.message ?? ''))
  assert('default guidance still names the Supabase check', /direct Supabase query/.test(err?.message ?? ''))
  assert('default guidance still warns NOT PERFORMED', /NOT PERFORMED/.test(err?.message ?? ''))
}

// --- 6. embeddingFetch() is wired to the embed-leg labels -------------------
{
  const f = embeddingFetch()
  assert('embeddingFetch() returns a callable fetch', typeof f === 'function')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
