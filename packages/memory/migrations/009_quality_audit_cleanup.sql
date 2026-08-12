-- Memory Quality Audit Cleanup (Phase 2)
-- Migration 009: Archive low-quality memories that bypassed earlier cleanup
--
-- Targets:
-- 1A. Generic LLM observations with telltale phrasing
-- 1B. Additional stale bootstrap memories
-- 1C. PR diff-stat observations (line count commentary)
-- 1D. Trigger existing decay/stale archival functions

-- ============================================================
-- 1A. ARCHIVE GENERIC LLM OBSERVATIONS
-- These are session/pr memories with generic phrasing, never cited
-- ============================================================

UPDATE traqr_memories SET
  is_archived = TRUE,
  archived_at = NOW(),
  archive_reason = 'audit-v2: generic-llm-observation',
  updated_at = NOW()
WHERE is_archived = FALSE
  AND COALESCE(times_cited, 0) = 0
  AND source_type IN ('pr', 'session')
  AND (
    -- "indicating a value/preference/focus on/for/in"
    content ~* '\bindicating\s+(a\s+)?(value|preference|focus)\s+(on|for|in)\b'
    -- "highlighting the importance/value/preference"
    OR content ~* '\bhighlighting\s+(a|the)\s+(value|importance|preference)\b'
    -- "reflecting a design choice/preference/value"
    OR content ~* '\breflecting\s+(a\s+)?(design choice|preference|value)\b'
    -- "facilitating easier/better/improved"
    OR content ~* '\bfacilitating\s+(easier|better|improved)\b'
    -- "this approach/pattern/practice aids/helps/ensures/supports"
    OR content ~* '\bthis\s+(approach|pattern|practice)\s+(aids?|helps?|ensures?|supports?)\b'
    -- "reducing (the) cognitive load"
    OR content ~* '\breducing\s+(the\s+)?cognitive\s+load\b'
    -- "ensuring comprehensive/thorough testing"
    OR content ~* '\bensuring\s+(comprehensive|thorough|complete)\s+(testing|coverage|validation)\b'
    -- "the update/change revealed a preference"
    OR content ~* '\bthe\s+(update|change|modification)\s+revealed\s+(a\s+)?preference\b'
    -- "suggesting a recurring/systematic"
    OR content ~* '\bsuggesting\s+a\s+(recurring|systematic|structured)\b'
    -- "informs future developers"
    OR content ~* '\binforms?\s+future\s+developers?\b'
    -- "aids future developers"
    OR content ~* '\baids?\s+future\s+developers?\b'
    -- "save time for future developers"
    OR content ~* '\bsave\s+time\s+for\s+future\b'
  );

-- ============================================================
-- 1B. ARCHIVE PR DIFF-STAT OBSERVATIONS
-- LLM-extracted observations about line counts in PRs
-- ============================================================

UPDATE traqr_memories SET
  is_archived = TRUE,
  archived_at = NOW(),
  archive_reason = 'audit-v2: diff-stat-observation',
  updated_at = NOW()
WHERE is_archived = FALSE
  AND COALESCE(times_cited, 0) = 0
  AND source_type IN ('pr', 'session')
  AND (
    -- "the drastic/extensive/deliberate/major reduction/insertion/removal"
    content ~* '\bthe\s+(drastic|extensive|deliberate|significant|major)\s+(reduction|insertion|removal|addition|update|change)\s+(of|in|across)\b'
    -- "N lines across N files" pattern
    OR content ~* '\b\d+\s+lines?\s+(across|in|of)\s+\d+\s+files?\b'
    -- "extensive insertion of N lines"
    OR content ~* '\b(extensive|significant|large)\s+(insertion|addition|deletion|removal)\s+of\s+\d+\b'
  );

-- ============================================================
-- 1C. ARCHIVE GENERIC CONVENTION/PATTERN MEMORIES
-- Overly generic advice masquerading as conventions
-- ============================================================

UPDATE traqr_memories SET
  is_archived = TRUE,
  archived_at = NOW(),
  archive_reason = 'audit-v2: generic-convention',
  updated_at = NOW()
WHERE is_archived = FALSE
  AND COALESCE(times_cited, 0) = 0
  AND COALESCE(times_returned, 0) <= 1
  AND source_type IN ('pr', 'session')
  AND category IN ('preference', 'convention', 'pattern')
  AND (
    -- "Use [X] to [generic benefit]"
    content ~* '^\s*Use\s+\w+\s+to\s+(maintain|ensure|improve|enhance|reduce|facilitate)\b'
    -- "It's a good practice to"
    OR content ~* '\bit.s\s+a\s+good\s+practice\s+to\b'
    -- "preserve existing interfaces"
    OR content ~* '\bpreserving?\s+existing\s+interfaces?\b'
    -- "component reusability and isolation"
    OR content ~* '\bcomponent\s+reusability\s+and\s+isolation\b'
    -- "loosely coupled component structures"
    OR content ~* '\bloosely\s+coupled\s+component\b'
  );

-- ============================================================
-- 1D. ADDITIONAL STALE BOOTSTRAP CLEANUP
-- Bootstrap memories referencing systems that evolved significantly
-- ============================================================

UPDATE traqr_memories SET
  is_archived = TRUE,
  archived_at = NOW(),
  archive_reason = 'audit-v2: stale-bootstrap',
  updated_at = NOW()
WHERE is_archived = FALSE
  AND COALESCE(times_cited, 0) = 0
  AND source_type = 'bootstrap'
  AND (
    content ILIKE '%grunt-teacher%'
    OR content ILIKE '%skill-evolution%'
    OR content ILIKE '%analyze-escalations%'
    OR content ILIKE '%mega_plan%'
    OR content ILIKE '%nooktraqr-email-metrics.json%'
    OR content ILIKE '%38 Supabase tables exist%'
  );

-- ============================================================
-- 1E. RUN EXISTING DECAY FUNCTIONS
-- These may not have been run recently
-- ============================================================

-- Archive memories that decayed below confidence threshold
SELECT * FROM archive_decayed_memories();

-- Archive stale uncited memories (>90 days, <=2 returns)
SELECT * FROM archive_stale_uncited_memories();

-- ============================================================
-- VERIFY RESULTS
-- ============================================================

-- Check how many were archived by this migration:
-- SELECT archive_reason, COUNT(*) FROM traqr_memories
-- WHERE archive_reason LIKE 'audit-v2:%'
-- GROUP BY archive_reason ORDER BY count DESC;
