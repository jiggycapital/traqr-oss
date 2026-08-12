-- ============================================================================
-- Migration 014: search_memories returns domain + topic (TD-775)
-- ============================================================================
-- Bug: memory_search(domain:X) silently returns 0 results fleet-wide. Every
-- /bethesda Phase-0 prime and CLAUDE.md example that prescribes a `domain:`
-- filter has been a no-op, so agents conclude "no prior context" and re-learn
-- gotchas already captured (e.g. the tier='HOLDING' != ownership memory).
--
-- Root cause: search_memories' RETURNS TABLE omitted the `domain` (and `topic`)
-- columns. The TS layer is already correct — rowToMemory maps `row.domain`
-- (vectordb/converters.ts) and the /search route post-filters
-- `r.domain === domainParam` (routes/search.ts) — but because the RPC never
-- emitted the column, every hydrated result had `domain === undefined`, so the
-- post-filter discarded every row. Confirmed live: domain:"jiggy" -> 0, same
-- query unfiltered -> rows whose top hit IS domain jiggy.
--
-- Fix: emit `domain` and `topic` (the v4 classification fields rowToMemory
-- already expects) from search_memories. Additive + behavior-preserving for
-- all non-domain searches. No service redeploy needed — the deployed memory
-- service reads row.domain on its next RPC call (after a PostgREST schema
-- reload so the new output column is serialized).
--
-- Why post-filter, not a server-side WHERE: memory_search defaults to 4-strategy
-- RRF fusion (semantic + BM25 + temporal + graph). Domain can't be cleanly
-- pushed into all four heterogeneous strategies, so filtering the hydrated,
-- fused results is the correct layer — it only needs each result to carry its
-- own domain.
--
-- Scope: search_memories only. search_memories_cross_project has the same
-- omission (and a separate missing-classification-filter gap), but the MCP
-- memory_search never routes through it (no project/crossProject params on the
-- tool); tracked as a separate finding.
--
-- NOTE on column types: encryption_iv / encryption_tag are `text` in the live
-- function (pg_get_functiondef), even though migration 013's source file
-- declares them VARCHAR — the deployed function and the file diverged. The
-- RETURNS TABLE column types MUST match the actual columns, or RETURN QUERY
-- raises 42804 at runtime (it is not checked at CREATE time). Match the live
-- schema; do not "correct" these back to VARCHAR from the 013 file.
--
-- Safe to re-run: DROP IF EXISTS + CREATE OR REPLACE; the trailing guard
-- EXECUTES the function (a string-only signature check would miss a 42804).
-- ============================================================================

-- Return-type changes require a drop (CREATE OR REPLACE cannot alter the
-- RETURNS TABLE column set). Signature matches migration 013 exactly.
DROP FUNCTION IF EXISTS search_memories(
  vector(1536), UUID, VARCHAR, VARCHAR[], BOOLEAN, INTEGER, FLOAT, BOOLEAN, VARCHAR, VARCHAR
);

CREATE OR REPLACE FUNCTION search_memories(
  p_query_embedding vector(1536),
  p_project_id UUID DEFAULT NULL,
  p_category VARCHAR DEFAULT NULL,
  p_tags VARCHAR[] DEFAULT NULL,
  p_include_archived BOOLEAN DEFAULT FALSE,
  p_limit INTEGER DEFAULT 10,
  p_similarity_threshold FLOAT DEFAULT 0.35,
  p_latest_only BOOLEAN DEFAULT TRUE,
  p_max_classification VARCHAR DEFAULT 'restricted',
  p_client_namespace VARCHAR DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  summary VARCHAR,
  category VARCHAR,
  tags VARCHAR[],
  context_tags VARCHAR[],
  source_type VARCHAR,
  source_ref VARCHAR,
  source_project VARCHAR,
  original_confidence FLOAT,
  current_confidence FLOAT,
  similarity FLOAT,
  relevance_score FLOAT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  durability VARCHAR,
  is_universal BOOLEAN,
  times_returned INTEGER,
  times_cited INTEGER,
  last_returned_at TIMESTAMPTZ,
  last_cited_at TIMESTAMPTZ,
  memory_type VARCHAR,
  valid_at TIMESTAMPTZ,
  invalid_at TIMESTAMPTZ,
  is_latest BOOLEAN,
  source_tool VARCHAR,
  -- Domain classification (v4) — added in 014. Their omission broke
  -- memory_search(domain:X) post-filtering fleet-wide (TD-775).
  domain VARCHAR,
  topic VARCHAR,
  -- Security columns (from 012)
  classification VARCHAR,
  client_namespace VARCHAR,
  contains_pii BOOLEAN,
  -- Encryption columns (from 013) — text in the live schema (see header note)
  encrypted_content TEXT,
  encryption_iv TEXT,
  encryption_tag TEXT,
  encryption_key_version INTEGER
)
LANGUAGE plpgsql
SET search_path = public
AS $$
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
    m.id, m.content, m.summary, m.category, m.tags, m.context_tags,
    m.source_type, m.source_ref, m.source_project,
    m.original_confidence,
    calculate_current_confidence(
      m.original_confidence, m.created_at, m.times_cited, m.times_returned, m.memory_type
    ) AS current_confidence,
    1 - (m.embedding <=> p_query_embedding) AS similarity,
    (1 - (m.embedding <=> p_query_embedding))
      * calculate_current_confidence(
          m.original_confidence, m.created_at, m.times_cited, m.times_returned, m.memory_type
        )
      * (1 + ln(1 + m.times_cited) * 0.1) AS relevance_score,
    m.created_at, m.updated_at, m.durability, m.is_universal,
    m.times_returned, m.times_cited, m.last_returned_at, m.last_cited_at,
    m.memory_type, m.valid_at, m.invalid_at, m.is_latest, m.source_tool,
    -- Domain classification (v4) — TD-775
    m.domain, m.topic,
    -- Security columns
    m.classification, m.client_namespace, m.contains_pii,
    -- Encryption columns
    m.encrypted_content, m.encryption_iv, m.encryption_tag, m.encryption_key_version
  FROM traqr_memories m
  WHERE (p_include_archived OR m.is_archived = FALSE)
    AND m.is_forgotten = FALSE
    AND (NOT p_latest_only OR m.is_latest = TRUE)
    AND (m.invalid_at IS NULL OR m.invalid_at > NOW())
    AND (p_project_id IS NULL OR m.project_id = p_project_id)
    AND (p_category IS NULL OR m.category = p_category)
    AND (p_tags IS NULL OR m.tags && p_tags)
    AND 1 - (m.embedding <=> p_query_embedding) >= p_similarity_threshold
    -- SECURITY: Classification filter
    AND (CASE m.classification
      WHEN 'public' THEN 1
      WHEN 'internal' THEN 2
      WHEN 'confidential' THEN 3
      WHEN 'restricted' THEN 4
      ELSE 2
    END) <= classification_rank
    -- SECURITY: Namespace isolation
    AND (
      p_client_namespace IS NULL
      OR m.client_namespace IS NULL
      OR m.client_namespace = p_client_namespace
    )
  ORDER BY relevance_score DESC
  LIMIT p_limit;
END;
$$;


-- ============================================================================
-- Regression guard. This is the test for this bug class — it asserts the
-- actual RPC contract that broke, with no test-runner dependency. It does TWO
-- things a string check can't: (1) confirms `domain` is a declared output
-- column, and (2) ACTUALLY EXECUTES the function and reads `domain` back, so a
-- RETURNS TABLE type mismatch (42804 — only raised at runtime) fails the
-- migration here instead of silently degrading every memory_search to [].
-- ============================================================================
DO $$
DECLARE
  v_emb vector(1536);
  v_dom_count INTEGER;
BEGIN
  IF position('domain' IN pg_get_function_result(
    'search_memories(vector,uuid,varchar,varchar[],boolean,integer,float,boolean,varchar,varchar)'::regprocedure
  )) = 0 THEN
    RAISE EXCEPTION 'TD-775 regression: search_memories must declare the domain column';
  END IF;

  SELECT embedding INTO v_emb FROM traqr_memories WHERE is_latest LIMIT 1;
  IF v_emb IS NOT NULL THEN
    SELECT count(domain) INTO v_dom_count
    FROM search_memories(v_emb, NULL, NULL, NULL, false, 3, 0.0, true, 'restricted', NULL);
  END IF;
END $$;


INSERT INTO _traqr_migrations (name) VALUES ('014_search_memories_return_domain.sql')
ON CONFLICT DO NOTHING;
