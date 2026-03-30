-- Memory Curation Functions
-- Migration 027: SQL functions for decay, dedup, and staleness crons
--
-- These are called by cron jobs in src/app/api/cron/memory-*

-- ============================================================
-- CITATION-AWARE DECAY: Archive memories below threshold
-- ============================================================

CREATE OR REPLACE FUNCTION archive_decayed_memories()
RETURNS TABLE (
    archived_id UUID,
    content_preview TEXT,
    final_confidence FLOAT,
    times_cited INTEGER,
    times_returned INTEGER,
    reason TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH to_archive AS (
        SELECT
            m.id,
            LEFT(m.content, 100) AS content_preview,
            calculate_current_confidence(
                m.original_confidence,
                m.last_validated,
                COALESCE(m.times_cited, 0),
                COALESCE(m.times_returned, 0)
            ) AS final_confidence,
            COALESCE(m.times_cited, 0) AS tc,
            COALESCE(m.times_returned, 0) AS tr,
            CASE
                WHEN COALESCE(m.times_returned, 0) > 5 AND COALESCE(m.times_cited, 0) = 0
                    THEN 'noise: returned but never cited'
                WHEN COALESCE(m.times_cited, 0) = 0
                    THEN 'uncited: decayed below threshold'
                ELSE 'low-confidence: decayed below threshold'
            END AS archive_reason
        FROM memories m
        WHERE m.is_archived = FALSE
          AND calculate_current_confidence(
                m.original_confidence,
                m.last_validated,
                COALESCE(m.times_cited, 0),
                COALESCE(m.times_returned, 0)
              ) < 0.3
    ),
    archived AS (
        UPDATE memories m
        SET
            is_archived = TRUE,
            archived_at = NOW(),
            archive_reason = ta.archive_reason,
            updated_at = NOW()
        FROM to_archive ta
        WHERE m.id = ta.id
        RETURNING m.id, ta.content_preview, ta.final_confidence, ta.tc, ta.tr, ta.archive_reason
    )
    SELECT
        a.id AS archived_id,
        a.content_preview,
        a.final_confidence,
        a.tc AS times_cited,
        a.tr AS times_returned,
        a.archive_reason AS reason
    FROM archived a;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SEMANTIC DEDUP: Find clusters at >0.75 similarity
-- Returns pairs for the cron job to process
-- ============================================================

CREATE OR REPLACE FUNCTION find_duplicate_memory_pairs(
    p_similarity_threshold FLOAT DEFAULT 0.75,
    p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
    memory_id_a UUID,
    memory_id_b UUID,
    content_a TEXT,
    content_b TEXT,
    similarity FLOAT,
    times_cited_a INTEGER,
    times_cited_b INTEGER,
    created_at_a TIMESTAMP WITH TIME ZONE,
    created_at_b TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        a.id AS memory_id_a,
        b.id AS memory_id_b,
        a.content AS content_a,
        b.content AS content_b,
        1 - (a.embedding <=> b.embedding) AS sim,
        COALESCE(a.times_cited, 0) AS times_cited_a,
        COALESCE(b.times_cited, 0) AS times_cited_b,
        a.created_at AS created_at_a,
        b.created_at AS created_at_b
    FROM memories a
    JOIN memories b ON a.id < b.id  -- avoid self-join and duplicates
    WHERE a.is_archived = FALSE
      AND b.is_archived = FALSE
      AND a.embedding IS NOT NULL
      AND b.embedding IS NOT NULL
      AND 1 - (a.embedding <=> b.embedding) >= p_similarity_threshold
    ORDER BY sim DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- VERIFY MIGRATION
-- ============================================================

-- Test decay function:
-- SELECT * FROM archive_decayed_memories();  -- DRY RUN: wrap in transaction + rollback
-- Test dedup:
-- SELECT * FROM find_duplicate_memory_pairs(0.75, 10);
