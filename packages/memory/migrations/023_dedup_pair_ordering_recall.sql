-- 023_dedup_pair_ordering_recall.sql
-- find_duplicate_memory_pairs: canonicalize the PAIR after the probe instead of
-- filtering by direction during it. Restores ~13% of duplicate pairs the current
-- definition drops permanently, and is a precondition for ANY incremental variant.
--
-- WHY (TD-1211, measured live on traqr-db 2026-08-11)
-- ---------------------------------------------------------------------------
-- Migration 015 rewrote this function as a per-row kNN LATERAL and deduped the
-- resulting pairs with `AND a.id < b.id  -- canonical ordering: emit each pair once`.
--
-- That filter is sound only if BOTH of these hold:
--   (i)  every member of a pair gets its turn as the outer row `a`, and
--   (ii) adjacency is symmetric — y in top8(x) implies x in top8(y).
--
-- Neither holds. Because `b` comes from a top-8 kNN probe, the pair {x,y} is
-- emitted only when:
--       (y IN top8(x) AND x.id < y.id)  OR  (x IN top8(y) AND y.id < x.id)
-- so a one-directional adjacency whose UUID ordering points the wrong way is
-- emitted by NEITHER side. traqr_memories.id is UUID **v4** (verified: all 13,257
-- rows carry version nibble '4'), i.e. random and uncorrelated with recency or
-- with anything else — so the direction check is an unbiased coin flip applied to
-- a fact that has nothing to do with ids.
--
-- Measured, 150 most-recent active rows as the outer set, threshold 0.75:
--     337  adjacencies found at >= 0.75
--     188  dropped by `a.id < b.id`
--     145  of those recovered from the other side (adjacency was symmetric)
--      43  lost even in a FULL scan  -- 12.8% of all true adjacencies
--
-- Migration 015's header calls this loss a deferral: "in a hypothetical cluster of
-- >8 near-identical memories a pair could be deferred to the next weekly run."
-- It is not a deferral and the >8 cluster is not the mechanism. UUIDs do not change
-- and the kNN direction does not change, so the same 43 pairs are dropped identically
-- on every future run, forever. Deferred implies self-healing; this is permanent.
--
-- THE INCREMENTAL COROLLARY (why this must land before TD-1211's redesign)
-- ---------------------------------------------------------------------------
-- Every option on TD-1211 that bounds the OUTER set to recently created/updated
-- rows inherits a strictly worse version of this. With the outer set restricted,
-- condition (i) is violated by construction for old rows: a pair (new M, old X)
-- with M.id > X.id needs X as an outer row, and X is not in the window.
-- Measured on a 300-row 7-day window: 548 adjacencies, 259 kept, 289 dropped,
-- **141 of them with a partner older than the window** — permanently invisible,
-- and precisely the new-duplicates-an-old class incremental dedup exists to catch.
-- Post-fix the same window yields 468 unique pairs against 259 (+80.7%).
--
-- THE FIX
-- ---------------------------------------------------------------------------
-- Keep the probe identical (it is the entire cost and it is correct). Drop the
-- direction filter, canonicalize each unordered pair with LEAST/GREATEST, and
-- collapse duplicates with GROUP BY — so a pair survives if EITHER member sees
-- the other, which is what "emit each pair once" was always meant to mean.
-- Cosine distance is symmetric, so max(sim) is a picker, not a choice.
--
-- SCOPE — deliberately narrow:
--   * This does NOT address the ~448 s runtime that TD-1211 is actually about, and
--     does not pretend to. The probe count is unchanged; this only stops discarding
--     probes already paid for. The function still self-cancels at its own
--     `SET statement_timeout TO '120s'` (note for TD-1211: that 120 s is BELOW the
--     ~448 s projection, so option 4 "raise maxDuration to 300" cannot work either
--     — the DB kills the query before Vercel's ceiling is reached).
--   * Signature and return columns are unchanged, so memory-dedup/route.ts and its
--     DupPair type need no changes. memory_id_a is now the lower UUID rather than
--     whichever row happened to be the outer one; the caller's keep/archive
--     tie-breaks read both sides symmetrically, and lo/hi is the more deterministic
--     of the two (it no longer depends on scan order).
--   * Archive VOLUME is unchanged: the caller still takes p_limit=100 pairs ordered
--     by similarity and archives the lower-cited member of each. Recall rises;
--     the archive policy and its cap do not move.
--
-- NOT APPLIED BY DEPLOY. packages/memory/src/migrate.ts runs only when invoked
-- explicitly, so merging this file changes nothing in prod on its own. Landing it
-- live is a separate, deliberate act — do not read a merged PR as a live fix.

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
    WITH adjacency AS (
        -- Identical probe to migration 015: HNSW returns a's nearest neighbours
        -- directly via idx_traqr_memories_active_embedding. Unchanged on purpose.
        SELECT
            LEAST(a.id, b.id)    AS lo_id,
            GREATEST(a.id, b.id) AS hi_id,
            1 - (a.embedding <=> b.embedding) AS sim
        FROM traqr_memories a
        CROSS JOIN LATERAL (
            SELECT n.id, n.embedding
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
          AND 1 - (a.embedding <=> b.embedding) >= p_similarity_threshold
    ),
    pairs AS (
        -- One row per unordered pair, however many directions found it.
        SELECT lo_id, hi_id, max(sim) AS sim
        FROM adjacency
        GROUP BY lo_id, hi_id
    )
    SELECT
        p.lo_id AS memory_id_a,
        p.hi_id AS memory_id_b,
        ma.content AS content_a,
        mb.content AS content_b,
        p.sim AS similarity,
        COALESCE(ma.times_cited, 0) AS times_cited_a,
        COALESCE(mb.times_cited, 0) AS times_cited_b,
        ma.created_at AS created_at_a,
        mb.created_at AS created_at_b
    FROM pairs p
    JOIN traqr_memories ma ON ma.id = p.lo_id
    JOIN traqr_memories mb ON mb.id = p.hi_id
    -- Exclude pairs where one supersedes the other (correction chain).
    -- Direction-independent, same as before; it filters the pair, not the probe.
    WHERE NOT EXISTS (
        SELECT 1 FROM memory_relationships mr
        WHERE mr.edge_type = 'updates'
          AND (
            (mr.source_memory_id = p.lo_id AND mr.target_memory_id = p.hi_id) OR
            (mr.source_memory_id = p.hi_id AND mr.target_memory_id = p.lo_id)
          )
    )
    ORDER BY p.sim DESC
    LIMIT p_limit;
END;
$function$;
