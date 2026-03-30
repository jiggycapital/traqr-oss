-- Memory Citation Tracking
-- Migration 026: Add citation and return tracking columns to memories
--
-- Closes the feedback loop: know which memories are actually useful
-- vs. returned but never cited (noise).

-- ============================================================
-- ADD TRACKING COLUMNS
-- ============================================================

ALTER TABLE memories ADD COLUMN IF NOT EXISTS times_returned INTEGER DEFAULT 0;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS times_cited INTEGER DEFAULT 0;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS last_returned_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS last_cited_at TIMESTAMP WITH TIME ZONE;

-- Index for finding uncited but frequently returned memories (noise detection)
CREATE INDEX IF NOT EXISTS memories_citation_idx
    ON memories(times_returned, times_cited)
    WHERE is_archived = FALSE;

-- Index for finding most-cited memories (gold)
CREATE INDEX IF NOT EXISTS memories_cited_idx
    ON memories(times_cited DESC)
    WHERE times_cited > 0 AND is_archived = FALSE;

-- ============================================================
-- CITATION-AWARE DECAY FUNCTION
-- ============================================================

-- Replace the decay function with citation-aware version
-- Decay rates:
--   Uncited & returned >5x (noise):  40%/year
--   Uncited:                         30%/year (~6mo to archive)
--   Cited 1-3x:                      10%/year
--   Cited >3x:                        5%/year (proven valuable)
CREATE OR REPLACE FUNCTION calculate_current_confidence(
    p_original_confidence FLOAT,
    p_last_validated TIMESTAMP WITH TIME ZONE,
    p_times_cited INTEGER DEFAULT 0,
    p_times_returned INTEGER DEFAULT 0
) RETURNS FLOAT AS $$
DECLARE
    years_since_validation FLOAT;
    decay_rate FLOAT;
    decayed_confidence FLOAT;
BEGIN
    years_since_validation := EXTRACT(EPOCH FROM (NOW() - p_last_validated)) / (365.25 * 24 * 60 * 60);

    -- Citation-aware decay rate
    IF p_times_cited > 3 THEN
        decay_rate := 0.05;  -- Proven valuable: slow decay
    ELSIF p_times_cited >= 1 THEN
        decay_rate := 0.10;  -- Some citations: original rate
    ELSIF p_times_returned > 5 THEN
        decay_rate := 0.40;  -- Returned often but never cited: noise
    ELSE
        decay_rate := 0.30;  -- Default uncited: ~6 months to archive
    END IF;

    decayed_confidence := p_original_confidence * POWER(1 - decay_rate, years_since_validation);
    RETURN GREATEST(decayed_confidence, 0.1);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- UPDATE SEARCH FUNCTIONS TO USE NEW DECAY
-- ============================================================

-- Update the standard search function
CREATE OR REPLACE FUNCTION search_memories(
    p_query_embedding vector(1536),
    p_project_id UUID DEFAULT NULL,
    p_category VARCHAR DEFAULT NULL,
    p_tags VARCHAR[] DEFAULT NULL,
    p_include_archived BOOLEAN DEFAULT FALSE,
    p_limit INTEGER DEFAULT 10,
    p_similarity_threshold FLOAT DEFAULT 0.3
) RETURNS TABLE (
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
    is_universal BOOLEAN,
    agent_type VARCHAR,
    last_validated TIMESTAMP WITH TIME ZONE,
    related_to UUID[],
    is_contradiction BOOLEAN,
    is_archived BOOLEAN,
    archive_reason VARCHAR,
    archived_at TIMESTAMP WITH TIME ZONE,
    embedding_model VARCHAR,
    embedding_model_version VARCHAR,
    durability VARCHAR,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    times_returned INTEGER,
    times_cited INTEGER,
    last_returned_at TIMESTAMP WITH TIME ZONE,
    last_cited_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.id,
        m.content,
        m.summary,
        m.category,
        m.tags,
        m.context_tags,
        m.source_type,
        m.source_ref,
        m.source_project,
        m.original_confidence,
        calculate_current_confidence(
            m.original_confidence,
            m.last_validated,
            COALESCE(m.times_cited, 0),
            COALESCE(m.times_returned, 0)
        ) AS current_confidence,
        1 - (m.embedding <=> p_query_embedding) AS similarity,
        (1 - (m.embedding <=> p_query_embedding)) * calculate_current_confidence(
            m.original_confidence,
            m.last_validated,
            COALESCE(m.times_cited, 0),
            COALESCE(m.times_returned, 0)
        ) AS relevance_score,
        COALESCE(m.is_universal, FALSE) AS is_universal,
        m.agent_type,
        m.last_validated,
        m.related_to,
        m.is_contradiction,
        m.is_archived,
        m.archive_reason,
        m.archived_at,
        m.embedding_model,
        m.embedding_model_version,
        m.durability,
        m.expires_at,
        m.created_at,
        m.updated_at,
        COALESCE(m.times_returned, 0) AS times_returned,
        COALESCE(m.times_cited, 0) AS times_cited,
        m.last_returned_at,
        m.last_cited_at
    FROM memories m
    WHERE
        (p_project_id IS NULL OR m.project_id = p_project_id)
        AND (p_category IS NULL OR m.category = p_category)
        AND (p_tags IS NULL OR m.tags && p_tags)
        AND (p_include_archived OR m.is_archived = FALSE)
        AND m.embedding IS NOT NULL
        AND (1 - (m.embedding <=> p_query_embedding)) >= p_similarity_threshold
    ORDER BY relevance_score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- Update the cross-project search function
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
    p_similarity_threshold FLOAT DEFAULT 0.3
) RETURNS TABLE (
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
    is_universal BOOLEAN,
    agent_type VARCHAR,
    last_validated TIMESTAMP WITH TIME ZONE,
    related_to UUID[],
    is_contradiction BOOLEAN,
    is_archived BOOLEAN,
    archive_reason VARCHAR,
    archived_at TIMESTAMP WITH TIME ZONE,
    embedding_model VARCHAR,
    embedding_model_version VARCHAR,
    durability VARCHAR,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    times_returned INTEGER,
    times_cited INTEGER,
    last_returned_at TIMESTAMP WITH TIME ZONE,
    last_cited_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.id,
        m.content,
        m.summary,
        m.category,
        m.tags,
        m.context_tags,
        m.source_type,
        m.source_ref,
        m.source_project,
        m.original_confidence,
        calculate_current_confidence(
            m.original_confidence,
            m.last_validated,
            COALESCE(m.times_cited, 0),
            COALESCE(m.times_returned, 0)
        ) AS current_confidence,
        1 - (m.embedding <=> p_query_embedding) AS similarity,
        (1 - (m.embedding <=> p_query_embedding)) * calculate_current_confidence(
            m.original_confidence,
            m.last_validated,
            COALESCE(m.times_cited, 0),
            COALESCE(m.times_returned, 0)
        ) AS relevance_score,
        COALESCE(m.is_universal, FALSE) AS is_universal,
        m.agent_type,
        m.last_validated,
        m.related_to,
        m.is_contradiction,
        m.is_archived,
        m.archive_reason,
        m.archived_at,
        m.embedding_model,
        m.embedding_model_version,
        m.durability,
        m.expires_at,
        m.created_at,
        m.updated_at,
        COALESCE(m.times_returned, 0) AS times_returned,
        COALESCE(m.times_cited, 0) AS times_cited,
        m.last_returned_at,
        m.last_cited_at
    FROM memories m
    WHERE
        (p_project_id IS NULL OR m.project_id = p_project_id)
        AND (
            p_source_project IS NULL
            OR m.source_project = p_source_project
            OR (p_include_portable AND m.is_portable = TRUE)
        )
        AND (p_category IS NULL OR m.category = p_category)
        AND (p_tags IS NULL OR m.tags && p_tags)
        AND (p_agent_type IS NULL OR m.agent_type = p_agent_type)
        AND (p_include_archived OR m.is_archived = FALSE)
        AND m.embedding IS NOT NULL
        AND (1 - (m.embedding <=> p_query_embedding)) >= p_similarity_threshold
    ORDER BY
        CASE WHEN m.is_portable = TRUE AND p_include_portable THEN 0.05 ELSE 0 END
        + (1 - (m.embedding <=> p_query_embedding)) * calculate_current_confidence(
            m.original_confidence,
            m.last_validated,
            COALESCE(m.times_cited, 0),
            COALESCE(m.times_returned, 0)
        ) DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- HELPER: Batch increment returns (fire-and-forget from context assembly)
-- ============================================================

CREATE OR REPLACE FUNCTION increment_memory_returns(p_memory_ids UUID[])
RETURNS void AS $$
BEGIN
    UPDATE memories
    SET
        times_returned = COALESCE(times_returned, 0) + 1,
        last_returned_at = NOW()
    WHERE id = ANY(p_memory_ids)
      AND is_archived = FALSE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- HELPER: Record a citation (resets decay timer)
-- ============================================================

CREATE OR REPLACE FUNCTION cite_memory(p_memory_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE memories
    SET
        times_cited = COALESCE(times_cited, 0) + 1,
        last_cited_at = NOW(),
        last_validated = NOW()  -- Citation = validation, resets decay timer
    WHERE id = p_memory_id
      AND is_archived = FALSE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- VERIFY MIGRATION
-- ============================================================

-- Run these to verify:
-- SELECT id, times_returned, times_cited, last_returned_at, last_cited_at FROM memories LIMIT 5;
-- SELECT calculate_current_confidence(0.9, NOW() - INTERVAL '1 year', 0, 10);  -- noise: high decay
-- SELECT calculate_current_confidence(0.9, NOW() - INTERVAL '1 year', 5, 10);  -- cited: low decay
