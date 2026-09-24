/**
 * client-timeout — every memory request must have a client-side deadline (TD-1218).
 *
 * On 2026-08-13 a `memory_context` call hung for 1815 seconds while the database
 * answered other clients instantly. Nothing in the memory stack could give up,
 * because `createClient` was called without a `fetch` override and the platform
 * `fetch` has no response deadline.
 *
 * These tests pin the three properties that make the fix load-bearing:
 *
 *  1. A hung request is abandoned near the deadline instead of hanging forever.
 *     The control case is the point of the test — the same never-resolving fetch
 *     WITHOUT the wrapper is still pending long after the wrapper gave up.
 *  2. The failure is TRANSPORT-shaped, not empty-shaped. A timeout that degraded
 *     to "no results" would be worse than the hang: a prior-art check would
 *     report "nothing found" and an agent would re-derive work that exists
 *     (TD-1156's class on the fleet's most-called tool).
 *  3. An unparseable TRAQR_MEMORY_TIMEOUT_MS falls back to the default and never
 *     to "no timeout" — a bad override must not silently restore the hang.
 *
 * Hermetic: a fake fetch, no network, no DB, no Supabase client.
 *
 * Run: npx tsx packages/memory/src/lib/client-timeout.test.ts
 */

import {
  createTimeoutFetch,
  getMemoryTimeoutMs,
  MEMORY_TIMEOUT_CODE,
} from './client.js'

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

console.log('[client-timeout] TD-1218 client-side deadline\n')

// --- 1. the hang is bounded -------------------------------------------------
{
  let hungSettled = false
  // The 8/13 shape: a request that accepts the call and never answers.
  const neverResolves: typeof fetch = ((_input: any, init: any) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })) as any

  const started = Date.now()
  let err: any = null
  try {
    await createTimeoutFetch(120, neverResolves)('https://example.invalid/rest/v1/traqr_memories')
  } catch (e) {
    err = e
  }
  const elapsed = Date.now() - started

  assert('a never-answering request rejects instead of hanging', err !== null)
  assert(`gave up near the deadline, not forever (${elapsed}ms, budget 120ms)`, elapsed >= 100 && elapsed < 3000)

  // CONTROL — the same fetch with no wrapper is what shipped before this change.
  // If this ever settles on its own, the test above is proving nothing.
  const bare = neverResolves('https://example.invalid/x', {} as any) as Promise<unknown>
  bare.then(() => { hungSettled = true }, () => { hungSettled = true })
  await new Promise((r) => setTimeout(r, 300))
  assert('control: the UNWRAPPED call is still pending after the wrapper gave up', hungSettled === false)
}

// --- 2. a timeout is transport-shaped, never empty-shaped -------------------
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

  assert('carries the machine-branchable code', err?.code === MEMORY_TIMEOUT_CODE)
  assert('names it a TRANSPORT failure', /TRANSPORT failure/.test(err?.message ?? ''))
  assert('forbids reading it as an empty result', /NOT an empty result/.test(err?.message ?? ''))
  assert('tells the caller the prior-art check did NOT run', /NOT PERFORMED/.test(err?.message ?? ''))
  assert('names the override lever', /TRAQR_MEMORY_TIMEOUT_MS/.test(err?.message ?? ''))
}

// --- 3. a real response passes straight through -----------------------------
{
  const ok: typeof fetch = (async () => new Response('{"ok":true}', { status: 200 })) as any
  const res = await createTimeoutFetch(5000, ok)('https://example.invalid/x')
  assert('a healthy response is returned untouched', res.status === 200)
  assert('body survives the wrapper', (await res.text()) === '{"ok":true}')
}

// --- 4. caller-supplied signals still work ----------------------------------
{
  const neverResolves: typeof fetch = ((_i: any, init: any) =>
    new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new Error('aborted')), { once: true })
    })) as any

  const external = new AbortController()
  setTimeout(() => external.abort(), 40)
  let err: any = null
  const started = Date.now()
  try {
    // Long deadline — the CALLER's abort must win, and must not be mislabelled
    // as our timeout.
    await createTimeoutFetch(10_000, neverResolves)('https://example.invalid/x', { signal: external.signal } as any)
  } catch (e) {
    err = e
  }
  assert('an external abort still aborts the request', err !== null && Date.now() - started < 3000)
  assert('an external abort is NOT reported as a memory timeout', err?.code !== MEMORY_TIMEOUT_CODE)
}

// --- 5. the override cannot disable the deadline ----------------------------
{
  const original = process.env.TRAQR_MEMORY_TIMEOUT_MS
  const cases: Array<[string | undefined, number, string]> = [
    [undefined, 15_000, 'unset → 15s default'],
    ['', 15_000, 'empty → default'],
    ['abc', 15_000, 'unparseable → default (NOT "no timeout")'],
    ['0', 15_000, 'zero → default (NOT "no timeout")'],
    ['-5', 15_000, 'negative → default'],
    ['3000', 3_000, 'a valid override is honored'],
  ]
  for (const [raw, want, label] of cases) {
    if (raw === undefined) delete process.env.TRAQR_MEMORY_TIMEOUT_MS
    else process.env.TRAQR_MEMORY_TIMEOUT_MS = raw
    assert(`${label} (got ${getMemoryTimeoutMs()})`, getMemoryTimeoutMs() === want)
  }
  if (original === undefined) delete process.env.TRAQR_MEMORY_TIMEOUT_MS
  else process.env.TRAQR_MEMORY_TIMEOUT_MS = original
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
