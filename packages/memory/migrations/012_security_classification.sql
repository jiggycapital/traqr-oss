-- ============================================================================
-- Migration 012: Security Classification & Client Namespace (Glasswing Red Alert)
-- ============================================================================
-- TD-711: Memory classification tiers (public/internal/confidential/restricted)
-- TD-712: Client namespace isolation (separate vector spaces per client)
-- TD-713: Audit logging (every memory operation tracked)
--
-- These three are the FOUNDATION — M4-M7 build on top.
-- Safe to re-run: all operations use IF NOT EXISTS / CREATE OR REPLACE.
-- ============================================================================


-- ============================================================================
-- SECTION A: Classification & Namespace Columns (TD-711, TD-712)
-- ============================================================================

-- Classification tiers for memory sensitivity
ALTER TABLE traqr_memories
  ADD COLUMN IF NOT EXISTS classification VARCHAR(20) DEFAULT 'internal';

DO $$
BEGIN
  ALTER TABLE traqr_memories
    ADD CONSTRAINT chk_classification CHECK (
      classification IN ('public', 'internal', 'confidential', 'restricted')
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Client namespace for data isolation
ALTER TABLE traqr_memories
  ADD COLUMN IF NOT EXISTS client_namespace VARCHAR(100) DEFAULT NULL;

-- PII flag for automated detection
ALTER TABLE traqr_memories
  ADD COLUMN IF NOT EXISTS contains_pii BOOLEAN DEFAULT FALSE;

-- Indexes for classification and namespace queries
CREATE INDEX IF NOT EXISTS idx_traqr_memories_classification
  ON traqr_memories(classification)
  WHERE is_archived = FALSE AND is_forgotten = FALSE;

CREATE INDEX IF NOT EXISTS idx_traqr_memories_client_namespace
  ON traqr_memories(client_namespace)
  WHERE client_namespace IS NOT NULL AND is_archived = FALSE;

CREATE INDEX IF NOT EXISTS idx_traqr_memories_pii
  ON traqr_memories(contains_pii)
  WHERE contains_pii = TRUE;


-- ============================================================================
-- SECTION B: Audit Log Table (TD-713)
-- ============================================================================

CREATE TABLE IF NOT EXISTS memory_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  operation VARCHAR(20) NOT NULL,
  agent_id VARCHAR(50),
  session_id VARCHAR(100),
  query_text TEXT,
  memory_ids UUID[],
  result_count INTEGER DEFAULT 0,
  client_namespace VARCHAR(100),
  classification_level VARCHAR(20),
  access_level VARCHAR(20),
  metadata JSONB DEFAULT '{}',
  CONSTRAINT chk_audit_operation CHECK (
    operation IN ('search', 'read', 'store', 'update', 'archive', 'enhance', 'forget', 'delete', 'browse', 'export')
  )
);

-- Indexes for audit queries
CREATE INDEX IF NOT EXISTS idx_audit_timestamp
  ON memory_audit_log(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_audit_agent
  ON memory_audit_log(agent_id);

CREATE INDEX IF NOT EXISTS idx_audit_namespace
  ON memory_audit_log(client_namespace)
  WHERE client_namespace IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_operation
  ON memory_audit_log(operation);

-- RLS for audit log
ALTER TABLE memory_audit_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role full access on audit_log"
    ON memory_audit_log FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ============================================================================
-- SECTION C: Updated Search Function with Classification & Namespace (TD-711, TD-712)
-- ============================================================================

-- Drop old signature to allow return type changes
DROP FUNCTION IF EXISTS search_memories(
  vector(1536), UUID, VARCHAR, VARCHAR[], BOOLEAN, INTEGER, FLOAT, BOOLEAN
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
  -- NEW: Security parameters
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
  -- NEW: Security columns in result
  classification VARCHAR,
  client_namespace VARCHAR,
  contains_pii BOOLEAN
)
LANGUAGE plpgsql AS $$
DECLARE
  classification_rank INTEGER;
BEGIN
  -- Map classification to rank for comparison
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
    m.classification, m.client_namespace, m.contains_pii
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
    -- NULL namespace = Sean's personal memories (always visible)
    -- Non-null namespace = client data (only visible if matching or no namespace filter)
    AND (
      p_client_namespace IS NULL  -- no namespace filter = see personal + all client data (admin mode)
      OR m.client_namespace IS NULL  -- personal memories always visible
      OR m.client_namespace = p_client_namespace  -- matching namespace
    )
  ORDER BY relevance_score DESC
  LIMIT p_limit;
END;
$$;


-- ============================================================================
-- SECTION D: Audit Logging Function (TD-713)
-- ============================================================================

CREATE OR REPLACE FUNCTION log_memory_operation(
  p_operation VARCHAR,
  p_agent_id VARCHAR DEFAULT NULL,
  p_session_id VARCHAR DEFAULT NULL,
  p_query_text TEXT DEFAULT NULL,
  p_memory_ids UUID[] DEFAULT NULL,
  p_result_count INTEGER DEFAULT 0,
  p_client_namespace VARCHAR DEFAULT NULL,
  p_classification_level VARCHAR DEFAULT NULL,
  p_access_level VARCHAR DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  log_id UUID;
BEGIN
  INSERT INTO memory_audit_log (
    operation, agent_id, session_id, query_text,
    memory_ids, result_count, client_namespace,
    classification_level, access_level, metadata
  ) VALUES (
    p_operation, p_agent_id, p_session_id, p_query_text,
    p_memory_ids, p_result_count, p_client_namespace,
    p_classification_level, p_access_level, p_metadata
  )
  RETURNING id INTO log_id;

  RETURN log_id;
END;
$$;


-- ============================================================================
-- SECTION E: Backfill Classification for Existing Memories
-- ============================================================================

-- Default all existing memories to 'internal' (already the column default)
-- This is a no-op since the DEFAULT handles it, but explicit for clarity
UPDATE traqr_memories
SET classification = 'internal'
WHERE classification IS NULL;

-- Flag memories that likely contain sensitive content as 'confidential'
-- Heuristic: memories with financial amounts, phone numbers, or email addresses
UPDATE traqr_memories
SET classification = 'confidential',
    contains_pii = TRUE
WHERE (
  content ~* '\$\d{1,3}(,\d{3})*(\.\d{2})?' -- dollar amounts
  OR content ~* '\b\d{3}[-.]?\d{3}[-.]?\d{4}\b' -- phone numbers
  OR content ~* '\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b' -- email addresses
)
AND classification = 'internal';

-- Flag memories mentioning specific sensitive topics as 'restricted'
UPDATE traqr_memories
SET classification = 'restricted'
WHERE (
  content ILIKE '%psychoanalysis%'
  OR content ILIKE '%addictive personality%'
  OR content ILIKE '%medication%'
  OR (content ILIKE '%AWS%' AND content ILIKE '%internal%')
  OR content ILIKE '%salary%'
  OR content ILIKE '%SSN%'
)
AND classification != 'restricted';


-- ============================================================================
-- SECTION F: Migration Tracking
-- ============================================================================

INSERT INTO _traqr_migrations (name) VALUES ('012_security_classification.sql')
ON CONFLICT DO NOTHING;

INSERT INTO schema_version (version, description)
VALUES (3, 'Security Infrastructure v1 -- classification, namespaces, audit logging (Glasswing Red Alert)')
ON CONFLICT (version) DO NOTHING;
