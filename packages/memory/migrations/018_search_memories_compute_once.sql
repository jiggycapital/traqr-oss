-- ============================================================================
-- Migration 018: search_memories — compute distance + confidence ONCE per row
-- ============================================================================
-- TD-865 (6/14 Nano-saturation root-cause), reframing item 4.
--
-- The 6/14 incident pinned the (then Nano) traqr-db when 16 slots ran ~6
-- orient memory_search calls each. Feature5's EXPLAIN-proven root cause: every
-- search does a full Index Scan on idx_traqr_memories_is_latest over ALL
-- active-latest rows (6,114 as of 6/14) and computes a 1536-dim cosine distance
-- per row — HNSW can't serve the composite `relevance_score` ORDER BY, by
-- design (a two-stage HNSW rewrite drops Sean's low-similarity/high-citation
-- steering memories; recall-tested 40% worst-case — do NOT do it).
--
-- TD-865 item 4 was "inline calculate_current_confidence as sql-STABLE so the
-- planner folds it in." Two findings KILLED that as written:
--   (a) The fn already carries `SET search_path TO ''` (advisor hardening,
--       f347e00f). A SQL function with ANY `SET` clause is NOT inlinable, so
--       plpgsql->sql buys nothing unless you also drop the search_path pin —
--       which trips Supabase's function_search_path_mutable advisor. That's a
--       security<->perf trade-off (Lane 2), not a mechanical win.
--   (b) EXPLAIN ANALYZE proved the confidence fn is a ROUNDING ERROR: the scan
--       node is ~3.0s over 6,116 rows; calculate_current_confidence runs only
--       on the ~1,566 rows passing similarity>=0.35. The cost is the per-row
--       DISTANCE, not the fn.
--
-- The actual safe win, and the only change here: the live function computes
-- `1 - (embedding <=> q)` THREE times per row (WHERE filter, similarity column,
-- relevance_score) and calculate_current_confidence TWICE — Postgres does NOT
-- common-subexpression-eliminate across the SELECT list + WHERE (confirmed:
-- the live plan emits separate InitPlans for the same probe). This migration
-- computes `sim` and `cc` ONCE per row in an OFFSET-0-fenced subquery and
-- reuses them. It does NOT touch calculate_current_confidence (its language /
-- search_path are unchanged — the security tension is sidestepped entirely).
--
-- MEASURED on live (krzajogmytxbudzisydm, 6/14, probe = a 'portfolio' memory's
-- embedding, threshold 0.35, 1,566 rows passing):
--   current shape : 3,100 ms exec, 69,533 shared buffers
--   compute-once  : 2,390 ms exec, 46,577 shared buffers  (-23% time, -33% buffers)
-- The buffer delta is deterministic (one embedding detoast per row instead of
-- recomputing distance for passers); wall-time has Micro-tier variance.
--
-- EQUIVALENCE PROVEN bit-identical on the full active-latest set:
--   total rows 1566 == 1566, rel_mismatch 0, sim_mismatch 0, cc_mismatch 0,
--   max(abs(rel_old - rel_new)) = 0.  Output, ordering, and tie-breaking are
--   unchanged — this is a pure evaluation-count refactor, not a semantic change.
--
-- ROLLBACK: this is CREATE OR REPLACE; to revert, re-apply the prior definition
-- captured verbatim at the bottom of this file (commented).
--
-- NOT auto-applied. Migrations here are applied by hand (npm run migrate
-- --workspace=@traqr/memory, or Supabase MCP apply_migration). Prod-apply of
-- THIS one is gated on a cross-slot equivalence re-verify (TD-865) — it is the
-- hot memory function and this landed hours after the P1.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.search_memories(
  p_query_embedding vector,
  p_project_id uuid DEFAULT NULL::uuid,
  p_category character varying DEFAULT NULL::character varying,
  p_tags character varying[] DEFAULT NULL::character varying[],
  p_include_archived boolean DEFAULT false,
  p_limit integer DEFAULT 10,
  p_similarity_threshold double precision DEFAULT 0.35,
  p_latest_only boolean DEFAULT true,
  p_max_classification character varying DEFAULT 'restricted'::character varying,
  p_client_namespace character varying DEFAULT NULL::character varying
)
RETURNS TABLE(
  id uuid, content text, summary character varying, category character varying,
  tags character varying[], context_tags character varying[], source_type character varying,
  source_ref character varying, source_project character varying,
  original_confidence double precision, current_confidence double precision,
  similarity double precision, relevance_score double precision,
  created_at timestamp with time zone, updated_at timestamp with time zone,
  durability character varying, is_universal boolean, times_returned integer,
  times_cited integer, last_returned_at timestamp with time zone,
  last_cited_at timestamp with time zone, memory_type character varying,
  valid_at timestamp with time zone, invalid_at timestamp with time zone,
  is_latest boolean, source_tool character varying, domain character varying,
  topic character varying, classification character varying, client_namespace character varying,
  contains_pii boolean, encrypted_content text, encryption_iv text,
  encryption_tag text, encryption_key_version integer
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  classification_rank INTEGER;
BEGIN
  classification_rank := CASE p_max_classification
    WHEN 'public' THEN 1
    WHEN 'internal' THEN 2
    WHEN 'confidential' THEN 3
    WHEN 'restricted' THEN 4
    ELSE 4
  END;

  RETURN QUERY
  SELECT
    s.id, s.content, s.summary, s.category, s.tags, s.context_tags,
    s.source_type, s.source_ref, s.source_project,
    s.original_confidence,
    s.cc AS current_confidence,
    s.sim AS similarity,
    s.sim * s.cc * (1 + ln(1 + s.times_cited) * 0.1) AS relevance_score,
    s.created_at, s.updated_at, s.durability, s.is_universal,
    s.times_returned, s.times_cited, s.last_returned_at, s.last_cited_at,
    s.memory_type, s.valid_at, s.invalid_at, s.is_latest, s.source_tool,
    s.domain, s.topic,
    s.classification, s.client_namespace, s.contains_pii,
    s.encrypted_content, s.encryption_iv, s.encryption_tag, s.encryption_key_version
  FROM (
    -- OFFSET 0 is an optimization fence: it stops the planner from pulling this
    -- subquery up and re-duplicating the `sim`/`cc` expressions into the outer
    -- WHERE/ORDER BY. Distance + confidence are therefore evaluated exactly once
    -- per surviving row. Every filter below is byte-for-byte the prior WHERE,
    -- minus the similarity predicate, which moves to the outer query so it can
    -- read the precomputed `sim`.
    SELECT
      m.id, m.content, m.summary, m.category, m.tags, m.context_tags,
      m.source_type, m.source_ref, m.source_project, m.original_confidence,
      m.created_at, m.updated_at, m.durability, m.is_universal,
      m.times_returned, m.times_cited, m.last_returned_at, m.last_cited_at,
      m.memory_type, m.valid_at, m.invalid_at, m.is_latest, m.source_tool,
      m.domain, m.topic, m.classification, m.client_namespace, m.contains_pii,
      m.encrypted_content, m.encryption_iv, m.encryption_tag, m.encryption_key_version,
      1 - (m.embedding <=> p_query_embedding) AS sim,
      calculate_current_confidence(
        m.original_confidence, m.created_at, m.times_cited, m.times_returned, m.memory_type
      ) AS cc
    FROM traqr_memories m
    WHERE (p_include_archived OR m.is_archived = FALSE)
      AND m.is_forgotten = FALSE
      AND (NOT p_latest_only OR m.is_latest = TRUE)
      AND (m.invalid_at IS NULL OR m.invalid_at > NOW())
      AND (p_project_id IS NULL OR m.project_id = p_project_id)
      AND (p_category IS NULL OR m.category = p_category)
      AND (p_tags IS NULL OR m.tags && p_tags)
      AND (CASE m.classification
        WHEN 'public' THEN 1
        WHEN 'internal' THEN 2
        WHEN 'confidential' THEN 3
        WHEN 'restricted' THEN 4
        ELSE 2
      END) <= classification_rank
      AND (
        p_client_namespace IS NULL
        OR m.client_namespace IS NULL
        OR m.client_namespace = p_client_namespace
      )
    OFFSET 0
  ) s
  WHERE s.sim >= p_similarity_threshold
  ORDER BY relevance_score DESC
  LIMIT p_limit;
END;
$function$;

-- ----------------------------------------------------------------------------
-- ROLLBACK (prior live definition, captured 2026-06-14 via pg_get_functiondef):
-- ----------------------------------------------------------------------------
-- CREATE OR REPLACE FUNCTION public.search_memories(p_query_embedding vector, p_project_id uuid DEFAULT NULL::uuid, p_category character varying DEFAULT NULL::character varying, p_tags character varying[] DEFAULT NULL::character varying[], p_include_archived boolean DEFAULT false, p_limit integer DEFAULT 10, p_similarity_threshold double precision DEFAULT 0.35, p_latest_only boolean DEFAULT true, p_max_classification character varying DEFAULT 'restricted'::character varying, p_client_namespace character varying DEFAULT NULL::character varying)
--  RETURNS TABLE(id uuid, content text, summary character varying, category character varying, tags character varying[], context_tags character varying[], source_type character varying, source_ref character varying, source_project character varying, original_confidence double precision, current_confidence double precision, similarity double precision, relevance_score double precision, created_at timestamp with time zone, updated_at timestamp with time zone, durability character varying, is_universal boolean, times_returned integer, times_cited integer, last_returned_at timestamp with time zone, last_cited_at timestamp with time zone, memory_type character varying, valid_at timestamp with time zone, invalid_at timestamp with time zone, is_latest boolean, source_tool character varying, domain character varying, topic character varying, classification character varying, client_namespace character varying, contains_pii boolean, encrypted_content text, encryption_iv text, encryption_tag text, encryption_key_version integer)
--  LANGUAGE plpgsql
--  SET search_path TO 'public'
-- AS $function$
-- DECLARE
--   classification_rank INTEGER;
-- BEGIN
--   classification_rank := CASE p_max_classification
--     WHEN 'public' THEN 1 WHEN 'internal' THEN 2 WHEN 'confidential' THEN 3 WHEN 'restricted' THEN 4 ELSE 4 END;
--   RETURN QUERY
--   SELECT m.id, m.content, m.summary, m.category, m.tags, m.context_tags, m.source_type, m.source_ref, m.source_project,
--     m.original_confidence,
--     calculate_current_confidence(m.original_confidence, m.created_at, m.times_cited, m.times_returned, m.memory_type) AS current_confidence,
--     1 - (m.embedding <=> p_query_embedding) AS similarity,
--     (1 - (m.embedding <=> p_query_embedding)) * calculate_current_confidence(m.original_confidence, m.created_at, m.times_cited, m.times_returned, m.memory_type) * (1 + ln(1 + m.times_cited) * 0.1) AS relevance_score,
--     m.created_at, m.updated_at, m.durability, m.is_universal, m.times_returned, m.times_cited, m.last_returned_at, m.last_cited_at,
--     m.memory_type, m.valid_at, m.invalid_at, m.is_latest, m.source_tool, m.domain, m.topic,
--     m.classification, m.client_namespace, m.contains_pii, m.encrypted_content, m.encryption_iv, m.encryption_tag, m.encryption_key_version
--   FROM traqr_memories m
--   WHERE (p_include_archived OR m.is_archived = FALSE) AND m.is_forgotten = FALSE AND (NOT p_latest_only OR m.is_latest = TRUE)
--     AND (m.invalid_at IS NULL OR m.invalid_at > NOW()) AND (p_project_id IS NULL OR m.project_id = p_project_id)
--     AND (p_category IS NULL OR m.category = p_category) AND (p_tags IS NULL OR m.tags && p_tags)
--     AND 1 - (m.embedding <=> p_query_embedding) >= p_similarity_threshold
--     AND (CASE m.classification WHEN 'public' THEN 1 WHEN 'internal' THEN 2 WHEN 'confidential' THEN 3 WHEN 'restricted' THEN 4 ELSE 2 END) <= classification_rank
--     AND (p_client_namespace IS NULL OR m.client_namespace IS NULL OR m.client_namespace = p_client_namespace)
--   ORDER BY relevance_score DESC LIMIT p_limit;
-- END;
-- $function$;
