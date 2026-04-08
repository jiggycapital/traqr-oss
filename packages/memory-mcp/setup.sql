-- ============================================================================
-- TraqrDB Fresh-Install Setup
-- ============================================================================
-- Compiled from migrations 001-011 into a single idempotent fresh-install.
-- No ALTER TABLE, no DROP, no backfill. Tables have ALL v2 columns from start.
--
-- Dependency order:
--   1. Extensions
--   2. Immutable wrapper functions (needed by GENERATED columns)
--   3. Tables: memory_users, memory_domains, traqr_memories, traqr_memory_history,
--              memory_relationships, memory_entities, memory_entity_links, schema_version
--   4. Indexes
--   5. Conditional RLS (auth.role() only exists on Supabase)
--   6. RPC functions (v2 versions only)
--   7. Schema version tracking + migration bootstrap
--
-- Safe to re-run: all operations use IF NOT EXISTS / CREATE OR REPLACE.
-- ============================================================================


-- ============================================================================
-- 1. EXTENSIONS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- ============================================================================
-- 2. IMMUTABLE WRAPPER FUNCTIONS
-- ============================================================================
-- to_tsvector() is STABLE, but GENERATED ALWAYS AS requires IMMUTABLE.
-- Safe because english/simple dictionaries are built-in and never change.

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


-- ============================================================================
-- 3. TABLES
-- ============================================================================

-- 3a. memory_users — user identity for multi-tenant support
CREATE TABLE IF NOT EXISTS memory_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key VARCHAR(64) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3b. memory_domains — legacy project/domain isolation
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

-- 3c. traqr_memories — core memories table (v1 + v2 columns merged)
CREATE TABLE IF NOT EXISTS traqr_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identity / scoping
    user_id UUID,
    project_id UUID,
    domain_id UUID REFERENCES memory_domains(id) ON DELETE CASCADE,

    -- Content
    content TEXT NOT NULL,
    summary VARCHAR(500),

    -- Categorization
    category VARCHAR(50),
    tags VARCHAR(100)[] DEFAULT '{}',
    context_tags VARCHAR(100)[] DEFAULT '{}',
    domain VARCHAR(100),
    topic VARCHAR(100),

    -- Embedding
    embedding vector(1536),
    embedding_model VARCHAR(100) DEFAULT 'openai/text-embedding-3-small',
    embedding_model_version VARCHAR(20) DEFAULT 'v1',
    needs_reembedding BOOLEAN DEFAULT FALSE,

    -- Provenance
    source_type VARCHAR(50),
    source_ref VARCHAR(255),
    source_project VARCHAR(100) DEFAULT 'default',
    source_tool VARCHAR(50),

    -- Confidence & Decay
    original_confidence FLOAT DEFAULT 1.0,
    last_validated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Version relationships
    related_to UUID[] DEFAULT '{}',
    is_contradiction BOOLEAN DEFAULT FALSE,

    -- Archive
    is_archived BOOLEAN DEFAULT FALSE,
    archived_at TIMESTAMP WITH TIME ZONE,
    archive_reason VARCHAR(50),

    -- Durability / TTL
    durability VARCHAR(20) DEFAULT 'permanent',
    expires_at TIMESTAMP WITH TIME ZONE,

    -- Cross-project / portability
    is_universal BOOLEAN DEFAULT FALSE,
    is_portable BOOLEAN DEFAULT TRUE,
    agent_type VARCHAR(50),

    -- Citation tracking
    times_returned INTEGER DEFAULT 0,
    times_cited INTEGER DEFAULT 0,
    last_returned_at TIMESTAMP WITH TIME ZONE,
    last_cited_at TIMESTAMP WITH TIME ZONE,

    -- v2: Memory lifecycle (M5 Pipeline Design)
    memory_type VARCHAR(20) DEFAULT 'pattern',
    is_latest BOOLEAN DEFAULT TRUE,
    is_forgotten BOOLEAN DEFAULT FALSE,
    forgotten_at TIMESTAMP WITH TIME ZONE,
    forget_after TIMESTAMP WITH TIME ZONE,

    -- v2: Temporal model (M7)
    valid_at TIMESTAMP WITH TIME ZONE,
    invalid_at TIMESTAMP WITH TIME ZONE,

    -- v2: Dual tsvector for BM25 (GENERATED ALWAYS, auto-computed)
    search_vector_en tsvector
      GENERATED ALWAYS AS (traqr_tsvector_en(content, summary::text, tags::text[])) STORED,
    search_vector_simple tsvector
      GENERATED ALWAYS AS (traqr_tsvector_simple(content, summary::text, tags::text[])) STORED,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Constraints
    CONSTRAINT chk_memory_type CHECK (memory_type IN ('fact', 'preference', 'pattern'))
);

-- 3d. traqr_memory_history — evolution tracking
CREATE TABLE IF NOT EXISTS traqr_memory_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id UUID REFERENCES traqr_memories(id) ON DELETE CASCADE,
    previous_content TEXT,
    previous_embedding vector(1536),
    previous_confidence FLOAT,
    change_reason TEXT,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3e. memory_relationships — memory-to-memory edges for version chains
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

-- 3f. memory_entities — entities extracted from memories (user-scoped)
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

-- 3g. memory_entity_links — junction table (many-to-many memories <-> entities)
CREATE TABLE IF NOT EXISTS memory_entity_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id UUID NOT NULL REFERENCES traqr_memories(id) ON DELETE CASCADE,
    entity_id UUID NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
    role VARCHAR(20) DEFAULT 'mention',
    extracted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(memory_id, entity_id, role)
);

-- 3h. schema_version — tracks installed schema version
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    description TEXT,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


-- ============================================================================
-- 4. INDEXES
-- ============================================================================

-- memory_users
CREATE INDEX IF NOT EXISTS memory_users_api_key_idx
  ON memory_users(api_key);

-- memory_domains
CREATE INDEX IF NOT EXISTS memory_domains_user_idx
  ON memory_domains(user_id);

-- traqr_memories: partial HNSW (only active, non-forgotten memories)
CREATE INDEX IF NOT EXISTS idx_traqr_memories_active_embedding
  ON traqr_memories USING hnsw (embedding vector_cosine_ops)
  WHERE is_archived = FALSE AND is_forgotten = FALSE;

-- traqr_memories: legacy indexes (renamed from memories_* prefix)
CREATE INDEX IF NOT EXISTS idx_traqr_memories_domain_id
  ON traqr_memories(domain_id);
CREATE INDEX IF NOT EXISTS idx_traqr_memories_tags
  ON traqr_memories USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_traqr_memories_category
  ON traqr_memories(category);
CREATE INDEX IF NOT EXISTS idx_traqr_memories_source_project
  ON traqr_memories(source_project);
CREATE INDEX IF NOT EXISTS idx_traqr_memories_archived
  ON traqr_memories(is_archived);
CREATE INDEX IF NOT EXISTS idx_traqr_memories_created
  ON traqr_memories(created_at DESC);

-- traqr_memories: cross-project / portability
CREATE INDEX IF NOT EXISTS idx_traqr_memories_universal
  ON traqr_memories(is_universal)
  WHERE is_universal = TRUE;
CREATE INDEX IF NOT EXISTS idx_traqr_memories_universal_category
  ON traqr_memories(is_universal, category)
  WHERE is_universal = TRUE;
CREATE INDEX IF NOT EXISTS idx_traqr_memories_agent_type
  ON traqr_memories(agent_type)
  WHERE agent_type IS NOT NULL;

-- traqr_memories: durability / TTL
CREATE INDEX IF NOT EXISTS idx_traqr_memories_expires_at
  ON traqr_memories(expires_at)
  WHERE expires_at IS NOT NULL AND durability != 'permanent';

-- traqr_memories: citation tracking
CREATE INDEX IF NOT EXISTS idx_traqr_memories_citation
  ON traqr_memories(times_returned, times_cited)
  WHERE is_archived = FALSE;
CREATE INDEX IF NOT EXISTS idx_traqr_memories_cited
  ON traqr_memories(times_cited DESC)
  WHERE times_cited > 0 AND is_archived = FALSE;

-- traqr_memories: v2 lifecycle indexes
CREATE INDEX IF NOT EXISTS idx_traqr_memories_memory_type
  ON traqr_memories(memory_type) WHERE is_archived = FALSE;
CREATE INDEX IF NOT EXISTS idx_traqr_memories_is_latest
  ON traqr_memories(is_latest) WHERE is_latest = TRUE AND is_archived = FALSE;
CREATE INDEX IF NOT EXISTS idx_traqr_memories_forgotten
  ON traqr_memories(is_forgotten) WHERE is_forgotten = TRUE;
CREATE INDEX IF NOT EXISTS idx_traqr_memories_forget_after
  ON traqr_memories(forget_after)
  WHERE forget_after IS NOT NULL AND is_forgotten = FALSE;
CREATE INDEX IF NOT EXISTS idx_traqr_memories_source_tool
  ON traqr_memories(source_tool) WHERE source_tool IS NOT NULL;

-- traqr_memories: v2 temporal indexes
CREATE INDEX IF NOT EXISTS idx_traqr_memories_valid_at
  ON traqr_memories(valid_at) WHERE valid_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_traqr_memories_temporal
  ON traqr_memories(valid_at, invalid_at)
  WHERE is_archived = FALSE AND is_forgotten = FALSE;

-- traqr_memories: v2 BM25 tsvector indexes (GIN for full-text search)
CREATE INDEX IF NOT EXISTS idx_traqr_memories_search_en
  ON traqr_memories USING gin(search_vector_en);
CREATE INDEX IF NOT EXISTS idx_traqr_memories_search_simple
  ON traqr_memories USING gin(search_vector_simple);

-- traqr_memory_history
CREATE INDEX IF NOT EXISTS idx_traqr_memory_history_memory
  ON traqr_memory_history(memory_id);
CREATE INDEX IF NOT EXISTS idx_traqr_memory_history_changed
  ON traqr_memory_history(changed_at DESC);

-- memory_relationships
CREATE INDEX IF NOT EXISTS idx_rel_source
  ON memory_relationships(source_memory_id);
CREATE INDEX IF NOT EXISTS idx_rel_target
  ON memory_relationships(target_memory_id);
CREATE INDEX IF NOT EXISTS idx_rel_edge
  ON memory_relationships(edge_type);

-- memory_entities
CREATE INDEX IF NOT EXISTS idx_entities_user
  ON memory_entities(user_id);
CREATE INDEX IF NOT EXISTS idx_entities_type
  ON memory_entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_name
  ON memory_entities(name);
CREATE INDEX IF NOT EXISTS idx_entities_mentions
  ON memory_entities(mentions_count DESC);
CREATE INDEX IF NOT EXISTS idx_entities_embedding
  ON memory_entities USING hnsw (embedding vector_cosine_ops);

-- memory_entity_links
CREATE INDEX IF NOT EXISTS idx_entity_links_memory
  ON memory_entity_links(memory_id);
CREATE INDEX IF NOT EXISTS idx_entity_links_entity
  ON memory_entity_links(entity_id);


-- ============================================================================
-- 5. CONDITIONAL ROW-LEVEL SECURITY
-- ============================================================================
-- auth.role() only exists on Supabase. Wrap ALL RLS in a DO block that
-- checks for the function's existence first.

DO $$
DECLARE
  has_auth_role BOOLEAN;
BEGIN
  -- Check if auth.role() exists (Supabase-specific)
  SELECT EXISTS(
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'auth' AND p.proname = 'role'
  ) INTO has_auth_role;

  -- Enable RLS on all tables (safe everywhere)
  ALTER TABLE memory_users ENABLE ROW LEVEL SECURITY;
  ALTER TABLE memory_domains ENABLE ROW LEVEL SECURITY;
  ALTER TABLE traqr_memories ENABLE ROW LEVEL SECURITY;
  ALTER TABLE traqr_memory_history ENABLE ROW LEVEL SECURITY;
  ALTER TABLE memory_relationships ENABLE ROW LEVEL SECURITY;
  ALTER TABLE memory_entities ENABLE ROW LEVEL SECURITY;
  ALTER TABLE memory_entity_links ENABLE ROW LEVEL SECURITY;
  ALTER TABLE schema_version ENABLE ROW LEVEL SECURITY;

  IF has_auth_role THEN
    -- Supabase: restrict to service_role
    BEGIN
      CREATE POLICY "Service role full access on memory_users"
        ON memory_users FOR ALL
        USING (auth.role() = 'service_role')
        WITH CHECK (auth.role() = 'service_role');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
      CREATE POLICY "Service role full access on memory_domains"
        ON memory_domains FOR ALL
        USING (auth.role() = 'service_role')
        WITH CHECK (auth.role() = 'service_role');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
      CREATE POLICY "Service role full access on traqr_memories"
        ON traqr_memories FOR ALL
        USING (auth.role() = 'service_role')
        WITH CHECK (auth.role() = 'service_role');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
      CREATE POLICY "Service role full access on traqr_memory_history"
        ON traqr_memory_history FOR ALL
        USING (auth.role() = 'service_role')
        WITH CHECK (auth.role() = 'service_role');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
      CREATE POLICY "Service role full access on relationships"
        ON memory_relationships FOR ALL
        USING (auth.role() = 'service_role')
        WITH CHECK (auth.role() = 'service_role');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
      CREATE POLICY "Service role full access on entities"
        ON memory_entities FOR ALL
        USING (auth.role() = 'service_role')
        WITH CHECK (auth.role() = 'service_role');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
      CREATE POLICY "Service role full access on entity_links"
        ON memory_entity_links FOR ALL
        USING (auth.role() = 'service_role')
        WITH CHECK (auth.role() = 'service_role');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
      CREATE POLICY "Service role full access on schema_version"
        ON schema_version FOR ALL
        USING (auth.role() = 'service_role')
        WITH CHECK (auth.role() = 'service_role');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  ELSE
    -- Non-Supabase (RDS, local): open access policies
    BEGIN
      CREATE POLICY "Full access on memory_users"
        ON memory_users FOR ALL USING (true) WITH CHECK (true);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
      CREATE POLICY "Full access on memory_domains"
        ON memory_domains FOR ALL USING (true) WITH CHECK (true);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
      CREATE POLICY "Full access on traqr_memories"
        ON traqr_memories FOR ALL USING (true) WITH CHECK (true);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
      CREATE POLICY "Full access on traqr_memory_history"
        ON traqr_memory_history FOR ALL USING (true) WITH CHECK (true);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
      CREATE POLICY "Full access on relationships"
        ON memory_relationships FOR ALL USING (true) WITH CHECK (true);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
      CREATE POLICY "Full access on entities"
        ON memory_entities FOR ALL USING (true) WITH CHECK (true);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
      CREATE POLICY "Full access on entity_links"
        ON memory_entity_links FOR ALL USING (true) WITH CHECK (true);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
      CREATE POLICY "Full access on schema_version"
        ON schema_version FOR ALL USING (true) WITH CHECK (true);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;


-- ============================================================================
-- 6. RPC FUNCTIONS (v2 versions only)
-- ============================================================================

-- 6a. calculate_current_confidence — v2: 5-arg, STABLE (uses NOW())
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
  ELSE  -- 'pattern' (default)
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

-- 6b. search_memories — v2: with p_latest_only + v2 columns
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
    AND (p_project_id IS NULL OR m.project_id = p_project_id)
    AND (p_category IS NULL OR m.category = p_category)
    AND (p_tags IS NULL OR m.tags && p_tags)
    AND 1 - (m.embedding <=> p_query_embedding) >= p_similarity_threshold
  ORDER BY relevance_score DESC
  LIMIT p_limit;
END;
$$;

-- 6c. search_memories_cross_project — v2: with p_latest_only + v2 columns
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

-- 6d. archive_decayed_memories — v2: uses 5-arg confidence
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

-- 6e. bm25_search — keyword search over dual tsvectors
-- NOTE: ts_rank_cd returns REAL; cast to ::FLOAT. VARCHAR columns need ::TEXT.
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
  or_query TEXT;
BEGIN
  -- Split query words into OR terms for better recall.
  -- "engagement ring proposal" -> "engagement | ring | proposal"
  -- ts_rank_cd naturally ranks docs with MORE matching terms higher.
  or_query := regexp_replace(trim(p_query_text), '\s+', ' | ', 'g');
  tsquery_en := to_tsquery('english', or_query);
  tsquery_simple := to_tsquery('simple', or_query);

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

-- 6f. temporal_search — valid_at range + embedding similarity
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

-- 6g. graph_search — link expansion CTE traversing memory_relationships
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

-- 6h. search_entities — embedding-based entity lookup
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

-- 6i. count_entity_mentions — 3+ threshold check
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

-- 6j. forget_expired_memories — daily cron function
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

-- 6k. increment_memory_returns — batch fire-and-forget from context assembly
CREATE OR REPLACE FUNCTION increment_memory_returns(p_memory_ids UUID[])
RETURNS void AS $$
BEGIN
  UPDATE traqr_memories
  SET
    times_returned = COALESCE(times_returned, 0) + 1,
    last_returned_at = NOW()
  WHERE id = ANY(p_memory_ids)
    AND is_archived = FALSE;
END;
$$ LANGUAGE plpgsql;

-- 6l. cite_memory — record a citation (resets decay timer)
CREATE OR REPLACE FUNCTION cite_memory(p_memory_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE traqr_memories
  SET
    times_cited = COALESCE(times_cited, 0) + 1,
    last_cited_at = NOW(),
    last_validated = NOW()
  WHERE id = p_memory_id
    AND is_archived = FALSE;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 7. SCHEMA VERSION TRACKING + MIGRATION BOOTSTRAP
-- ============================================================================

INSERT INTO schema_version (version, description)
VALUES (1, 'Memory Engine v1 -- base schema (migrations 001-010)')
ON CONFLICT (version) DO NOTHING;

INSERT INTO schema_version (version, description)
VALUES (2, 'Memory Engine v2 -- pipeline, retrieval, temporal, entities (M5-M9)')
ON CONFLICT (version) DO NOTHING;

-- Migration tracking table (so migrate.ts runner works for future migrations)
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
-- DONE. Verify with:
-- ============================================================================
--
-- SELECT tablename FROM pg_tables WHERE schemaname = 'public'
--   AND tablename IN ('memory_users','memory_domains','traqr_memories',
--     'traqr_memory_history','memory_relationships','memory_entities',
--     'memory_entity_links','schema_version','_traqr_migrations');
--
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'traqr_memories' ORDER BY ordinal_position;
--
-- SELECT indexname FROM pg_indexes WHERE tablename = 'traqr_memories';
--
-- SELECT * FROM bm25_search('test query', NULL, NULL, NULL, 5, 0.01);
