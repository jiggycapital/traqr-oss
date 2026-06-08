-- ============================================================================
-- Migration 016: search_memories_cross_project classification parity (TD-776)
-- ============================================================================
-- Gap (Glasswing parity): the TD-711 security work (012) added classification-
-- rank filtering + namespace isolation to search_memories; TD-775 (014) then
-- added the domain/topic + security/encryption columns to its RETURNS TABLE.
-- search_memories_cross_project got NONE of it (014 header lines 29-32 scoped it
-- out as a separate finding = THIS ticket). Its live def had:
--   * no p_max_classification / p_client_namespace params, no rank WHERE clause,
--     no namespace clause  -> it returns confidential/restricted rows regardless
--     of the caller's access tier, and ignores client_namespace isolation.
--   * no classification / client_namespace / contains_pii / encryption columns in
--     RETURNS TABLE -> callers can't post-filter, AND encrypted rows never
--     decrypt (rowToSearchResult has no encryption columns to work with, so the
--     content stays the '[ENCRYPTED]' placeholder). The latter is a correctness
--     bug, not just a security one.
--
-- BLAST RADIUS verified 2026-06-08 vs live (krzajogmytxbudzisydm):
--   * 275 confidential + 46 restricted rows; ALL encrypted-at-rest (content =
--     '[ENCRYPTED]', 11 chars) -> cross_project leaks the PLACEHOLDER, not the
--     decrypted body. The live leak vector is the PLAINTEXT summary (~110 chars,
--     present on all 321), returned unfiltered by tier.
--   * is_universal = 0 (portable path empty); client_namespace rows = 0 (cross-
--     tenant vector empty TODAY). Becomes a live cross-tenant leak the moment the
--     consulting pipeline ingests client data into client_namespace.
--   * Reachable via the /search route ?project= / ?crossProject=true (the fusion
--     semantic leg routes through provider.search() -> this RPC). The MCP
--     memory_search tool does NOT expose project/crossProject, so the main agent
--     surface is unaffected.
--
-- DECISION (Lane-2 /debate, Feature4 2026-06-08): classification-PARITY, not
-- caller-gating. Enforce at the data layer so the function is safe-by-default for
-- every current/future caller, not dependent on each caller remembering to gate.
-- Full log: vault Decisions/2026-06-08-td776-cross-project-classification-parity.md
--
-- SUBSTRATE-INVARIANT NOTE: p_max_classification DEFAULTs to 'restricted' (rank
-- 4 = show everything) to preserve behavior for trusted internal callers that
-- don't specify a tier. So this migration is INERT until the caller passes the
-- route-computed tier. The supabase.ts + postgres.ts cross_project calls are
-- updated in the same PR to pass p_max_classification / p_client_namespace.
-- A migration without the caller change = filter merged != filter enforced.
--
-- COLUMN-TYPE NOTE (carried from 014): encryption_iv / encryption_tag are `text`
-- in the live schema, even though 013's source declares VARCHAR. Match the live
-- types or RETURN QUERY raises 42804 at RUNTIME (not at CREATE). The trailing
-- guard EXECUTES the function so a 42804 fails the migration here.
--
-- Safe to re-run: DROP IF EXISTS + CREATE; signature appends the two security
-- params at the END so existing named-param callers are unaffected.
-- ============================================================================

-- Return-type + signature change requires a drop (CREATE OR REPLACE cannot alter
-- the RETURNS TABLE column set). DROP signature matches the CURRENT live def.
DROP FUNCTION IF EXISTS search_memories_cross_project(
  vector(1536), UUID, VARCHAR, VARCHAR, VARCHAR[], BOOLEAN, BOOLEAN, VARCHAR, INTEGER, FLOAT, BOOLEAN
);

CREATE OR REPLACE FUNCTION search_memories_cross_project(
  p_query_embedding vector(1536),
  p_project_id UUID DEFAULT NULL,
  p_source_project VARCHAR DEFAULT NULL,
  p_category VARCHAR DEFAULT NULL,
  p_tags VARCHAR[] DEFAULT NULL,
  p_include_archived BOOLEAN DEFAULT FALSE,
  p_include_portable BOOLEAN DEFAULT TRUE,
  p_agent_type VARCHAR DEFAULT NULL,
  p_limit INTEGER DEFAULT 10,
  p_similarity_threshold FLOAT DEFAULT 0.35,
  p_latest_only BOOLEAN DEFAULT TRUE,
  -- TD-776: security params appended at the end (parity with search_memories)
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
  -- TD-776: domain/topic (v4) — parity with search_memories (014)
  domain VARCHAR,
  topic VARCHAR,
  -- TD-776: security columns (012) — were missing here
  classification VARCHAR,
  client_namespace VARCHAR,
  contains_pii BOOLEAN,
  -- TD-776: encryption columns (013) — text in live schema (see header note).
  -- Their absence is why encrypted rows returned '[ENCRYPTED]' placeholders.
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
    -- TD-776 parity columns
    m.domain, m.topic,
    m.classification, m.client_namespace, m.contains_pii,
    m.encrypted_content, m.encryption_iv, m.encryption_tag, m.encryption_key_version
  FROM traqr_memories m
  WHERE (p_include_archived OR m.is_archived = FALSE)
    AND m.is_forgotten = FALSE
    AND (NOT p_latest_only OR m.is_latest = TRUE)
    AND (m.invalid_at IS NULL OR m.invalid_at > NOW())
    AND (
      (p_project_id IS NOT NULL AND m.project_id = p_project_id)
      OR (p_source_project IS NOT NULL AND m.source_project = p_source_project)
      OR (p_include_portable AND m.is_universal = TRUE)
    )
    AND (p_category IS NULL OR m.category = p_category)
    AND (p_tags IS NULL OR m.tags && p_tags)
    AND (p_agent_type IS NULL OR m.agent_type = p_agent_type)
    AND 1 - (m.embedding <=> p_query_embedding) >= p_similarity_threshold
    -- TD-776 SECURITY: classification filter (parity with TD-711)
    AND (CASE m.classification
      WHEN 'public' THEN 1
      WHEN 'internal' THEN 2
      WHEN 'confidential' THEN 3
      WHEN 'restricted' THEN 4
      ELSE 2
    END) <= classification_rank
    -- TD-776 SECURITY: namespace isolation (parity with TD-712)
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
-- Regression guard. EXECUTES the function and asserts the contract that was
-- broken, with no test-runner dependency. Two checks a string match can't make:
--   (1) `classification` is a declared output column (the parity columns landed).
--   (2) the classification filter actually BITES: a real restricted memory is
--       NOT returned to an exploration-tier (max 'internal') cross-project search
--       scoped to its own source_project. This is the live "is the bypass closed"
--       assertion, and it also catches a RETURNS TABLE 42804 at migration time.
-- ============================================================================
DO $$
DECLARE
  v_emb vector(1536);
  v_proj VARCHAR;
  v_leaked INTEGER;
BEGIN
  -- (1) parity: classification must be a declared output column
  IF position('classification' IN pg_get_function_result(
    'search_memories_cross_project(vector,uuid,varchar,varchar,varchar[],boolean,boolean,varchar,integer,float,boolean,varchar,varchar)'::regprocedure
  )) = 0 THEN
    RAISE EXCEPTION 'TD-776 regression: search_memories_cross_project must declare the classification column';
  END IF;

  -- (2) live filter: pick a real restricted memory, search its own project at
  -- exploration tier, and assert NO confidential/restricted row comes back.
  SELECT embedding, source_project INTO v_emb, v_proj
  FROM traqr_memories
  WHERE is_latest AND classification = 'restricted' AND source_project IS NOT NULL
  LIMIT 1;

  IF v_emb IS NOT NULL THEN
    SELECT count(*) INTO v_leaked
    FROM search_memories_cross_project(
      v_emb,        -- p_query_embedding
      NULL,         -- p_project_id
      v_proj,       -- p_source_project (the restricted row's project)
      NULL,         -- p_category
      NULL,         -- p_tags
      FALSE,        -- p_include_archived
      TRUE,         -- p_include_portable
      NULL,         -- p_agent_type
      100,          -- p_limit
      0.0,          -- p_similarity_threshold (match everything)
      TRUE,         -- p_latest_only
      'internal',   -- p_max_classification (exploration tier)
      NULL          -- p_client_namespace
    )
    WHERE classification IN ('confidential', 'restricted');

    IF v_leaked > 0 THEN
      RAISE EXCEPTION 'TD-776 regression: cross_project leaked % confidential/restricted row(s) at exploration tier', v_leaked;
    END IF;
  END IF;
END $$;


INSERT INTO _traqr_migrations (name) VALUES ('016_cross_project_classification.sql')
ON CONFLICT DO NOTHING;
