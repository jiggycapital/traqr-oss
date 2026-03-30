-- Cross-Project Memory Support
-- Migration 008: Add is_universal flag and cross-project search
--
-- This enables universal patterns to surface across all projects
-- while keeping project-specific memories isolated.

-- ============================================================
-- ADD UNIVERSAL FLAG TO MEMORIES
-- ============================================================

-- Add is_universal column if it doesn't exist
ALTER TABLE memories ADD COLUMN IF NOT EXISTS is_universal BOOLEAN DEFAULT FALSE;

-- Create index for universal memories (filtered index for efficiency)
CREATE INDEX IF NOT EXISTS memories_universal_idx
    ON memories(is_universal)
    WHERE is_universal = TRUE;

-- Composite index for cross-project queries
CREATE INDEX IF NOT EXISTS memories_universal_category_idx
    ON memories(is_universal, category)
    WHERE is_universal = TRUE;

-- ============================================================
-- AGENT MEMORY SUPPORT
-- ============================================================

-- Add agent_type column for per-agent memory
ALTER TABLE memories ADD COLUMN IF NOT EXISTS agent_type VARCHAR(50);

-- Index for agent-specific queries
CREATE INDEX IF NOT EXISTS memories_agent_type_idx
    ON memories(agent_type)
    WHERE agent_type IS NOT NULL;

-- ============================================================
-- UPDATED SEARCH FUNCTION
-- ============================================================

-- Enhanced search function with cross-project support
CREATE OR REPLACE FUNCTION search_memories_cross_project(
    p_query_embedding vector(1536),
    p_domain_id UUID DEFAULT NULL,
    p_source_project VARCHAR DEFAULT NULL,
    p_category VARCHAR DEFAULT NULL,
    p_tags VARCHAR[] DEFAULT NULL,
    p_include_archived BOOLEAN DEFAULT FALSE,
    p_include_universal BOOLEAN DEFAULT TRUE,
    p_agent_type VARCHAR DEFAULT NULL,
    p_limit INTEGER DEFAULT 10,
    p_similarity_threshold FLOAT DEFAULT 0.3
) RETURNS TABLE (
    id UUID,
    content TEXT,
    summary VARCHAR,
    category VARCHAR,
    tags VARCHAR[],
    source_type VARCHAR,
    source_ref VARCHAR,
    source_project VARCHAR,
    original_confidence FLOAT,
    current_confidence FLOAT,
    similarity FLOAT,
    relevance_score FLOAT,
    is_universal BOOLEAN,
    agent_type VARCHAR,
    created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.id,
        m.content,
        m.summary,
        m.category,
        m.tags,
        m.source_type,
        m.source_ref,
        m.source_project,
        m.original_confidence,
        calculate_current_confidence(m.original_confidence, m.last_validated) AS current_confidence,
        1 - (m.embedding <=> p_query_embedding) AS similarity,
        (1 - (m.embedding <=> p_query_embedding)) * calculate_current_confidence(m.original_confidence, m.last_validated) AS relevance_score,
        COALESCE(m.is_universal, FALSE) AS is_universal,
        m.agent_type,
        m.created_at
    FROM memories m
    WHERE
        -- Domain filter (optional)
        (p_domain_id IS NULL OR m.domain_id = p_domain_id)
        -- Source project filter OR universal memories
        AND (
            p_source_project IS NULL
            OR m.source_project = p_source_project
            OR (p_include_universal AND m.is_universal = TRUE)
        )
        -- Category filter
        AND (p_category IS NULL OR m.category = p_category)
        -- Tags filter
        AND (p_tags IS NULL OR m.tags && p_tags)
        -- Agent type filter
        AND (p_agent_type IS NULL OR m.agent_type = p_agent_type)
        -- Archive filter
        AND (p_include_archived OR m.is_archived = FALSE)
        -- Must have embedding
        AND m.embedding IS NOT NULL
        -- Similarity threshold
        AND (1 - (m.embedding <=> p_query_embedding)) >= p_similarity_threshold
    ORDER BY
        -- Boost universal patterns slightly in cross-project mode
        CASE WHEN m.is_universal = TRUE AND p_include_universal THEN 0.05 ELSE 0 END
        + (1 - (m.embedding <=> p_query_embedding)) * calculate_current_confidence(m.original_confidence, m.last_validated) DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- UNIVERSAL PATTERNS VIEW
-- ============================================================

-- View for easily querying universal patterns
CREATE OR REPLACE VIEW universal_patterns AS
SELECT
    m.id,
    m.content,
    m.summary,
    m.category,
    m.tags,
    m.source_type,
    m.source_ref,
    m.source_project,
    m.original_confidence,
    calculate_current_confidence(m.original_confidence, m.last_validated) AS current_confidence,
    m.agent_type,
    m.created_at,
    m.updated_at
FROM memories m
WHERE m.is_universal = TRUE
  AND m.is_archived = FALSE
ORDER BY m.created_at DESC;

-- ============================================================
-- AGENT MEMORIES VIEW
-- ============================================================

-- View for per-agent memory queries
CREATE OR REPLACE VIEW agent_memories AS
SELECT
    m.id,
    m.content,
    m.summary,
    m.category,
    m.tags,
    m.agent_type,
    m.source_type,
    m.source_ref,
    m.source_project,
    m.original_confidence,
    calculate_current_confidence(m.original_confidence, m.last_validated) AS current_confidence,
    m.created_at,
    m.updated_at
FROM memories m
WHERE m.agent_type IS NOT NULL
  AND m.is_archived = FALSE
ORDER BY m.agent_type, m.created_at DESC;

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Function to mark a memory as universal
CREATE OR REPLACE FUNCTION mark_memory_universal(
    p_memory_id UUID,
    p_is_universal BOOLEAN DEFAULT TRUE
) RETURNS BOOLEAN AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    UPDATE memories
    SET
        is_universal = p_is_universal,
        updated_at = NOW()
    WHERE id = p_memory_id;

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count > 0;
END;
$$ LANGUAGE plpgsql;

-- Function to get universal pattern count by category
CREATE OR REPLACE FUNCTION get_universal_pattern_stats()
RETURNS TABLE (
    category VARCHAR,
    pattern_count BIGINT,
    avg_confidence FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.category,
        COUNT(*) AS pattern_count,
        AVG(calculate_current_confidence(m.original_confidence, m.last_validated)) AS avg_confidence
    FROM memories m
    WHERE m.is_universal = TRUE
      AND m.is_archived = FALSE
    GROUP BY m.category
    ORDER BY pattern_count DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to get agent memory stats
CREATE OR REPLACE FUNCTION get_agent_memory_stats()
RETURNS TABLE (
    agent_type VARCHAR,
    memory_count BIGINT,
    avg_confidence FLOAT,
    most_recent TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.agent_type,
        COUNT(*) AS memory_count,
        AVG(calculate_current_confidence(m.original_confidence, m.last_validated)) AS avg_confidence,
        MAX(m.created_at) AS most_recent
    FROM memories m
    WHERE m.agent_type IS NOT NULL
      AND m.is_archived = FALSE
    GROUP BY m.agent_type
    ORDER BY memory_count DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- SEED UNIVERSAL PATTERNS
-- ============================================================

-- Mark common gotchas as universal (these apply across Vercel projects)
UPDATE memories
SET is_universal = TRUE
WHERE category = 'gotcha'
  AND (
    content ILIKE '%vercel%cron%'
    OR content ILIKE '%vercel%hobby%'
    OR content ILIKE '%posthog%distinct_id%'
    OR content ILIKE '%slack%thread_ts%'
  )
  AND is_universal IS DISTINCT FROM TRUE;

-- Mark portable skills as universal
UPDATE memories
SET is_universal = TRUE
WHERE tags @> ARRAY['portable-skill']
  AND is_universal IS DISTINCT FROM TRUE;

-- ============================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================

COMMENT ON COLUMN memories.is_universal IS
    'If TRUE, this memory surfaces across all projects. Use for patterns like Vercel limits, API gotchas, etc.';

COMMENT ON COLUMN memories.agent_type IS
    'Agent that created this memory: staff-engineer, feature-slot, bugfix-slot, devops-slot, advisor';

COMMENT ON FUNCTION search_memories_cross_project IS
    'Enhanced search that includes universal patterns in cross-project queries';

COMMENT ON VIEW universal_patterns IS
    'Convenience view for universal patterns that apply across projects';

COMMENT ON VIEW agent_memories IS
    'Convenience view for per-agent memories grouped by agent type';

-- ============================================================
-- VERIFY MIGRATION
-- ============================================================

-- Run these to verify:
-- SELECT COUNT(*) FROM memories WHERE is_universal = TRUE;
-- SELECT * FROM universal_patterns LIMIT 5;
-- SELECT * FROM get_universal_pattern_stats();
-- SELECT * FROM get_agent_memory_stats();
