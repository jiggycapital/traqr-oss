/**
 * Health — checkDbHealth liveness-probe tests (lying-probe class, TD-862 lineage).
 *
 * The HTTP `/health` endpoints (memory + combined server) returned a static
 * `{status:'ok'}` based on nothing (memory) or on env-var presence (server) —
 * so during the 2026-06-14 traqr-db starvation outage they reported green while
 * the DB couldn't serve a `count(*)`. That's the same "SELECT-1 false-passes a
 * sick DB" class Feature4 closed at the raw-pg ping() level (#1974), still open
 * at the HTTP layer that `traqr status` + any monitor polls. checkDbHealth is
 * the shared, bounded liveness primitive the routes call.
 *
 * Load-bearing case: a HANGING db (ping never resolves within the budget) must
 * yield `degraded` FAST — not block the health endpoint for the pg statement
 * timeout (~25s observed on 6/14). The ping fn is injected, so no live DB.
 *
 * Run: npx tsx packages/memory/src/lib/health.test.ts
 */

import { checkDbHealth, healthStatusCode } from './health.js'

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

console.log('\n--- checkDbHealth liveness probe ---')

// 1. Reachable DB → healthy.
{
  const r = await checkDbHealth(async () => true)
  assert('ping true → status healthy', r.status === 'healthy')
  assert('ping true → db ok', r.db === 'ok')
}

// 2. ping returns false (honest "I touched the table and it failed") → degraded.
{
  const r = await checkDbHealth(async () => false)
  assert('ping false → status degraded', r.status === 'degraded')
  assert('ping false → db unreachable', r.db === 'unreachable')
}

// 3. THE load-bearing case: a hanging DB. The ping would eventually resolve true
//    but only after a delay that dwarfs the budget. checkDbHealth must return
//    degraded within ~the timeout, not wait for the slow ping.
{
  const slowPing = () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 5000))
  const start = Date.now()
  const r = await checkDbHealth(slowPing, 50)
  const elapsed = Date.now() - start
  assert('hanging ping → status degraded (does not false-pass)', r.status === 'degraded')
  assert('hanging ping → returns within the budget, not the 5s ping', elapsed < 1000)
}

// 4. Defensive: a ping that throws (shouldn't happen — ping() catches internally,
//    but the probe must never propagate) → degraded, not an unhandled rejection.
{
  const r = await checkDbHealth(async () => {
    throw new Error('connection terminated due to connection timeout')
  })
  assert('throwing ping → status degraded (no propagation)', r.status === 'degraded')
}

// 5. The load-bearing HTTP contract: degraded MUST map to 503, healthy to 200.
//    A route regressing to 200-on-degraded silently re-hides a starved DB —
//    the exact 6/14 failure. This locks it independent of the live DB/HTTP layer.
{
  assert('healthy → HTTP 200', healthStatusCode({ status: 'healthy', db: 'ok' }) === 200)
  assert('degraded → HTTP 503', healthStatusCode({ status: 'degraded', db: 'unreachable' }) === 503)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
