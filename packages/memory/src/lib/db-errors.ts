/**
 * Structural-vs-transient DB error classification for swallowed reads.
 *
 * THE PROBLEM THIS SOLVES. Several entity-pipeline reads in the Supabase provider
 * deliberately FAIL OPEN — `if (error || !data) return null` — because entity
 * enrichment must never break a memory write. Failing open is right. Failing open
 * *silently* is not: a structurally dead RPC (missing function, missing table,
 * renamed column) returns exactly what "no match" returns, forever, with no log.
 *
 * That is not hypothetical. Three separate fixes landed for the SAME class and each
 * repaired only the SQL, never the caller:
 *   - TD-894  bm25/temporal strategies dead (search_path='' + bare table -> 42P01)
 *   - TD-902  count_entity_mentions dead the same way; its caller returns 0 on error,
 *             so the entity "3+ mention" promotion threshold silently always saw 0
 *   - #4523   search_entities dead the same way; findEntityByEmbedding returns null
 *             on error, so embedding-based entity dedup was a silent no-op
 * Each time the function was repaired the caller stayed blind, so the NEXT drift was
 * silent again. This module makes the structural case loud without changing control flow.
 *
 * PRIOR ART, deliberately mirrored: `apps/pokotraqr/src/lib/slack-idempotency.ts`
 * `isDeadDedupRpc()` — same predicate, same reasoning, built for TD-898 after the same
 * bug class left Slack dedup a silent no-op. Its docstring names the reason exactly:
 * "the generic error log was indistinguishable from a transient blip, so nobody
 * noticed dedup was off."
 */

/** Postgres/PostgREST codes that mean "this thing does not exist", not "it failed once". */
const STRUCTURAL_CODES = new Set([
  '42P01', // undefined_table
  '42883', // undefined_function
  '42703', // undefined_column
  'PGRST202', // PostgREST: function not found in schema cache
  'PGRST204', // PostgREST: column not found in schema cache
])

/**
 * Is this error a STRUCTURAL failure (missing relation/function/column) rather than a
 * transient one (timeout, connection blip, throttle)? A structural failure will recur
 * on every call until someone ships a migration, so it must never read as "no rows".
 */
export function isStructuralDbError(error: unknown): boolean {
  if (!error) return false
  const code = (error as { code?: string } | null)?.code
  if (typeof code === 'string' && STRUCTURAL_CODES.has(code)) return true

  // PostgrestError is a PLAIN OBJECT, not an Error instance, so read `.message`
  // directly before falling back to String() (the same trap PokoTraqr documents).
  const raw =
    error instanceof Error
      ? error.message
      : typeof (error as { message?: unknown } | null)?.message === 'string'
        ? (error as { message: string }).message
        : String(error ?? '')
  const msg = raw.toLowerCase()
  return (
    msg.includes('does not exist') ||
    msg.includes('could not find the function') ||
    // PGRST202/204 phrase it as "Could not find <thing> in the schema cache" (permanent).
    // PostgREST's TRANSIENT reload is "Could not query the database for the schema cache.
    // Retrying." — same substring, opposite meaning. Requiring BOTH halves keeps the
    // permanent case structural and drops the reload, which is the window this token
    // most needs to be trusted in (@DevOps1, review of #4527).
    (msg.includes('could not find') && msg.includes('schema cache'))
  )
}

/**
 * Log a swallowed read distinctly when it is structurally dead. Callers KEEP their
 * fail-open return — this only makes the difference visible. The `structurallyDead`
 * token is the greppable/alertable signal; a transient error stays a plain warning.
 */
export function logSwallowedDbError(operation: string, error: unknown): void {
  if (!error) return
  const message = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? error)
  if (isStructuralDbError(error)) {
    console.warn(
      `[vectordb] ${operation} is STRUCTURALLY DEAD (missing relation/function/column) — ` +
        `it will return empty on EVERY call until a migration fixes it, and callers fail open. ` +
        `structurallyDead=true code=${(error as { code?: string })?.code ?? 'none'} error=${message}`,
    )
  } else {
    console.warn(`[vectordb] ${operation} failed transiently (failing open): ${message}`)
  }
}
