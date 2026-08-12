-- Accelerated Decay & Stale Archival
-- Migration 028: Faster decay for uncited/noise memories, auto-archive stale uncited
--
-- Changes:
--   - Uncited default decay: 30%/year -> 50%/year
--   - Noise decay (returned but never cited): 40%/year -> 70%/year
--   - Cited 1-3x: unchanged at 10%/year
--   - Cited >3x: unchanged at 5%/year
--   - New function: archive_stale_uncited_memories() for 90-day uncited cleanup

-- ============================================================
-- UPDATED DECAY FUNCTION: Accelerated rates
-- ============================================================

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

    -- Citation-aware decay rate (accelerated for uncited)
    IF p_times_cited > 3 THEN
        decay_rate := 0.05;  -- Proven valuable: slow decay
    ELSIF p_times_cited >= 1 THEN
        decay_rate := 0.10;  -- Some citations: moderate decay
    ELSIF p_times_returned > 5 THEN
        decay_rate := 0.70;  -- Returned often but never cited: aggressive noise decay
    ELSE
        decay_rate := 0.50;  -- Default uncited: aggressive decay (~3 months to archive)
    END IF;

    decayed_confidence := p_original_confidence * POWER(1 - decay_rate, years_since_validation);
    RETURN GREATEST(decayed_confidence, 0.1);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- NEW: Archive stale uncited memories (>90 days, <=2 returns)
-- ============================================================

CREATE OR REPLACE FUNCTION archive_stale_uncited_memories()
RETURNS TABLE (
    archived_id UUID,
    content_preview TEXT,
    age_days INTEGER,
    times_returned INTEGER,
    reason TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH to_archive AS (
        SELECT
            m.id,
            LEFT(m.content, 100) AS content_preview,
            EXTRACT(DAY FROM NOW() - m.created_at)::INTEGER AS age_days,
            COALESCE(m.times_returned, 0) AS tr,
            'stale: uncited >90 days with <=2 returns'::TEXT AS archive_reason
        FROM memories m
        WHERE m.is_archived = FALSE
          AND COALESCE(m.times_cited, 0) = 0
          AND COALESCE(m.times_returned, 0) <= 2
          AND m.created_at < NOW() - INTERVAL '90 days'
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
        RETURNING m.id, ta.content_preview, ta.age_days, ta.tr, ta.archive_reason
    )
    SELECT
        a.id AS archived_id,
        a.content_preview,
        a.age_days,
        a.tr AS times_returned,
        a.archive_reason AS reason
    FROM archived a;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- VERIFY MIGRATION
-- ============================================================

-- Test new decay rates:
-- SELECT calculate_current_confidence(0.9, NOW() - INTERVAL '6 months', 0, 0);   -- uncited: should be ~0.64 (was ~0.73)
-- SELECT calculate_current_confidence(0.9, NOW() - INTERVAL '6 months', 0, 10);  -- noise: should be ~0.49 (was ~0.57)
-- SELECT calculate_current_confidence(0.9, NOW() - INTERVAL '1 year', 3, 10);    -- cited: should be ~0.81 (unchanged)
-- Test stale archival:
-- BEGIN; SELECT * FROM archive_stale_uncited_memories(); ROLLBACK;
