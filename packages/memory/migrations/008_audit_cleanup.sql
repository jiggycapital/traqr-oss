-- Memory Audit Cleanup (one-time)
-- Migration 029: Archive low-quality memories + backfill source_project
--
-- Run after 007_accelerated_decay.sql. This handles:
-- 1. Archive generic observation memories (Phase 1B)
-- 2. Archive stale architecture references (Phase 1C)
-- 3. Archive aspirational bootstrap memories (Phase 1D)
-- 4. Backfill source_project for misattributed memories (Phase 4C)

-- ============================================================
-- 1B. ARCHIVE GENERIC OBSERVATIONS
-- Target: pr/session sources with generic truism content, never cited
-- ============================================================

UPDATE memories SET
  is_archived = TRUE,
  archived_at = NOW(),
  archive_reason = 'audit: generic-observation',
  updated_at = NOW()
WHERE is_archived = FALSE
  AND times_cited = 0
  AND source_type IN ('pr', 'session')
  AND category IN ('preference', 'convention', 'insight')
  AND (
    content ~* '(demonstrates?|suggests?|indicates?|showcases?|illustrates?|highlights?|reveals?)\s+(a\s+)?(preference|value|focus|priority)\s+(for|on|in)'
    OR content ~* '(modular|scalable|maintainable|readable)\b.*\b(code|design|architecture)'
    OR content ~* '(separation of concerns|single responsibility|DRY principle|best practice)'
    OR content ~* '(enhancing|improving|promoting)\s+(readability|maintainability|scalability|reusability)'
    OR content ~* 'cognitive load'
  );

-- ============================================================
-- 1C. ARCHIVE STALE ARCHITECTURE REFERENCES
-- ============================================================

UPDATE memories SET
  is_archived = TRUE,
  archived_at = NOW(),
  archive_reason = 'audit: stale-architecture',
  updated_at = NOW()
WHERE is_archived = FALSE
  AND times_cited = 0
  AND (
    content ILIKE '%daemon monolith%'
    OR content ILIKE '%claude-agent-daemon%'
    OR content ILIKE '%daemon-orchestration%'
    OR content ILIKE '%guardian v2%'
    OR content ILIKE '%MEGA_PLAN_ARCHITECTURE%'
    OR content ILIKE '%advisor-welcome%'
  );

-- ============================================================
-- 1D. ARCHIVE ASPIRATIONAL BOOTSTRAP MEMORIES
-- ============================================================

UPDATE memories SET
  is_archived = TRUE,
  archived_at = NOW(),
  archive_reason = 'audit: aspirational-bootstrap',
  updated_at = NOW()
WHERE is_archived = FALSE
  AND times_cited = 0
  AND source_type = 'bootstrap'
  AND (
    content ILIKE '%knowledge marketplace%'
    OR content ILIKE '%aws partnership%'
    OR content ILIKE '%monetiz%'
    OR content ILIKE '%personality vector%'
    OR content ILIKE '%Two-Layer Strategy%'
  );

-- ============================================================
-- 4C. BACKFILL source_project
-- Correct memories that mention app-specific content but are
-- tagged as 'default' or wrong project
-- ============================================================

-- PokoTraqr memories
UPDATE memories SET source_project = 'pokotraqr', updated_at = NOW()
WHERE source_project IN ('default', 'nooktraqr')
  AND (content ILIKE '%pokotraqr%' OR content ILIKE '%pokopia%' OR content ILIKE '%poko%')
  AND content NOT ILIKE '%nooktraqr%';

-- PokeTraqr memories
UPDATE memories SET source_project = 'poketraqr', updated_at = NOW()
WHERE source_project IN ('default', 'nooktraqr')
  AND (content ILIKE '%poketraqr%' OR content ILIKE '%pokemon%')
  AND content NOT ILIKE '%nooktraqr%'
  AND content NOT ILIKE '%pokotraqr%';

-- MilesTraqr memories
UPDATE memories SET source_project = 'milestraqr', updated_at = NOW()
WHERE source_project IN ('default', 'nooktraqr')
  AND content ILIKE '%milestraqr%'
  AND content NOT ILIKE '%nooktraqr%';

-- Traqr Site memories
UPDATE memories SET source_project = 'traqr-site', updated_at = NOW()
WHERE source_project IN ('default', 'nooktraqr')
  AND (content ILIKE '%traqr-site%' OR content ILIKE '%traqr.dev%')
  AND content NOT ILIKE '%nooktraqr%';

-- Platform/shared memories
UPDATE memories SET source_project = 'platform', updated_at = NOW()
WHERE source_project = 'default'
  AND (content ILIKE '%apps/platform%' OR content ILIKE '%traqr-mesh%' OR content ILIKE '%agent mesh%')
  AND content NOT ILIKE '%nooktraqr%';
