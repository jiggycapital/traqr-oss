-- 023_rollback.sql
-- Manual-recovery tool for 023_dedup_pair_ordering_recall.sql. NEVER runs as a
-- forward migration — selectForwardMigrations() excludes *_rollback.sql by name
-- (see packages/memory/src/lib/migration-files.test.ts, which asserts exactly this).
--
-- Restores the migration 015 definition verbatim: the `a.id < b.id` direction
-- filter instead of LEAST/GREATEST pair canonicalization. Reverting re-introduces
-- the ~13% permanent recall loss documented in 023's header — take it only if the
-- recall increase is itself the problem (e.g. it surfaced pairs whose archiving
-- turned out to be wrong), not to address the ~448 s runtime, which 023 does not
-- touch in either direction.

CREATE OR REPLACE FUNCTION public.find_duplicate_memory_pairs(
    p_similarity_threshold double precision DEFAULT 0.75,
    p_limit integer DEFAULT 100
)
RETURNS TABLE (
    memory_id_a uuid,
    memory_id_b uuid,
    content_a text,
    content_b text,
    similarity double precision,
    times_cited_a integer,
    times_cited_b integer,
    created_at_a timestamp with time zone,
    created_at_b timestamp with time zone
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $function$
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
    FROM traqr_memories a
    CROSS JOIN LATERAL (
        SELECT n.id, n.content, n.embedding, n.times_cited, n.created_at
        FROM traqr_memories n
        WHERE n.is_archived = FALSE
          AND n.is_forgotten = FALSE
          AND n.embedding IS NOT NULL
          AND n.id <> a.id
        ORDER BY a.embedding <=> n.embedding
        LIMIT 8
    ) b
    WHERE a.is_archived = FALSE
      AND a.is_forgotten = FALSE
      AND a.embedding IS NOT NULL
      AND a.id < b.id
      AND 1 - (a.embedding <=> b.embedding) >= p_similarity_threshold
      AND NOT EXISTS (
        SELECT 1 FROM memory_relationships mr
        WHERE mr.edge_type = 'updates'
          AND (
            (mr.source_memory_id = a.id AND mr.target_memory_id = b.id) OR
            (mr.source_memory_id = b.id AND mr.target_memory_id = a.id)
          )
      )
    ORDER BY sim DESC
    LIMIT p_limit;
END;
$function$;
