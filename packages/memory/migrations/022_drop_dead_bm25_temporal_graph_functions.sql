-- 022_drop_dead_bm25_temporal_graph_functions.sql
-- Drop the 4 dead fusion-leg search FUNCTIONS from live traqr-db, reconciling the
-- live DB with the schema after their definitions were removed in TD-906 Slice C.
--
-- WHY (TD-906 Slice C completion — the live-DB half of PR #2543)
-- ---------------------------------------------------------------------------
-- Migration 021 (Path B) dropped the GIN indexes backing these legs but
-- intentionally LEFT the FUNCTIONS + provider methods in place. TD-906 Slice C
-- (PR #2543, merged 2026-07-02) then tore down the code: the bm25/temporal/graph
-- provider methods, the interface, the types, and the FUNCTION definitions in
-- packages/memory/setup.sql + packages/memory-mcp/setup.sql.
--
-- But setup.sql is idempotent CREATE-only — deleting a `CREATE OR REPLACE
-- FUNCTION` block from it does NOT drop an already-provisioned function from a
-- live database. So bm25_search / temporal_search / graph_search / memory_bm25_search
-- lingered in prod <project-ref> as orphans: defined in the DB, defined
-- nowhere in the code (the exact proxy-vs-substrate gap — the schema said "gone,"
-- the live DB said "still here"). This migration is that DROP.
--
-- SAFETY (verified against prod <project-ref>, 2026-07-02):
--   * Dead by construction — all four carry `SET search_path = ''` with
--     unqualified table refs → every call throws 42P01, swallowed to [] by
--     retrieval.ts (BM25/temporal/graph fusion has been a prod no-op for months;
--     see migration 021 header).
--   * Zero TS/JS callers — repo-wide grep of packages/ + apps/ finds these names
--     only in migration files + setup.sql comments (post-#2543, semantic-only path).
--   * Zero internal SQL callers — no other public function's body references them
--     (pg_proc.prosrc scan returned empty).
--   * Backing indexes already gone — idx_traqr_memories_search_en/_simple/_bm25
--     dropped in migration 021; memory_bm25_search had 0 lifetime scans.
--   * No live behavior change even for the stale MCP: the default search path is
--     semantic-only and never invokes these; the only reachable path (an explicit
--     options.strategies override) already returned [] on 42P01 and now returns []
--     on 42883 (undefined function) — same swallowed-to-empty outcome.
--
-- APPLIED to prod <project-ref> on 2026-07-02 (Feature2, via Supabase
-- apply_migration `drop_dead_bm25_temporal_graph_functions`). Verified: all four
-- absent from pg_proc afterward; live memory_search round-trip unaffected. This
-- file is the durable record + rollback. (The repo runner `_traqr_migrations` has
-- tracked out-of-band since 017 — recent migrations 018–021 were applied directly;
-- this follows that precedent. Do NOT `npm run migrate` to apply it.)
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.bm25_search(text, uuid, text, text, integer, double precision);
DROP FUNCTION IF EXISTS public.graph_search(uuid[], text[], integer, integer);
DROP FUNCTION IF EXISTS public.temporal_search(vector, timestamptz, timestamptz, uuid, double precision, integer);
DROP FUNCTION IF EXISTS public.memory_bm25_search(text, integer, boolean);

-- ROLLBACK (only if a repaired, selective, index-usable BM25 fusion ever returns —
-- per TD-894 Path A). The original CREATE OR REPLACE FUNCTION definitions for
-- bm25_search / temporal_search / graph_search live in
-- migrations/011_memory_engine_v2_schema.sql (F5/F6/F7). Recreate the backing GIN
-- indexes first (see migration 021 rollback). memory_bm25_search was an older
-- prod-only orphan with no CREATE in any tracked migration and is not intended to
-- return.
