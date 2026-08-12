/**
 * Split a migrations-directory listing into forward migrations (run in
 * lexicographic order) and rollback scripts (manual recovery only, never
 * auto-run).
 *
 * Rollback files MUST be excluded from the forward run: they sort AFTER
 * their forward file (`011_memory_engine_v2_schema.sql` < `011_rollback.sql`),
 * so a naive `*.sql` glob on a fresh database applies a migration and then
 * immediately reverts it — and against an already-provisioned database whose
 * tracking table is missing rows, the very first "unapplied" file the runner
 * would execute is `011_rollback.sql`, which drops the live v2 schema
 * (search_memories and friends). Caught 2026-07-02 during the
 * `_traqr_migrations` ledger reconcile.
 */
export function selectForwardMigrations(files: string[]): {
  forward: string[]
  rollbacks: string[]
} {
  const sql = files.filter(f => f.endsWith('.sql')).sort()
  return {
    forward: sql.filter(f => !f.endsWith('_rollback.sql')),
    rollbacks: sql.filter(f => f.endsWith('_rollback.sql')),
  }
}
