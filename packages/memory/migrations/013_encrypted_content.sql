-- ============================================================================
-- Migration 013: Application-Level Encryption (TD-715, Glasswing Red Alert)
-- ============================================================================
-- Adds encrypted content storage for confidential/restricted memories.
-- Content is encrypted with AES-256-GCM before storage; the content column
-- is replaced with a placeholder for encrypted rows.
--
-- Requires: TRAQR_ENCRYPTION_KEY env var (64 hex chars = 32 bytes)
-- Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
--
-- Safe to re-run: all operations use IF NOT EXISTS.
-- ============================================================================


-- ============================================================================
-- SECTION A: Encrypted Content Columns
-- ============================================================================

ALTER TABLE traqr_memories
  ADD COLUMN IF NOT EXISTS encrypted_content TEXT;

ALTER TABLE traqr_memories
  ADD COLUMN IF NOT EXISTS encryption_iv VARCHAR(48);

ALTER TABLE traqr_memories
  ADD COLUMN IF NOT EXISTS encryption_tag VARCHAR(48);

ALTER TABLE traqr_memories
  ADD COLUMN IF NOT EXISTS encryption_key_version INTEGER DEFAULT NULL;

-- Index for quickly finding encrypted rows (for re-encryption / key rotation)
CREATE INDEX IF NOT EXISTS idx_traqr_memories_encrypted
  ON traqr_memories(encryption_key_version)
  WHERE encrypted_content IS NOT NULL;


-- ============================================================================
-- SECTION B: Updated search_memories with encryption columns in result
-- ============================================================================

-- Drop old signature to allow return type changes
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
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE,
  durability VARCHAR,
  is_universal BOOLEAN,
  times_returned INTEGER,
  times_cited INTEGER,
  last_returned_at TIMESTAMP WITH TIME ZONE,
  last_cited_at TIMESTAMP WITH TIME ZONE,
  memory_type VARCHAR,
  valid_at TIMESTAMP WITH TIME ZONE,
  invalid_at TIMESTAMP WITH TIME ZONE,
  is_latest BOOLEAN,
  source_tool VARCHAR,
  -- Security columns (from 012)
  classification VARCHAR,
  client_namespace VARCHAR,
  contains_pii BOOLEAN,
  -- Encryption columns (new in 013)
  encrypted_content TEXT,
  encryption_iv VARCHAR,
  encryption_tag VARCHAR,
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
-- SECTION C: Migration Tracking
-- ============================================================================

INSERT INTO _traqr_migrations (name) VALUES ('013_encrypted_content.sql')
ON CONFLICT DO NOTHING;

INSERT INTO schema_version (version, description)
VALUES (4, 'Application-level encryption for confidential/restricted memories (TD-715)')
ON CONFLICT (version) DO NOTHING;
