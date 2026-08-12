-- Rollback for migration 015 — restore archival functions to their pre-guard
-- (unguarded) bodies. WARNING: after rollback, archive_stale_uncited_memories()
-- again becomes eligible to archive explicitly-tagged critical/evergreen/important
-- memories (22 eligible at the time 015 shipped). Only roll back if the guard is
-- being replaced by a superior protection (e.g. the cite_memory() rewrite).

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
    ),
    archived AS (
        UPDATE traqr_memories m SET is_archived = TRUE, archived_at = NOW(), archive_reason = ta.ar, updated_at = NOW()
        FROM to_archive ta WHERE m.id = ta.id
        RETURNING m.id, ta.cp, ta.ad, ta.tr, ta.ar
    )
    SELECT a.id, a.cp, a.ad, a.tr, a.ar FROM archived a;
END;
$function$;

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
