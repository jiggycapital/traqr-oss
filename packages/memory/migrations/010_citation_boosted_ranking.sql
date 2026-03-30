-- Citation-Boosted Search Ranking
-- Migration 010: Factor citation signal into relevance scoring
--
-- Current: relevance_score = similarity * confidence
-- New:     relevance_score = similarity * confidence * (1 + ln(1 + times_cited) * 0.1)
--
-- A memory cited 3x gets ~14% boost, cited 10x gets ~24% boost.
-- Never-cited memories are unaffected (multiplier = 1.0).

-- ============================================================
-- UPDATE search_memories() with citation boost
-- ============================================================

CREATE OR REPLACE FUNCTION search_memories(
    p_query_embedding vector(1536),
    p_project_id UUID DEFAULT NULL,
    p_category VARCHAR DEFAULT NULL,
    p_tags VARCHAR[] DEFAULT NULL,
    p_include_archived BOOLEAN DEFAULT FALSE,
    p_limit INTEGER DEFAULT 10,
    p_similarity_threshold FLOAT DEFAULT 0.35
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
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    durability VARCHAR,
    is_universal BOOLEAN,
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
        -- Citation-boosted relevance: base * (1 + ln(1 + citations) * 0.1)
        (1 - (m.embedding <=> p_query_embedding))
          * calculate_current_confidence(
              m.original_confidence,
              m.last_validated,
              COALESCE(m.times_cited, 0),
              COALESCE(m.times_returned, 0)
            )
          * (1 + LN(1 + COALESCE(m.times_cited, 0)) * 0.1)
        AS relevance_score,
        m.created_at,
        m.updated_at,
        COALESCE(m.durability, 'permanent')::VARCHAR AS durability,
        COALESCE(m.is_universal, FALSE) AS is_universal,
        COALESCE(m.times_returned, 0) AS times_returned,
        COALESCE(m.times_cited, 0) AS times_cited,
        m.last_returned_at,
        m.last_cited_at
    FROM traqr_memories m
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

-- ============================================================
-- UPDATE search_memories_cross_project() with same boost
-- ============================================================

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
    p_similarity_threshold FLOAT DEFAULT 0.35
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
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    durability VARCHAR,
    is_universal BOOLEAN,
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
        (1 - (m.embedding <=> p_query_embedding))
          * calculate_current_confidence(
              m.original_confidence,
              m.last_validated,
              COALESCE(m.times_cited, 0),
              COALESCE(m.times_returned, 0)
            )
          * (1 + LN(1 + COALESCE(m.times_cited, 0)) * 0.1)
        AS relevance_score,
        m.created_at,
        m.updated_at,
        COALESCE(m.durability, 'permanent')::VARCHAR AS durability,
        COALESCE(m.is_universal, FALSE) AS is_universal,
        COALESCE(m.times_returned, 0) AS times_returned,
        COALESCE(m.times_cited, 0) AS times_cited,
        m.last_returned_at,
        m.last_cited_at
    FROM traqr_memories m
    WHERE
        (
            (p_source_project IS NOT NULL AND m.source_project = p_source_project)
            OR (p_project_id IS NOT NULL AND m.project_id = p_project_id)
            OR (p_include_portable AND COALESCE(m.is_universal, FALSE) = TRUE)
        )
        AND (p_category IS NULL OR m.category = p_category)
        AND (p_tags IS NULL OR m.tags && p_tags)
        AND (p_include_archived OR m.is_archived = FALSE)
        AND (p_agent_type IS NULL OR m.agent_type = p_agent_type)
        AND m.embedding IS NOT NULL
        AND (1 - (m.embedding <=> p_query_embedding)) >= p_similarity_threshold
    ORDER BY relevance_score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- VERIFY
-- ============================================================

-- Test citation boost:
-- A memory with 5 citations should score ~16% higher than uncited at same similarity
-- SELECT
--   1.0 * 0.9 * (1 + LN(1 + 0) * 0.1) as uncited_score,   -- 0.9
--   1.0 * 0.9 * (1 + LN(1 + 5) * 0.1) as cited_5x_score;   -- ~1.061
