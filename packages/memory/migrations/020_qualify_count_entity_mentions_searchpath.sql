-- 020_qualify_count_entity_mentions_searchpath.sql
--
-- THE BUG (42P01, silent). `count_entity_mentions` is declared
-- `SET search_path = ''` (the secure setting) but its body referenced
-- `traqr_memories` UNQUALIFIED → every call throws
-- `42P01: relation "traqr_memories" does not exist`. The callers swallow it
-- (vectordb/supabase.ts:996 `if (error) return 0`; vectordb/postgres.ts), so the
-- entity "3+ mention" promotion threshold (entity-pipeline.ts:181) silently
-- always saw 0 — entity promotion/graph enrichment degraded with no error surfaced.
--
-- Verified live on traqr-db (krzajogmytxbudzisydm) 2026-06-21: pre-fix the live fn
-- threw 42P01; post-fix it returns real counts (1605 for a probe). Same bug class as
-- TD-894 (bm25/temporal/graph), NookTraqr 012/021, PokoTraqr #1017 — "harden
-- search_path without schema-qualifying the body." Caught by audit:sql-search-path
-- (#2237) statically; this is the live remediation + repo convergence (the two
-- setup.sql copies had drifted: packages/memory used `= public`, packages/memory-mcp
-- used `= ''` + unqualified).
--
-- FIX: keep `search_path = ''` (advisor-approved secure end state, so the Supabase
-- function_search_path_mutable advisor can't re-flag and re-break it) and qualify the
-- table reference. Idempotent.

CREATE OR REPLACE FUNCTION public.count_entity_mentions(
  p_user_id UUID,
  p_name VARCHAR
)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  mention_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO mention_count
  FROM public.traqr_memories m
  WHERE m.user_id = p_user_id
    AND m.is_archived = FALSE
    AND m.is_forgotten = FALSE
    AND m.content ILIKE '%' || p_name || '%';
  RETURN mention_count;
END;
$$;
