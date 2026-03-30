-- ============================================================================
-- Migration 011: Memory Engine v2 Schema
-- ============================================================================
-- Compiled from 39 Obsidian research docs (M1-M12 of Memory Engine v2 Research)
-- ADR sources: Complete Schema docs (TD-114 through TD-117)
--
-- Sections:
--   A. Core columns (TD-141)
--   B. Dual tsvector for BM25 (TD-142)
--   C. Supporting tables (TD-143)
--   D. Index restructuring (TD-144)
--   E. Backfill existing data (TD-145)
--   F. RPC functions (TD-145)
--   G. Migration tracking bootstrap
--
-- Safe to re-run: all operations use IF NOT EXISTS / CREATE OR REPLACE.
-- Apply via Supabase SQL Editor, section by section.
-- ============================================================================


-- ============================================================================
-- SECTION A: Core Columns (TD-141)
-- ============================================================================
-- 8 new columns for memory lifecycle, temporal model, and source tracking.
-- ADR: [[Complete Schema -- Core Table Evolution]]

-- Memory lifecycle columns (M5 Pipeline Design)
ALTER TABLE traqr_memories
  ADD COLUMN IF NOT EXISTS memory_type VARCHAR(20) DEFAULT 'pattern',
  ADD COLUMN IF NOT EXISTS is_latest BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS is_forgotten BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS forgotten_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS forget_after TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS source_tool VARCHAR(50);

-- Temporal columns (M7 Temporal Model Design -- replaces event_date concept)
ALTER TABLE traqr_memories
  ADD COLUMN IF NOT EXISTS valid_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS invalid_at TIMESTAMP WITH TIME ZONE;

-- Type constraint (applied after column exists with defaults populated)
DO $$
BEGIN
  ALTER TABLE traqr_memories
    ADD CONSTRAINT chk_memory_type CHECK (memory_type IN ('fact', 'preference', 'pattern'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================================
-- SECTION B: Dual tsvector for BM25 Search (TD-142)
-- ============================================================================
-- GENERATED ALWAYS AS STORED columns auto-compute on INSERT/UPDATE.
-- English stemming catches "running" -> "run"; simple tokenization preserves
-- exact terms like "useState", "pgvector", "Supabase".
-- ADR: [[Multi-Strategy Retrieval Design ADR]]
--
-- DISCOVERY: to_tsvector() is STABLE not IMMUTABLE, so Postgres rejects it
-- in GENERATED ALWAYS expressions. Fix: wrap in IMMUTABLE helper functions.
-- Safe because english/simple dictionaries are built-in and never change.
--
-- Note: Adding GENERATED columns triggers a full-table rewrite.
-- At 1,090 rows this completes in under 1 second.

CREATE OR REPLACE FUNCTION traqr_tsvector_en(content text, summary text, tags text[])
RETURNS tsvector
LANGUAGE sql IMMUTABLE AS $$
  SELECT to_tsvector('english',
    COALESCE(content, '') || ' ' ||
    COALESCE(summary, '') || ' ' ||
    COALESCE(array_to_string(tags, ' '), '')
  );
$$;

CREATE OR REPLACE FUNCTION traqr_tsvector_simple(content text, summary text, tags text[])
RETURNS tsvector
LANGUAGE sql IMMUTABLE AS $$
  SELECT to_tsvector('simple',
    COALESCE(content, '') || ' ' ||
    COALESCE(summary, '') || ' ' ||
    COALESCE(array_to_string(tags, ' '), '')
  );
$$;

ALTER TABLE traqr_memories ADD COLUMN IF NOT EXISTS
  search_vector_en tsvector
  GENERATED ALWAYS AS (traqr_tsvector_en(content, summary::text, tags::text[])) STORED;

ALTER TABLE traqr_memories ADD COLUMN IF NOT EXISTS
  search_vector_simple tsvector
  GENERATED ALWAYS AS (traqr_tsvector_simple(content, summary::text, tags::text[])) STORED;


-- ============================================================================
-- SECTION C: Supporting Tables (TD-143)
-- ============================================================================
-- 4 new tables for memory relationships, entities, and schema versioning.
-- ADR: [[Complete Schema -- Entity and Relationship Tables]]

-- 1. memory_relationships: memory-to-memory edges for version chains
CREATE TABLE IF NOT EXISTS memory_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_memory_id UUID NOT NULL REFERENCES traqr_memories(id) ON DELETE CASCADE,
  target_memory_id UUID NOT NULL REFERENCES traqr_memories(id) ON DELETE CASCADE,
  edge_type VARCHAR(20) NOT NULL,
  confidence FLOAT DEFAULT 1.0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',
  CONSTRAINT chk_edge_type CHECK (edge_type IN ('updates', 'extends', 'derives', 'related')),
  CONSTRAINT uq_memory_rel UNIQUE (source_memory_id, target_memory_id, edge_type)
);

-- 2. memory_entities: entities extracted from memories (user-scoped)
CREATE TABLE IF NOT EXISTS memory_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  embedding vector(1536),
  mentions_count INTEGER DEFAULT 0,
  first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',
  is_archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, name, entity_type)
);

-- 3. memory_entity_links: junction table (many-to-many memories <-> entities)
CREATE TABLE IF NOT EXISTS memory_entity_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL REFERENCES traqr_memories(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
  role VARCHAR(20) DEFAULT 'mention',
  extracted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(memory_id, entity_id, role)
);

-- 4. schema_version: tracks which schema version is installed
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  description TEXT,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO schema_version (version, description)
VALUES (1, 'Memory Engine v1 -- base schema (migrations 001-010)')
ON CONFLICT (version) DO NOTHING;

INSERT INTO schema_version (version, description)
VALUES (2, 'Memory Engine v2 -- pipeline, retrieval, temporal, entities (M5-M9)')
ON CONFLICT (version) DO NOTHING;

-- RLS policies (Supabase-specific: auth.role() = 'service_role')
ALTER TABLE memory_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_entity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_version ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role full access on relationships"
    ON memory_relationships FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Service role full access on entities"
    ON memory_entities FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Service role full access on entity_links"
    ON memory_entity_links FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Service role full access on schema_version"
    ON schema_version FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Indexes on supporting tables
CREATE INDEX IF NOT EXISTS idx_rel_source ON memory_relationships(source_memory_id);
CREATE INDEX IF NOT EXISTS idx_rel_target ON memory_relationships(target_memory_id);
CREATE INDEX IF NOT EXISTS idx_rel_edge ON memory_relationships(edge_type);

CREATE INDEX IF NOT EXISTS idx_entities_user ON memory_entities(user_id);
CREATE INDEX IF NOT EXISTS idx_entities_type ON memory_entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_name ON memory_entities(name);
CREATE INDEX IF NOT EXISTS idx_entities_mentions ON memory_entities(mentions_count DESC);
CREATE INDEX IF NOT EXISTS idx_entities_embedding ON memory_entities
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_entity_links_memory ON memory_entity_links(memory_id);
CREATE INDEX IF NOT EXISTS idx_entity_links_entity ON memory_entity_links(entity_id);


-- ============================================================================
-- SECTION D: Index Restructuring (TD-144)
-- ============================================================================
-- Replace full-table HNSW with partial (only indexes active, non-forgotten memories).
-- Add lifecycle, temporal, and BM25 indexes.
-- ADR: [[Complete Schema -- Core Table Evolution]]
--
-- At 225 active rows, HNSW rebuild takes ~100ms. No CONCURRENTLY needed.

-- Drop the old full-table HNSW index
DROP INDEX IF EXISTS traqr_memories_embedding_idx;

-- Create partial HNSW (only active, non-forgotten memories get indexed)
CREATE INDEX IF NOT EXISTS idx_traqr_memories_active_embedding
  ON traqr_memories USING hnsw (embedding vector_cosine_ops)
  WHERE is_archived = FALSE AND is_forgotten = FALSE;

-- Lifecycle indexes
CREATE INDEX IF NOT EXISTS idx_traqr_memories_memory_type
  ON traqr_memories(memory_type) WHERE is_archived = FALSE;
CREATE INDEX IF NOT EXISTS idx_traqr_memories_is_latest
  ON traqr_memories(is_latest) WHERE is_latest = TRUE AND is_archived = FALSE;
CREATE INDEX IF NOT EXISTS idx_traqr_memories_forgotten
  ON traqr_memories(is_forgotten) WHERE is_forgotten = TRUE;
CREATE INDEX IF NOT EXISTS idx_traqr_memories_forget_after
  ON traqr_memories(forget_after) WHERE forget_after IS NOT NULL AND is_forgotten = FALSE;
CREATE INDEX IF NOT EXISTS idx_traqr_memories_source_tool
  ON traqr_memories(source_tool) WHERE source_tool IS NOT NULL;

-- Temporal indexes
CREATE INDEX IF NOT EXISTS idx_traqr_memories_valid_at
  ON traqr_memories(valid_at) WHERE valid_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_traqr_memories_temporal
  ON traqr_memories(valid_at, invalid_at)
  WHERE is_archived = FALSE AND is_forgotten = FALSE;

-- BM25 tsvector indexes (GIN for full-text search)
CREATE INDEX IF NOT EXISTS idx_traqr_memories_search_en
  ON traqr_memories USING gin(search_vector_en);
CREATE INDEX IF NOT EXISTS idx_traqr_memories_search_simple
  ON traqr_memories USING gin(search_vector_simple);


-- ============================================================================
-- SECTION E: Backfill Existing Data (TD-145 part 1)
-- ============================================================================
-- Populate new columns for existing memories.
-- ADR: [[Complete Schema -- Core Table Evolution]]

-- Set valid_at = created_at for all existing memories (M7: when memory became true)
UPDATE traqr_memories
SET valid_at = created_at
WHERE valid_at IS NULL;

-- Ensure lifecycle booleans are populated
UPDATE traqr_memories SET is_latest = TRUE WHERE is_latest IS NULL;
UPDATE traqr_memories SET is_forgotten = FALSE WHERE is_forgotten IS NULL;

-- Heuristic memory_type classification (M5 Pipeline Design)
-- Step 1: Memories already categorized as 'preference'
UPDATE traqr_memories
SET memory_type = 'preference'
WHERE category = 'preference'
  AND memory_type = 'pattern';

-- Step 2: Memories containing numeric fact assertions
UPDATE traqr_memories
SET memory_type = 'fact'
WHERE content ~* '\b(is|are|was|has|have)\s+\d'
  AND category != 'preference'
  AND memory_type = 'pattern';

-- Everything else stays 'pattern' (the default) -- this is correct per ADR


-- ============================================================================
-- SECTION F: RPC Functions (TD-145 part 2)
-- ============================================================================
-- 2 updated + 6 new functions. Order matters: confidence first, then search.
-- ADR: [[Complete Schema -- RPC Functions]]
--
-- DISCOVERY: Live DB has calculate_current_confidence marked IMMUTABLE but it
-- uses NOW(). Fixed to STABLE in this migration.

-- F1: calculate_current_confidence -- UPDATE (4-arg -> 5-arg)
-- Must DROP old signature first to avoid Postgres overload ambiguity.
DROP FUNCTION IF EXISTS calculate_current_confidence(FLOAT, TIMESTAMP WITH TIME ZONE, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION calculate_current_confidence(
  p_original_confidence FLOAT,
  p_created_at TIMESTAMP WITH TIME ZONE,
  p_times_cited INTEGER DEFAULT 0,
  p_times_returned INTEGER DEFAULT 0,
  p_memory_type VARCHAR DEFAULT 'pattern'
)
RETURNS FLOAT
LANGUAGE plpgsql STABLE AS $$
DECLARE
  years_elapsed FLOAT;
  decay_rate FLOAT;
BEGIN
  years_elapsed := EXTRACT(EPOCH FROM (NOW() - p_created_at)) / 31536000.0;

  -- Type-aware decay rates (M5 Pipeline Design ADR)
  IF p_memory_type = 'fact' THEN
    decay_rate := 0.98;  -- 2%/year (facts barely decay)
  ELSIF p_memory_type = 'preference' THEN
    IF p_times_cited > 0 THEN
      decay_rate := 0.90;  -- 10%/year if cited
    ELSE
      decay_rate := 0.85;  -- 15%/year if uncited
    END IF;
  ELSE  -- 'pattern' (default) -- matches old behavior for existing callers
    IF p_times_cited > 3 THEN
      decay_rate := 0.95;  -- 5%/year (proven valuable)
    ELSIF p_times_cited >= 1 THEN
      decay_rate := 0.90;  -- 10%/year (moderate usage)
    ELSIF p_times_returned > 5 AND p_times_cited = 0 THEN
      decay_rate := 0.60;  -- 40%/year (noise: returned but never cited)
    ELSE
      decay_rate := 0.70;  -- 30%/year (default uncited)
    END IF;
  END IF;

  RETURN GREATEST(0.1, p_original_confidence * POWER(decay_rate, years_elapsed));
END;
$$;

-- F2: search_memories -- UPDATE (add v2 filters and columns)
-- DROP existing to allow return type changes, then CREATE fresh.
DROP FUNCTION IF EXISTS search_memories(
  vector(1536), UUID, VARCHAR, VARCHAR[], BOOLEAN, INTEGER, FLOAT
);

CREATE OR REPLACE FUNCTION search_memories(
  p_query_embedding vector(1536),
  p_project_id UUID DEFAULT NULL,
  p_category VARCHAR DEFAULT NULL,
  p_tags VARCHAR[] DEFAULT NULL,
  p_include_archived BOOLEAN DEFAULT FALSE,
  p_limit INTEGER DEFAULT 10,
  p_similarity_threshold FLOAT DEFAULT 0.35,
  p_latest_only BOOLEAN DEFAULT TRUE
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
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE,
  durability VARCHAR,
  is_universal BOOLEAN,
  times_returned INTEGER,
  times_cited INTEGER,
  last_returned_at TIMESTAMP WITH TIME ZONE,
  last_cited_at TIMESTAMP WITH TIME ZONE,
  -- v2 columns
  memory_type VARCHAR,
  valid_at TIMESTAMP WITH TIME ZONE,
  invalid_at TIMESTAMP WITH TIME ZONE,
  is_latest BOOLEAN,
  source_tool VARCHAR
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id, m.content, m.summary, m.category, m.tags, m.context_tags,
    m.source_type, m.source_ref, m.source_project,
    m.original_confidence,
    calculate_current_confidence(
      m.original_confidence, m.created_at, m.times_cited, m.times_returned, m.memory_type
    ) AS current_confidence,
    1 - (m.embedding <=> p_query_embedding) AS similarity,
    -- Citation-boosted relevance (logarithmic, never dominates)
    (1 - (m.embedding <=> p_query_embedding))
      * calculate_current_confidence(
          m.original_confidence, m.created_at, m.times_cited, m.times_returned, m.memory_type
        )
      * (1 + ln(1 + m.times_cited) * 0.1) AS relevance_score,
    m.created_at, m.updated_at, m.durability, m.is_universal,
    m.times_returned, m.times_cited, m.last_returned_at, m.last_cited_at,
    -- v2 columns
    m.memory_type, m.valid_at, m.invalid_at, m.is_latest, m.source_tool
  FROM traqr_memories m
  WHERE (p_include_archived OR m.is_archived = FALSE)
    AND m.is_forgotten = FALSE
    AND (NOT p_latest_only OR m.is_latest = TRUE)
    AND (m.invalid_at IS NULL OR m.invalid_at > NOW())
    AND (p_project_id IS NULL OR m.project_id = p_project_id)
    AND (p_category IS NULL OR m.category = p_category)
    AND (p_tags IS NULL OR m.tags && p_tags)
    AND 1 - (m.embedding <=> p_query_embedding) >= p_similarity_threshold
  ORDER BY relevance_score DESC
  LIMIT p_limit;
END;
$$;

-- F3: search_memories_cross_project -- UPDATE (add v2 filters and columns)
DROP FUNCTION IF EXISTS search_memories_cross_project(
  vector(1536), UUID, VARCHAR, VARCHAR, VARCHAR[], BOOLEAN, BOOLEAN, VARCHAR, INTEGER, FLOAT
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
  p_latest_only BOOLEAN DEFAULT TRUE
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
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE,
  durability VARCHAR,
  is_universal BOOLEAN,
  times_returned INTEGER,
  times_cited INTEGER,
  last_returned_at TIMESTAMP WITH TIME ZONE,
  last_cited_at TIMESTAMP WITH TIME ZONE,
  -- v2 columns
  memory_type VARCHAR,
  valid_at TIMESTAMP WITH TIME ZONE,
  invalid_at TIMESTAMP WITH TIME ZONE,
  is_latest BOOLEAN,
  source_tool VARCHAR
)
LANGUAGE plpgsql AS $$
BEGIN
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
    m.memory_type, m.valid_at, m.invalid_at, m.is_latest, m.source_tool
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
  ORDER BY relevance_score DESC
  LIMIT p_limit;
END;
$$;

-- F4: archive_decayed_memories -- UPDATE (use 5-arg confidence)
CREATE OR REPLACE FUNCTION archive_decayed_memories()
RETURNS TABLE (
  archived_id UUID,
  content_preview TEXT,
  final_confidence FLOAT,
  times_cited INTEGER,
  times_returned INTEGER,
  reason TEXT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH decayed AS (
    SELECT
      m.id,
      LEFT(m.content, 100) AS content_preview,
      calculate_current_confidence(
        m.original_confidence, m.created_at, m.times_cited, m.times_returned, m.memory_type
      ) AS conf,
      m.times_cited,
      m.times_returned,
      CASE
        WHEN m.times_returned > 5 AND m.times_cited = 0 THEN 'noise'
        WHEN m.times_cited = 0 THEN 'uncited'
        ELSE 'low-confidence'
      END AS reason
    FROM traqr_memories m
    WHERE m.is_archived = FALSE
      AND m.is_forgotten = FALSE
      AND calculate_current_confidence(
        m.original_confidence, m.created_at, m.times_cited, m.times_returned, m.memory_type
      ) < 0.3
  ),
  archived AS (
    UPDATE traqr_memories
    SET is_archived = TRUE,
        archived_at = NOW(),
        archive_reason = d.reason,
        updated_at = NOW()
    FROM decayed d
    WHERE traqr_memories.id = d.id
    RETURNING traqr_memories.id
  )
  SELECT d.id, d.content_preview, d.conf, d.times_cited, d.times_returned, d.reason
  FROM decayed d
  JOIN archived a ON a.id = d.id;
END;
$$;

-- F5: bm25_search -- NEW (dual tsvector keyword search)
CREATE OR REPLACE FUNCTION bm25_search(
  p_query_text TEXT,
  p_project_id UUID DEFAULT NULL,
  p_domain TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 20,
  p_min_score FLOAT DEFAULT 0.01
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  summary TEXT,
  bm25_score FLOAT,
  domain TEXT,
  category TEXT,
  memory_type TEXT
)
LANGUAGE plpgsql AS $$
DECLARE
  tsquery_en tsquery;
  tsquery_simple tsquery;
BEGIN
  tsquery_en := plainto_tsquery('english', p_query_text);
  tsquery_simple := plainto_tsquery('simple', p_query_text);

  RETURN QUERY
  SELECT
    m.id,
    m.content,
    m.summary::TEXT,
    GREATEST(
      ts_rank_cd(m.search_vector_en, tsquery_en),
      ts_rank_cd(m.search_vector_simple, tsquery_simple)
    )::FLOAT AS bm25_score,
    m.domain::TEXT,
    m.category::TEXT,
    m.memory_type::TEXT
  FROM traqr_memories m
  WHERE (m.search_vector_en @@ tsquery_en
         OR m.search_vector_simple @@ tsquery_simple)
    AND m.is_archived = FALSE
    AND m.is_forgotten = FALSE
    AND (m.invalid_at IS NULL OR m.invalid_at > NOW())
    AND (p_project_id IS NULL OR m.project_id = p_project_id)
    AND (p_domain IS NULL OR m.domain = p_domain)
    AND (p_category IS NULL OR m.category = p_category)
  ORDER BY bm25_score DESC
  LIMIT p_limit;
END;
$$;

-- F6: temporal_search -- NEW (valid_at range + embedding similarity)
-- CRITICAL RECONCILIATION: uses valid_at, NOT event_date (M7 decision)
CREATE OR REPLACE FUNCTION temporal_search(
  p_query_embedding vector(1536),
  p_date_start TIMESTAMPTZ,
  p_date_end TIMESTAMPTZ,
  p_project_id UUID DEFAULT NULL,
  p_similarity_threshold FLOAT DEFAULT 0.3,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  summary TEXT,
  similarity FLOAT,
  temporal_proximity FLOAT,
  valid_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
DECLARE
  date_mid TIMESTAMPTZ;
  total_days FLOAT;
BEGIN
  date_mid := p_date_start + (p_date_end - p_date_start) / 2;
  total_days := GREATEST(EXTRACT(EPOCH FROM (p_date_end - p_date_start)) / 86400.0, 1.0);

  RETURN QUERY
  SELECT
    m.id,
    m.content,
    m.summary,
    1 - (m.embedding <=> p_query_embedding) AS similarity,
    GREATEST(0.0, 1.0 - (
      ABS(EXTRACT(EPOCH FROM (m.valid_at - date_mid)) / 86400.0) / (total_days / 2.0)
    )) AS temporal_proximity,
    m.valid_at
  FROM traqr_memories m
  WHERE m.valid_at BETWEEN p_date_start AND p_date_end
    AND m.is_archived = FALSE
    AND m.is_forgotten = FALSE
    AND (p_project_id IS NULL OR m.project_id = p_project_id)
    AND 1 - (m.embedding <=> p_query_embedding) >= p_similarity_threshold
  ORDER BY similarity DESC
  LIMIT p_limit;
END;
$$;

-- F7: graph_search -- NEW (Link Expansion CTE traversing memory_relationships)
CREATE OR REPLACE FUNCTION graph_search(
  p_seed_ids UUID[],
  p_edge_types TEXT[] DEFAULT ARRAY['updates', 'extends', 'derives', 'related'],
  p_max_depth INTEGER DEFAULT 2,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  summary TEXT,
  graph_score FLOAT,
  edge_type TEXT,
  depth INTEGER
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE graph_walk AS (
    -- Seed: direct neighbors of seed memories
    SELECT
      mr.target_memory_id AS memory_id,
      mr.edge_type,
      mr.confidence AS score,
      1 AS depth
    FROM memory_relationships mr
    WHERE mr.source_memory_id = ANY(p_seed_ids)
      AND mr.edge_type = ANY(p_edge_types)

    UNION ALL

    -- Expand: neighbors of neighbors (0.7 decay per hop)
    SELECT
      mr.target_memory_id,
      mr.edge_type,
      gw.score * mr.confidence * 0.7 AS score,
      gw.depth + 1
    FROM graph_walk gw
    JOIN memory_relationships mr ON mr.source_memory_id = gw.memory_id
    WHERE gw.depth < p_max_depth
      AND mr.edge_type = ANY(p_edge_types)
  )
  SELECT
    m.id,
    m.content,
    m.summary,
    MAX(gw.score) AS graph_score,
    (ARRAY_AGG(gw.edge_type ORDER BY gw.score DESC))[1] AS edge_type,
    MIN(gw.depth) AS depth
  FROM graph_walk gw
  JOIN traqr_memories m ON m.id = gw.memory_id
  WHERE m.is_archived = FALSE AND m.is_forgotten = FALSE
  GROUP BY m.id, m.content, m.summary
  ORDER BY graph_score DESC
  LIMIT p_limit;
END;
$$;

-- F8: search_entities -- NEW (embedding-based entity lookup)
CREATE OR REPLACE FUNCTION search_entities(
  p_user_id UUID,
  p_embedding vector(1536),
  p_entity_type VARCHAR DEFAULT NULL,
  p_threshold FLOAT DEFAULT 0.85,
  p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  name VARCHAR,
  entity_type VARCHAR,
  similarity FLOAT,
  mentions_count INTEGER
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id, e.name, e.entity_type,
    1 - (e.embedding <=> p_embedding) AS similarity,
    e.mentions_count
  FROM memory_entities e
  WHERE e.user_id = p_user_id
    AND e.is_archived = FALSE
    AND (p_entity_type IS NULL OR e.entity_type = p_entity_type)
    AND 1 - (e.embedding <=> p_embedding) >= p_threshold
  ORDER BY similarity DESC
  LIMIT p_limit;
END;
$$;

-- F9: count_entity_mentions -- NEW (3+ threshold check)
CREATE OR REPLACE FUNCTION count_entity_mentions(
  p_user_id UUID,
  p_name VARCHAR
)
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  mention_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO mention_count
  FROM traqr_memories m
  WHERE m.user_id = p_user_id
    AND m.is_archived = FALSE
    AND m.is_forgotten = FALSE
    AND m.content ILIKE '%' || p_name || '%';
  RETURN mention_count;
END;
$$;

-- F10: forget_expired_memories -- NEW (daily cron function)
CREATE OR REPLACE FUNCTION forget_expired_memories()
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  forgotten_count INTEGER;
BEGIN
  WITH to_forget AS (
    UPDATE traqr_memories
    SET is_forgotten = TRUE,
        forgotten_at = NOW(),
        updated_at = NOW()
    WHERE is_forgotten = FALSE
      AND forget_after IS NOT NULL
      AND forget_after < NOW()
    RETURNING id
  )
  SELECT COUNT(*) INTO forgotten_count FROM to_forget;
  RETURN forgotten_count;
END;
$$;


-- ============================================================================
-- SECTION G: Migration Tracking Bootstrap
-- ============================================================================
-- Create _traqr_migrations table and backfill all 11 entries so the
-- migrate.ts runner works for future migrations.

CREATE TABLE IF NOT EXISTS _traqr_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO _traqr_migrations (name) VALUES
  ('001_memory_schema.sql'),
  ('002_slack_task_queue.sql'),
  ('003_cross_project_memory.sql'),
  ('004_memory_durability.sql'),
  ('005_memory_citation_tracking.sql'),
  ('006_memory_curation_functions.sql'),
  ('007_accelerated_decay.sql'),
  ('008_audit_cleanup.sql'),
  ('009_quality_audit_cleanup.sql'),
  ('010_citation_boosted_ranking.sql'),
  ('011_memory_engine_v2_schema.sql')
ON CONFLICT DO NOTHING;


-- ============================================================================
-- VERIFICATION QUERIES (run after applying to confirm success)
-- ============================================================================
-- Uncomment and run these after applying the migration.
--
-- -- 1. Verify new columns exist (should return 10 rows)
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'traqr_memories'
-- AND column_name IN ('memory_type','valid_at','invalid_at','is_latest',
--   'is_forgotten','forgotten_at','forget_after','source_tool',
--   'search_vector_en','search_vector_simple');
--
-- -- 2. Verify backfill completeness (all should be 0)
-- SELECT COUNT(*) FILTER (WHERE valid_at IS NULL) as null_valid_at,
--        COUNT(*) FILTER (WHERE is_latest IS NULL) as null_is_latest,
--        COUNT(*) FILTER (WHERE is_forgotten IS NULL) as null_is_forgotten
-- FROM traqr_memories;
--
-- -- 3. Verify memory_type distribution
-- SELECT memory_type, COUNT(*) FROM traqr_memories GROUP BY memory_type;
--
-- -- 4. Verify new tables exist (should return 4 rows)
-- SELECT tablename FROM pg_tables
-- WHERE schemaname = 'public'
-- AND tablename IN ('memory_relationships','memory_entities','memory_entity_links','schema_version');
--
-- -- 5. Verify indexes (should include idx_traqr_memories_active_embedding)
-- SELECT indexname FROM pg_indexes
-- WHERE tablename = 'traqr_memories' AND indexname LIKE 'idx_traqr%';
--
-- -- 6. Verify old HNSW is gone (should return 0 rows)
-- SELECT indexname FROM pg_indexes WHERE indexname = 'traqr_memories_embedding_idx';
--
-- -- 7. Verify calculate_current_confidence is STABLE with 5 args
-- SELECT provolatile, pg_get_function_arguments(oid)
-- FROM pg_proc WHERE proname = 'calculate_current_confidence';
--
-- -- 8. BM25 smoke test
-- SELECT * FROM bm25_search('supabase migration', NULL, NULL, NULL, 5, 0.01);
