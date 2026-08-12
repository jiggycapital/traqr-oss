-- ============================================================================
-- Migration 017: feedback-signal write path (TD-817)
-- ============================================================================
-- times_returned / times_cited were dead fleet-wide: the SQL functions below
-- exist on the live DB (recreated by hand at some point, correctly targeting
-- traqr_memories) but the repo's only source for them (005) targets the old
-- `memories` table — so a fresh install gets broken functions. This migration
-- makes the repo match the live substrate (the 014 lesson: live and files
-- diverge; trust pg_get_functiondef).
--
-- The full TD-817 story, for archaeology:
--   1. increment_memory_returns() was live and correct.
--   2. context.ts called it through getMemoryClient() — the SUPABASE client —
--      which THROWS on DATABASE_URL-configured runtimes (no SUPABASE_URL env).
--      The fleet's MCP servers switched to DATABASE_URL ~2026-05-20, so every
--      call has thrown into a silent catch since (last live increment:
--      2026-05-20 01:42:58Z).
--   3. memory_search (searchMemoriesV2) never bumped at all; cite_memory()
--      had no caller outside the unused HTTP /cite route.
-- The TS fix routes both signals through the VectorDBProvider interface
-- (postgres: direct UPDATE; supabase: these RPCs).
--
-- Idempotent: CREATE OR REPLACE only, definitions match the live DB exactly.
-- ============================================================================

CREATE OR REPLACE FUNCTION increment_memory_returns(p_memory_ids UUID[])
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    UPDATE traqr_memories
    SET times_returned = COALESCE(times_returned, 0) + 1,
        last_returned_at = NOW()
    WHERE id = ANY(p_memory_ids);
END;
$$;

CREATE OR REPLACE FUNCTION cite_memory(p_memory_id UUID)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    UPDATE traqr_memories
    SET times_cited = COALESCE(times_cited, 0) + 1,
        last_cited_at = NOW(),
        last_validated = NOW()
    WHERE id = p_memory_id;
END;
$$;

-- Guard: actually execute both (empty array / nil UUID = no-op writes) so a
-- table-name or type mismatch fails the migration here, not silently at the
-- first real call.
DO $$
BEGIN
  PERFORM increment_memory_returns(ARRAY[]::UUID[]);
  PERFORM cite_memory('00000000-0000-0000-0000-000000000000'::UUID);
END $$;

INSERT INTO _traqr_migrations (name) VALUES ('017_feedback_signal_write_path.sql')
ON CONFLICT DO NOTHING;
