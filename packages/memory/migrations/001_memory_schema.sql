-- Traqr Universal Memory Vector DB Schema
-- Migration 005: Memory system with pgvector for semantic search
-- Run this in Supabase SQL Editor

-- ============================================================
-- ENABLE REQUIRED EXTENSIONS
-- ============================================================

-- Vector storage and search
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- USER IDENTITY (for cross-project use in future)
-- ============================================================

CREATE TABLE IF NOT EXISTS memory_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key VARCHAR(64) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on api_key for fast lookups
CREATE INDEX IF NOT EXISTS memory_users_api_key_idx ON memory_users(api_key);

-- ============================================================
-- DOMAIN ISOLATION (project separation)
-- ============================================================

CREATE TABLE IF NOT EXISTS memory_domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES memory_users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_shareable BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, name)
);

-- Create index for user lookups
CREATE INDEX IF NOT EXISTS memory_domains_user_idx ON memory_domains(user_id);

-- ============================================================
-- CORE MEMORIES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_id UUID REFERENCES memory_domains(id) ON DELETE CASCADE,

    -- Content
    content TEXT NOT NULL,
    summary VARCHAR(500),

    -- Categorization
    category VARCHAR(50),  -- 'gotcha', 'pattern', 'fix', 'insight', 'question'
    tags VARCHAR(100)[] DEFAULT '{}',
    context_tags VARCHAR(100)[] DEFAULT '{}',  -- Context when this applies

    -- Embedding (1536 dimensions for OpenAI text-embedding-3-small)
    embedding vector(1536),
    embedding_model VARCHAR(100) DEFAULT 'openai/text-embedding-3-small',
    embedding_model_version VARCHAR(20) DEFAULT 'v1',
    needs_reembedding BOOLEAN DEFAULT FALSE,

    -- Provenance
    source_type VARCHAR(50),  -- 'pr', 'manual', 'extracted', 'bootstrap'
    source_ref VARCHAR(255),  -- PR number, file path, etc.
    source_project VARCHAR(100) DEFAULT 'default',

    -- Confidence & Decay
    original_confidence FLOAT DEFAULT 1.0,
    last_validated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Version relationships (keep both versions, don't supersede)
    related_to UUID[] DEFAULT '{}',
    is_contradiction BOOLEAN DEFAULT FALSE,

    -- Archive
    is_archived BOOLEAN DEFAULT FALSE,
    archived_at TIMESTAMP WITH TIME ZONE,
    archive_reason VARCHAR(50),  -- 'decay', 'manual', 'duplicate'

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- HNSW index for fast vector similarity search
-- Using cosine distance (best for semantic similarity)
CREATE INDEX IF NOT EXISTS memories_embedding_idx ON memories
    USING hnsw (embedding vector_cosine_ops);

-- Additional indexes for common queries
CREATE INDEX IF NOT EXISTS memories_domain_idx ON memories(domain_id);
CREATE INDEX IF NOT EXISTS memories_tags_idx ON memories USING gin(tags);
CREATE INDEX IF NOT EXISTS memories_category_idx ON memories(category);
CREATE INDEX IF NOT EXISTS memories_source_project_idx ON memories(source_project);
CREATE INDEX IF NOT EXISTS memories_archived_idx ON memories(is_archived);
CREATE INDEX IF NOT EXISTS memories_created_idx ON memories(created_at DESC);

-- ============================================================
-- MEMORY HISTORY (for evolution tracking)
-- ============================================================

CREATE TABLE IF NOT EXISTS memory_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id UUID REFERENCES memories(id) ON DELETE CASCADE,
    previous_content TEXT,
    previous_embedding vector(1536),
    previous_confidence FLOAT,
    change_reason TEXT,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS memory_history_memory_idx ON memory_history(memory_id);
CREATE INDEX IF NOT EXISTS memory_history_changed_idx ON memory_history(changed_at DESC);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Function to calculate current confidence with decay
-- 10% decay per year, floor at 0.1
CREATE OR REPLACE FUNCTION calculate_current_confidence(
    p_original_confidence FLOAT,
    p_last_validated TIMESTAMP WITH TIME ZONE
) RETURNS FLOAT AS $$
DECLARE
    years_since_validation FLOAT;
    decay_rate FLOAT := 0.1;
    decayed_confidence FLOAT;
BEGIN
    years_since_validation := EXTRACT(EPOCH FROM (NOW() - p_last_validated)) / (365.25 * 24 * 60 * 60);
    decayed_confidence := p_original_confidence * POWER(1 - decay_rate, years_since_validation);
    RETURN GREATEST(decayed_confidence, 0.1);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to search memories with decay-adjusted ranking
CREATE OR REPLACE FUNCTION search_memories(
    p_query_embedding vector(1536),
    p_domain_id UUID DEFAULT NULL,
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
    source_type VARCHAR,
    source_ref VARCHAR,
    source_project VARCHAR,
    original_confidence FLOAT,
    current_confidence FLOAT,
    similarity FLOAT,
    relevance_score FLOAT,
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
        m.created_at
    FROM memories m
    WHERE
        (p_domain_id IS NULL OR m.domain_id = p_domain_id)
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
-- ARCHIVE MAINTENANCE (run via cron job)
-- ============================================================

-- Function to auto-archive decayed memories
-- Should be called monthly via cron
CREATE OR REPLACE FUNCTION archive_decayed_memories() RETURNS INTEGER AS $$
DECLARE
    archived_count INTEGER;
BEGIN
    WITH archived AS (
        UPDATE memories
        SET
            is_archived = TRUE,
            archived_at = NOW(),
            archive_reason = 'decay'
        WHERE
            is_archived = FALSE
            AND last_validated < NOW() - INTERVAL '3 years'
            AND calculate_current_confidence(original_confidence, last_validated) < 0.3
        RETURNING id
    )
    SELECT COUNT(*) INTO archived_count FROM archived;

    RETURN archived_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- ROW LEVEL SECURITY (for multi-tenant future)
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE memory_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_history ENABLE ROW LEVEL SECURITY;

-- For now, allow service role full access
-- These policies will be refined when cross-project auth is added

CREATE POLICY "Service role has full access to memory_users"
    ON memory_users FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role has full access to memory_domains"
    ON memory_domains FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role has full access to memories"
    ON memories FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role has full access to memory_history"
    ON memory_history FOR ALL
    USING (true)
    WITH CHECK (true);

-- ============================================================
-- EXPORT VIEW (provider-agnostic format for portability)
-- ============================================================

CREATE OR REPLACE VIEW memories_export AS
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
    m.last_validated,
    m.related_to,
    m.is_contradiction,
    m.is_archived,
    m.archive_reason,
    m.embedding_model,
    m.embedding_model_version,
    m.created_at,
    m.updated_at,
    d.name AS domain_name,
    u.email AS user_email
FROM memories m
LEFT JOIN memory_domains d ON m.domain_id = d.id
LEFT JOIN memory_users u ON d.user_id = u.id;

-- ============================================================
-- SEED DEFAULT USER AND DOMAIN
-- ============================================================
-- Seed data is project-specific. The traqr-init wizard runs
-- parameterized seed SQL after schema migration using the
-- project name from config. See .claude/commands/traqr-init.md
-- for the seed template.

-- ============================================================
-- VERIFY SCHEMA
-- ============================================================

-- Run these queries to verify setup:
-- SELECT * FROM memory_users;
-- SELECT * FROM memory_domains;
-- SELECT COUNT(*) FROM memories;
