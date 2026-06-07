-- Migration 015: Guard auto-archival against explicitly-protected memories
--
-- WHY (Feature3 /bethesda 2026-06-01, code- and data-verified):
-- The two cron-driven archival functions — archive_stale_uncited_memories()
-- (run monthly by NookTraqr's memory-decay cron, 0 3 1 * *) and
-- archive_decayed_memories() — archive on usage heuristics (times_cited,
-- times_returned, confidence decay) with NO check for explicitly-protected
-- memories. With cite_memory() currently dead (times_cited = 0 for the whole
-- corpus), the "uncited" filter matches everything old enough, so the live
-- blast radius of archive_stale_uncited_memories() is 22 memories — 19 of
-- which carry explicit critical/evergreen/important tags. The memory-decay
-- cron has only been failing (TypeError: fetch failed — a separate, Sean-gated
-- TRAQR_SUPABASE_URL env issue: NTQ-1003/1004/1007/1008/1009), so the cull has
-- never fired via cron. The moment that env is fixed, the next run archives
-- those 22. This guard must land BEFORE the env fix.
--
-- WHAT NOT TO GUARD ON — durability. An earlier triage (NTQ-1003 comment +
-- SharedDiary 2026-05-31) proposed excluding durability = 'permanent'. That is
-- WRONG: 'permanent' is the column DEFAULT (migration 004: TTL semantics, not
-- archival protection) and covers 5,408 of 5,419 active memories. Excluding it
-- would disable archival corpus-wide. The real "this is precious, never
-- auto-archive" signal is the explicit tag set, plus the deliberately-chosen
-- (non-default) longevity durabilities 'evergreen' / 'long_term' / 'long-term'.
--
-- EFFECT: strictly protective and reversible. Both functions can now only
-- archive FEWER memories, never more. Post-guard, archive_stale_uncited_memories
-- drops from 22 eligible to 3 (default-durability, untagged, genuinely
-- low-signal — and archival is reversible via is_archived). Bodies are otherwise
-- identical to the live definitions (faithful CREATE OR REPLACE).

-- ============================================================
-- archive_stale_uncited_memories() — add protected-memory guard
-- ============================================================
CREATE OR REPLACE FUNCTION public.archive_stale_uncited_memories()
 RETURNS TABLE(archived_id uuid, content_preview text, age_days integer, times_returned integer, reason text)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
    RETURN QUERY
    WITH to_archive AS (
        SELECT m.id, LEFT(m.content, 100) AS cp,
            EXTRACT(DAY FROM NOW() - m.created_at)::INTEGER AS ad,
            COALESCE(m.times_returned, 0) AS tr,
            'stale: uncited >90 days with <=2 returns'::TEXT AS ar
        FROM traqr_memories m
        WHERE m.is_archived = FALSE
          AND COALESCE(m.times_cited, 0) = 0
          AND COALESCE(m.times_returned, 0) <= 2
          AND m.created_at < NOW() - INTERVAL '90 days'
          -- Protected-memory guard (migration 015): never auto-archive a memory
          -- that carries an explicit longevity tag or a deliberate (non-default)
          -- longevity durability. NOT 'permanent' — that is the default.
          AND NOT (m.durability = ANY(ARRAY['evergreen','long_term','long-term']::varchar[]))
          AND NOT (COALESCE(m.tags, '{}')::text[] && ARRAY['critical','evergreen','important'])
    ),
    archived AS (
        UPDATE traqr_memories m SET is_archived = TRUE, archived_at = NOW(), archive_reason = ta.ar, updated_at = NOW()
        FROM to_archive ta WHERE m.id = ta.id
        RETURNING m.id, ta.cp, ta.ad, ta.tr, ta.ar
    )
    SELECT a.id, a.cp, a.ad, a.tr, a.ar FROM archived a;
END;
$function$;

-- ============================================================
-- archive_decayed_memories() — add the same protected-memory guard
-- (0 live eligible today, but the same unguarded structure is a latent
--  landmine as confidence decays — guard for defense-in-depth.)
-- ============================================================
CREATE OR REPLACE FUNCTION public.archive_decayed_memories()
 RETURNS TABLE(archived_id uuid, content_preview text, final_confidence double precision, times_cited integer, times_returned integer, reason text)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH decayed AS (
    SELECT m.id, LEFT(m.content, 100) AS content_preview,
      calculate_current_confidence(m.original_confidence, m.created_at, m.times_cited, m.times_returned, m.memory_type) AS conf,
      m.times_cited, m.times_returned,
      CASE
        WHEN m.times_returned > 5 AND m.times_cited = 0 THEN 'noise'
        WHEN m.times_cited = 0 THEN 'uncited'
        ELSE 'low-confidence'
      END AS reason
    FROM traqr_memories m
    WHERE m.is_archived = FALSE AND m.is_forgotten = FALSE
      AND calculate_current_confidence(m.original_confidence, m.created_at, m.times_cited, m.times_returned, m.memory_type) < 0.3
      -- Protected-memory guard (migration 015): see archive_stale_uncited_memories above.
      AND NOT (m.durability = ANY(ARRAY['evergreen','long_term','long-term']::varchar[]))
      AND NOT (COALESCE(m.tags, '{}')::text[] && ARRAY['critical','evergreen','important'])
  ),
  archived AS (
    UPDATE traqr_memories SET is_archived = TRUE, archived_at = NOW(), archive_reason = d.reason, updated_at = NOW()
    FROM decayed d WHERE traqr_memories.id = d.id
    RETURNING traqr_memories.id
  )
  SELECT d.id, d.content_preview, d.conf, d.times_cited, d.times_returned, d.reason
  FROM decayed d JOIN archived a ON a.id = d.id;
END;
$function$;

-- ============================================================
-- VERIFY (read-only, run after apply):
--   SELECT * FROM archive_stale_uncited_memories();  -- in a transaction you can ROLLBACK
-- Pre-guard eligibility was 22 (19 protected-tagged); post-guard 3.
-- BEGIN; SELECT count(*) FROM archive_stale_uncited_memories(); ROLLBACK;
-- ============================================================
