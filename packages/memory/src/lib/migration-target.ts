/**
 * Identify which Supabase project the migration runner is about to write to,
 * and refuse to proceed unless it is the intended one.
 *
 * WHY (TD-1211 cave, 2026-08-12)
 * ---------------------------------------------------------------------------
 * `migrate.ts` resolves its target from `SUPABASE_URL || NEXT_PUBLIC_SUPABASE_URL`
 * and applies every unapplied migration to whatever answers. It was careful about
 * everything except *which database it had connected to*: rollback scripts are
 * excluded, an unreadable tracking table is fatal, an unrecorded migration is
 * fatal — and none of that helps if the connection points somewhere else.
 *
 * Measured 2026-08-12: all 18 worktrees (every slot, plus the main checkout)
 * carried a `.env.local` whose `SUPABASE_URL` resolved to project ref
 * `dqrpvkpvtxgmacdjfxdt`, with a matching live `service_role` key — NOT
 * `krzajogmytxbudzisydm`, the memory store named in CLAUDE.md and the only
 * database holding `traqr_memories` / `_traqr_migrations`.
 *
 * No damage had occurred: that project has neither table, so the tracking-table
 * read failed and the runner exited 1. But it failed closed *by accident* — the
 * wrong database simply happened to lack a table. Worse, the message printed on
 * that exit was
 *
 *     "Create the exec_sql RPC, or paste .traqr/schema.sql into the Supabase SQL Editor."
 *
 * which is precisely the instruction that converts the accidental fail-safe into
 * a live schema overwrite, because it tells the operator to create the missing
 * piece on the database they are already wrongly pointed at. The remediation
 * advice was the hazard.
 *
 * So the target is asserted positively, before any write. The default expectation
 * is the known memory store, which means the correct case has zero added friction
 * and only the wrong case is loud. `TRAQR_MEMORY_DB_REF` overrides it for a
 * legitimately new or forked memory database.
 *
 * Sibling guard: `selectForwardMigrations` in ./migration-files.ts, extracted
 * after the 2026-07-02 rollback-glob incident. Same shape, same reason.
 */

/** The memory store of record — CLAUDE.md "Memory System", verified 2026-08-12. */
export const KNOWN_MEMORY_DB_REF = 'krzajogmytxbudzisydm'

export type MigrationTarget =
  | { ok: true; ref: string }
  | { ok: false; reason: string }

/**
 * Extract the Supabase project ref from a project URL.
 * Returns null when the host is not a `<ref>.supabase.co` address, so callers
 * can treat "unidentifiable" as distinct from "identified and wrong".
 */
export function extractProjectRef(url: string): string | null {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return null
  }
  const m = /^([a-z0-9]{20})\.supabase\.(co|in)$/.exec(host)
  return m ? m[1] : null
}

/**
 * Decide whether the runner may write to the database named by `supabaseUrl`.
 *
 * `expectedRef` defaults to KNOWN_MEMORY_DB_REF; pass a value (from
 * `TRAQR_MEMORY_DB_REF`) to migrate a different memory database on purpose.
 */
export function resolveMigrationTarget(opts: {
  supabaseUrl: string | undefined
  expectedRef?: string | undefined
}): MigrationTarget {
  const { supabaseUrl } = opts
  const expected = (opts.expectedRef ?? '').trim() || KNOWN_MEMORY_DB_REF

  if (!supabaseUrl || !supabaseUrl.trim()) {
    return { ok: false, reason: 'SUPABASE_URL is not set — nothing to verify.' }
  }

  const actual = extractProjectRef(supabaseUrl.trim())

  if (actual === null) {
    return {
      ok: false,
      reason:
        `Cannot identify a Supabase project ref in SUPABASE_URL (${supabaseUrl}).\n` +
        `Expected a https://<ref>.supabase.co address for project '${expected}'.\n` +
        `These migrations write to the fleet's primary knowledge store; refusing to ` +
        `run against an unidentifiable target.`,
    }
  }

  if (actual !== expected) {
    return {
      ok: false,
      reason:
        `WRONG DATABASE — refusing to migrate.\n` +
        `  SUPABASE_URL points to project : ${actual}\n` +
        `  these migrations belong to     : ${expected}\n\n` +
        `Do NOT "fix" this by creating the missing tables or the exec_sql RPC on ` +
        `${actual} — that applies the entire memory schema to the wrong database.\n` +
        `Point SUPABASE_URL at ${expected}, or set TRAQR_MEMORY_DB_REF=${actual} if ` +
        `you genuinely intend to provision a separate memory store there.`,
    }
  }

  return { ok: true, ref: actual }
}
