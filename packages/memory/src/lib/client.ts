/**
 * Supabase Client for @traqr/memory
 *
 * Configurable Supabase client for the memory system.
 * Uses generic env vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 * instead of NookTraqr-specific ones.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'

let clientInstance: SupabaseClient | null = null

/**
 * Client-side deadline for every memory request (TD-1218).
 *
 * On 2026-08-13 `/cos` called `memory_context` and the harness aborted it after
 * **1815 seconds** — "sent no response or progress for 1815s". The database was
 * healthy throughout: a direct Supabase query answered instantly, 11,668 active
 * rows, newest write minutes old. The MCP *server layer* hung.
 *
 * The reason a hang can last half an hour is here, and it is an absence rather
 * than a bug: `createClient` was called with no `fetch` override, so every
 * request used the platform `fetch`, which has **no response deadline**. There
 * was no timeout anywhere in the memory stack — not in the client, not in the
 * provider, not in the MCP tool handlers. Nothing could ever give up.
 *
 * Two things this deliberately is NOT:
 *
 *  - **Not a fix for the wedge itself.** The cause of the hang is upstream and
 *    still unknown. This bounds the blast radius: a caller loses ~15s instead of
 *    its whole turn. In an autonomous `/bethesda` tick the old behaviour killed
 *    the turn outright, so the cave's findings were lost too.
 *  - **Not the orphaned-process theory.** TD-1218 hypothesised that stale
 *    `memory-mcp` node processes hold pooled Postgres connections and contribute
 *    to a pooler wedge. Measured 2026-08-14 and it does not hold: the live
 *    provider is `SupabaseVectorProvider` (no `DATABASE_URL` is set), which
 *    talks HTTP to PostgREST and holds **zero** direct Postgres connections; and
 *    the fallback `pg` pool sets `idleTimeoutMillis: 30000`, so even it would
 *    release within 30s. `pg_stat_activity` showed no memory-attributable
 *    backend. Four orphans were alive at the time of measurement, holding
 *    nothing. That theory is refuted; the missing deadline is the real finding.
 *
 * A timeout must be distinguishable from an empty result — that is TD-1156's
 * class ("could not check" and "verified clean" rendering identically) landing
 * on the fleet's most-called tool. So an expiry throws a named, explicit error
 * rather than degrading to zero rows.
 */
const DEFAULT_MEMORY_TIMEOUT_MS = 15_000

/** Marker on the thrown error so callers can branch on transport-vs-empty. */
export const MEMORY_TIMEOUT_CODE = 'MEMORY_REQUEST_TIMEOUT'

export function getMemoryTimeoutMs(): number {
  const raw = process.env.TRAQR_MEMORY_TIMEOUT_MS
  if (raw === undefined || raw === '') return DEFAULT_MEMORY_TIMEOUT_MS
  const n = Number(raw)
  // 0 / negative / NaN are treated as "unset", never as "no timeout" — an
  // unparseable override must not silently restore the hang-forever behaviour.
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MEMORY_TIMEOUT_MS
}

/**
 * Compose a caller-supplied signal with our deadline WITHOUT `AbortSignal.any`,
 * which needs Node 20.3+ while this package declares `engines.node >=18`.
 * Returns the controller's signal plus a disposer that detaches the listeners
 * (so a long-lived client cannot accumulate them).
 */
function withDeadline(
  timeoutMs: number,
  external?: AbortSignal | null,
): { signal: AbortSignal; dispose: () => void; timedOut: () => boolean } {
  const controller = new AbortController()
  let expired = false

  // Deliberately NOT unref'd. An unref'd deadline is only honoured while
  // something ELSE keeps the event loop alive — so the one case it must cover
  // (a request holding no live handle) is exactly the case where the process
  // drains and the timer never fires. Caught by this module's own test, which
  // hung on "unsettled top-level await" until the unref came out. The timer is
  // cleared in `dispose()` the moment the request settles, so it delays exit
  // only while a request is genuinely outstanding.
  const timer = setTimeout(() => {
    expired = true
    controller.abort()
  }, timeoutMs)

  const onExternalAbort = () => controller.abort()
  if (external) {
    if (external.aborted) controller.abort()
    else external.addEventListener('abort', onExternalAbort, { once: true })
  }

  return {
    signal: controller.signal,
    timedOut: () => expired,
    dispose: () => {
      clearTimeout(timer)
      external?.removeEventListener('abort', onExternalAbort)
    },
  }
}

/**
 * Which leg of the memory stack a deadline guards. The transport-vs-empty
 * warning is identical for all of them; only the diagnosis and the override
 * lever differ, so they are parameters rather than three copies of the wrapper.
 */
export interface TimeoutFetchLabels {
  /** Prefix on the message — names the leg that gave up. */
  leg?: string
  /** The env var a caller can turn to widen this specific deadline. */
  envVar?: string
  /** Leg-specific diagnosis, ending in the NOT-PERFORMED warning. */
  guidance?: string
}

const MEMORY_LEG_GUIDANCE =
  'The datastore may be healthy while the MCP layer is wedged (TD-1218): verify with a direct ' +
  'Supabase query before concluding anything about the corpus, and treat any prior-art check ' +
  'that hit this as NOT PERFORMED.'

/** `fetch` that gives up after `timeoutMs` and says so in words a caller can act on. */
export function createTimeoutFetch(
  timeoutMs: number,
  baseFetch: typeof fetch = fetch,
  labels?: TimeoutFetchLabels,
): typeof fetch {
  const leg = labels?.leg ?? 'memory'
  const envVar = labels?.envVar ?? 'TRAQR_MEMORY_TIMEOUT_MS'
  const guidance = labels?.guidance ?? MEMORY_LEG_GUIDANCE
  return async (input: any, init?: any) => {
    const deadline = withDeadline(timeoutMs, init?.signal)
    try {
      return await baseFetch(input, { ...(init ?? {}), signal: deadline.signal })
    } catch (err) {
      if (deadline.timedOut()) {
        const e = new Error(
          `${leg}: request exceeded ${timeoutMs}ms and was aborted client-side (${MEMORY_TIMEOUT_CODE}). ` +
          'This is a TRANSPORT failure, NOT an empty result — do not read it as "nothing found". ' +
          `${guidance} Override the deadline with ${envVar}.`
        )
        ;(e as Error & { code?: string }).code = MEMORY_TIMEOUT_CODE
        throw e
      }
      throw err
    } finally {
      deadline.dispose()
    }
  }
}

export interface MemoryClientConfig {
  supabaseUrl?: string
  supabaseKey?: string
  databaseUrl?: string
  userId?: string
  projectId?: string
  tableName?: string
}

// Default IDs for single-user mode
const DEFAULT_USER_ID = 'a0000000-0000-0000-0000-000000000001'
const DEFAULT_PROJECT_ID = 'b0000000-0000-0000-0000-000000000001'

let _userId = DEFAULT_USER_ID
let _projectId = DEFAULT_PROJECT_ID
let _tableName = 'traqr_memories'
let _databaseUrl: string | undefined

export function getMemoryClient(config?: MemoryClientConfig): SupabaseClient {
  if (clientInstance) return clientInstance

  const url = config?.supabaseUrl || process.env.SUPABASE_URL || process.env.TRAQR_SUPABASE_URL
  const key = config?.supabaseKey || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.TRAQR_SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. ' +
      'Set these environment variables to connect to your Supabase instance.'
    )
  }

  if (config?.userId) _userId = config.userId
  if (config?.projectId) _projectId = config.projectId

  clientInstance = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    // TD-1218 — without this every request inherits the platform fetch, which has
    // no response deadline. That is what let one memory_context call hang 1815s.
    global: { fetch: createTimeoutFetch(getMemoryTimeoutMs()) },
  })

  return clientInstance
}

export function getUserId(): string {
  return _userId
}

export function getProjectId(): string {
  return _projectId
}

/**
 * Configure the memory system in one shot.
 * Resets the singleton so next getMemoryClient() uses the new config.
 * For raw Postgres (DATABASE_URL), pass databaseUrl instead of supabaseUrl.
 */
export function configureMemory(config: MemoryClientConfig): void {
  clientInstance = null
  if (config.tableName) _tableName = config.tableName
  if (config.userId) _userId = config.userId
  if (config.projectId) _projectId = config.projectId
  _databaseUrl = config.databaseUrl
  // Only initialize Supabase client if supabaseUrl is provided
  if (config.supabaseUrl && config.supabaseKey) {
    getMemoryClient(config)
  }
}

export function getTableName(): string {
  return _tableName
}

/** Get the stored memory config (used by VectorDB factory for provider auto-detection) */
export function getMemoryConfig(): MemoryClientConfig & { databaseUrl?: string } {
  return {
    supabaseUrl: process.env.SUPABASE_URL || process.env.TRAQR_SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.TRAQR_SUPABASE_SERVICE_ROLE_KEY,
    databaseUrl: _databaseUrl || process.env.DATABASE_URL,
    userId: _userId,
    projectId: _projectId,
    tableName: _tableName,
  }
}

/** Reset singleton (for testing) */
export function resetMemoryClient(): void {
  clientInstance = null
  _databaseUrl = undefined
}
