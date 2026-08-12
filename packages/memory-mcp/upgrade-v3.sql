-- ============================================================================
-- TraqrDB Upgrade: Schema v2 -> v3
-- ============================================================================
-- Run this AFTER upgrading traqr-memory-mcp to v0.2.0+
--
-- Usage:
--   Supabase: Paste into SQL Editor at supabase.com/dashboard
--   Postgres: psql $DATABASE_URL -f upgrade-v3.sql
--
-- Safe to re-run: all operations use IF NOT EXISTS / CREATE OR REPLACE.
-- ============================================================================

-- (No schema changes in v0.2.0 — this file is a template for future upgrades)

-- Example patterns for future upgrades:
--
-- Add a new column:
--   ALTER TABLE traqr_memories ADD COLUMN IF NOT EXISTS new_col TEXT;
--
-- Update an RPC function:
--   CREATE OR REPLACE FUNCTION search_memories(...) ...
--
-- Add a new index:
--   CREATE INDEX IF NOT EXISTS idx_new ON traqr_memories (new_col);

-- Stamp version
INSERT INTO schema_version (version, description)
VALUES (3, 'v0.2.0 — BYO providers, teaching errors, schema detection')
ON CONFLICT (version) DO NOTHING;
