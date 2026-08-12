-- Optimize find_duplicate_memory_pairs — kNN via HNSW instead of O(n^2) self-join
-- Migration 015
--
-- Problem (NTQ-1007): the memory-dedup cron called find_duplicate_memory_pairs,
-- which did a full self-join (traqr_memories a JOIN b ON a.id < b.id) computing a
-- cosine distance for EVERY pair. At ~6.4k active embeddings that is ~20M pairwise
-- vector ops, which blew past the role statement_timeout (Postgres 57014
-- "canceling statement due to statement timeout"). The HNSW index
-- idx_traqr_memories_active_embedding (vector_cosine_ops, WHERE is_archived=false
-- AND is_forgotten=false) could not be used by an all-pairs join.
--
-- Fix: rewrite as a per-row k-nearest-neighbour LATERAL. For each active memory we
-- ask the HNSW index for its k closest neighbours, then keep pairs >= threshold.
-- The index turns each probe into ~1-3ms, so the whole scan runs in ~15s instead of
-- timing out. A function-scoped statement_timeout makes the run self-contained
-- regardless of the calling role's default (which is what produced 57014).
-- (hnsw.ef_search is left at the session default — it is a restricted parameter that
-- cannot be set at function scope in this database.)
--
-- Recall note: a pair (x,y) with x<y is emitted only when y is within x's top-k
-- neighbours (k=8). For the tight dedup threshold (>=0.75 cosine sim) that is
-- effectively always true; in a hypothetical cluster of >8 near-identical memories a
-- pair could be deferred to the next weekly run as the cluster collapses. This is an
-- intentional trade of perfect-recall-but-never-completes for fast-and-iterative.
-- Signature/return columns are unchanged, so the cron (memory-dedup/route.ts) and its
-- DupPair type need no changes.

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
        -- kNN: HNSW index returns a's nearest neighbours directly
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
      AND a.id < b.id  -- canonical ordering: emit each pair once
      AND 1 - (a.embedding <=> b.embedding) >= p_similarity_threshold
      -- Exclude pairs where one supersedes the other (correction chain)
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
