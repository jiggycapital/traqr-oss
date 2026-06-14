/**
 * Liveness health probe for the memory DB.
 *
 * The HTTP `/health` endpoints must answer "can this service actually reach the
 * DB it exists to serve?" — not "is the process up" or "are env vars set". A
 * static `{status:'ok'}` false-passes a resource-starved DB (the 2026-06-14
 * traqr-db starvation outage: every real query timed out for ~3h while the
 * cheap probes stayed green — TD-862). Feature4 closed this at the raw-pg
 * `ping()` level (#1974); this closes it at the HTTP layer the fleet polls.
 *
 * The probe is BOUNDED: under starvation the underlying `ping()` (a `LIMIT 1`
 * read of the memories table) can block until the pg statement timeout (~25s
 * observed). A health endpoint that hangs that long is itself a degraded
 * signal, so we race the ping against a short budget and report `degraded`
 * fast. The default (1800ms) sits below the only in-repo consumer's patience —
 * the CLI `status` command aborts its fetch at 2000ms (status.ts pingEndpoint)
 * — so the route's honest 503 wins the race and reaches the client.
 *
 * The `ping` fn is injected so this is pure/deterministic and unit-testable
 * without a live DB (mirrors `timedSearch`'s injected-searcher convention).
 */

export interface DbHealthResult {
  status: 'healthy' | 'degraded'
  db: 'ok' | 'unreachable'
}

const TIMEOUT = Symbol('db-health-timeout')

export async function checkDbHealth(
  ping: () => Promise<boolean>,
  timeoutMs = 1800,
): Promise<DbHealthResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // Defer invocation so a SYNCHRONOUS throw from `ping` (e.g. getVectorDB()
    // throwing on missing config) and an async rejection BOTH route into the
    // .catch. The .catch stays attached regardless of who wins the race, so a
    // late rejection (after the timeout already won) can never surface as an
    // unhandled rejection. Probes fail honest as `degraded`, never silent.
    const probe = Promise.resolve().then(ping).catch(() => false)
    const timeout = new Promise<typeof TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT), timeoutMs)
    })
    const result = await Promise.race([probe, timeout])
    return result === true
      ? { status: 'healthy', db: 'ok' }
      : { status: 'degraded', db: 'unreachable' }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * HTTP status for a health result: 200 healthy, 503 degraded. Pulled out so the
 * load-bearing "degraded must surface as 503, not 200" contract is unit-tested
 * independent of a live DB / HTTP layer — a route silently regressing to 200
 * would re-hide a starved DB, which is the exact 6/14 failure this fix targets.
 */
export function healthStatusCode(result: DbHealthResult): 200 | 503 {
  return result.status === 'healthy' ? 200 : 503
}
