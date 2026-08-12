-- ============================================================================
-- Migration 011 ROLLBACK: Memory Engine v2 Schema
-- ============================================================================
-- Emergency reversal. Reverses sections F -> A (reverse order of 011).
-- Only use if migration causes production issues.
--
-- WARNING: This drops data in new tables and restores old RPC signatures.
-- ============================================================================


-- ============================================================================
-- REVERSE SECTION G: Drop migration tracking
-- ============================================================================
DELETE FROM _traqr_migrations WHERE name = '011_memory_engine_v2_schema.sql';
-- Note: keep _traqr_migrations table itself for future use


-- ============================================================================
-- REVERSE SECTION F: Drop new RPCs, restore old versions
-- ============================================================================

-- Drop new functions
DROP FUNCTION IF EXISTS forget_expired_memories();
DROP FUNCTION IF EXISTS count_entity_mentions(UUID, VARCHAR);
DROP FUNCTION IF EXISTS search_entities(UUID, vector(1536), VARCHAR, FLOAT, INTEGER);
DROP FUNCTION IF EXISTS graph_search(UUID[], TEXT[], INTEGER, INTEGER);
DROP FUNCTION IF EXISTS temporal_search(vector(1536), TIMESTAMPTZ, TIMESTAMPTZ, UUID, FLOAT, INTEGER);
DROP FUNCTION IF EXISTS bm25_search(TEXT, UUID, TEXT, TEXT, INTEGER, FLOAT);

-- Drop v2 search_memories and restore old signatures
DROP FUNCTION IF EXISTS search_memories(
  vector(1536), UUID, VARCHAR, VARCHAR[], BOOLEAN, INTEGER, FLOAT, BOOLEAN
);
DROP FUNCTION IF EXISTS search_memories_cross_project(
  vector(1536), UUID, VARCHAR, VARCHAR, VARCHAR[], BOOLEAN, BOOLEAN, VARCHAR, INTEGER, FLOAT, BOOLEAN
);

-- Drop v2 confidence, restore old 4-arg IMMUTABLE version
DROP FUNCTION IF EXISTS calculate_current_confidence(FLOAT, TIMESTAMP WITH TIME ZONE, INTEGER, INTEGER, VARCHAR);

-- Restore old 4-arg calculate_current_confidence (from migration 007)
CREATE OR REPLACE FUNCTION calculate_current_confidence(
  p_original_confidence FLOAT,
  p_last_validated TIMESTAMP WITH TIME ZONE,
  p_times_cited INTEGER DEFAULT 0,
  p_times_returned INTEGER DEFAULT 0
)
RETURNS FLOAT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  years_elapsed FLOAT;
  decay_rate FLOAT;
BEGIN
  years_elapsed := EXTRACT(EPOCH FROM (NOW() - p_last_validated)) / 31536000.0;
  IF p_times_cited > 3 THEN
    decay_rate := 0.95;
  ELSIF p_times_cited >= 1 THEN
    decay_rate := 0.90;
  ELSIF p_times_returned > 5 AND p_times_cited = 0 THEN
    decay_rate := 0.60;
  ELSE
    decay_rate := 0.70;
  END IF;
  RETURN GREATEST(0.1, p_original_confidence * POWER(decay_rate, years_elapsed));
END;
$$;

-- Restore old search_memories (from migration 010, pre-v2)
CREATE OR REPLACE FUNCTION search_memories(
  p_query_embedding vector(1536),
  p_project_id UUID DEFAULT NULL,
  p_category VARCHAR DEFAULT NULL,
  p_tags VARCHAR[] DEFAULT NULL,
  p_include_archived BOOLEAN DEFAULT FALSE,
  p_limit INTEGER DEFAULT 10,
  p_similarity_threshold FLOAT DEFAULT 0.35
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
  last_cited_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id, m.content, m.summary, m.category, m.tags, m.context_tags,
    m.source_type, m.source_ref, m.source_project,
    m.original_confidence,
    calculate_current_confidence(m.original_confidence, m.created_at, m.times_cited, m.times_returned) AS current_confidence,
    1 - (m.embedding <=> p_query_embedding) AS similarity,
    (1 - (m.embedding <=> p_query_embedding))
      * calculate_current_confidence(m.original_confidence, m.created_at, m.times_cited, m.times_returned)
      * (1 + ln(1 + m.times_cited) * 0.1) AS relevance_score,
    m.created_at, m.updated_at, m.durability, m.is_universal,
    m.times_returned, m.times_cited, m.last_returned_at, m.last_cited_at
  FROM traqr_memories m
  WHERE (p_include_archived OR m.is_archived = FALSE)
    AND (p_project_id IS NULL OR m.project_id = p_project_id)
    AND (p_category IS NULL OR m.category = p_category)
    AND (p_tags IS NULL OR m.tags && p_tags)
    AND 1 - (m.embedding <=> p_query_embedding) >= p_similarity_threshold
  ORDER BY relevance_score DESC
  LIMIT p_limit;
END;
$$;

-- Restore old archive_decayed_memories (4-arg confidence)
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
      calculate_current_confidence(m.original_confidence, m.created_at, m.times_cited, m.times_returned) AS conf,
      m.times_cited,
      m.times_returned,
      CASE
        WHEN m.times_returned > 5 AND m.times_cited = 0 THEN 'noise'
        WHEN m.times_cited = 0 THEN 'uncited'
        ELSE 'low-confidence'
      END AS reason
    FROM traqr_memories m
    WHERE m.is_archived = FALSE
      AND calculate_current_confidence(m.original_confidence, m.created_at, m.times_cited, m.times_returned) < 0.3
  ),
  archived AS (
    UPDATE traqr_memories
    SET is_archived = TRUE, archived_at = NOW(), archive_reason = d.reason, updated_at = NOW()
    FROM decayed d
    WHERE traqr_memories.id = d.id
    RETURNING traqr_memories.id
  )
  SELECT d.id, d.content_preview, d.conf, d.times_cited, d.times_returned, d.reason
  FROM decayed d
  JOIN archived a ON a.id = d.id;
END;
$$;


-- ============================================================================
-- REVERSE SECTION D: Restore full-table HNSW, drop lifecycle indexes
-- ============================================================================
DROP INDEX IF EXISTS idx_traqr_memories_active_embedding;
DROP INDEX IF EXISTS idx_traqr_memories_memory_type;
DROP INDEX IF EXISTS idx_traqr_memories_is_latest;
DROP INDEX IF EXISTS idx_traqr_memories_forgotten;
DROP INDEX IF EXISTS idx_traqr_memories_forget_after;
DROP INDEX IF EXISTS idx_traqr_memories_source_tool;
DROP INDEX IF EXISTS idx_traqr_memories_valid_at;
DROP INDEX IF EXISTS idx_traqr_memories_temporal;
DROP INDEX IF EXISTS idx_traqr_memories_search_en;
DROP INDEX IF EXISTS idx_traqr_memories_search_simple;

-- Restore full-table HNSW
CREATE INDEX traqr_memories_embedding_idx
  ON traqr_memories USING hnsw (embedding vector_cosine_ops);


-- ============================================================================
-- REVERSE SECTION C: Drop new tables (CASCADE handles FKs)
-- ============================================================================
DROP TABLE IF EXISTS memory_entity_links CASCADE;
DROP TABLE IF EXISTS memory_entities CASCADE;
DROP TABLE IF EXISTS memory_relationships CASCADE;
DROP TABLE IF EXISTS schema_version CASCADE;


-- ============================================================================
-- REVERSE SECTION B: Drop tsvector columns and helper functions
-- ============================================================================
ALTER TABLE traqr_memories DROP COLUMN IF EXISTS search_vector_en;
ALTER TABLE traqr_memories DROP COLUMN IF EXISTS search_vector_simple;
DROP FUNCTION IF EXISTS traqr_tsvector_en(text, text, text[]);
DROP FUNCTION IF EXISTS traqr_tsvector_simple(text, text, text[]);


-- ============================================================================
-- REVERSE SECTION A: Drop new columns
-- ============================================================================
ALTER TABLE traqr_memories DROP CONSTRAINT IF EXISTS chk_memory_type;
ALTER TABLE traqr_memories
  DROP COLUMN IF EXISTS memory_type,
  DROP COLUMN IF EXISTS valid_at,
  DROP COLUMN IF EXISTS invalid_at,
  DROP COLUMN IF EXISTS is_latest,
  DROP COLUMN IF EXISTS is_forgotten,
  DROP COLUMN IF EXISTS forgotten_at,
  DROP COLUMN IF EXISTS forget_after,
  DROP COLUMN IF EXISTS source_tool;
