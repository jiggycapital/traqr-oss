-- Add durability and expires_at columns to memories table
-- Supports permanent vs temporary vs session-scoped learnings

ALTER TABLE memories ADD COLUMN IF NOT EXISTS durability VARCHAR(20) DEFAULT 'permanent';
ALTER TABLE memories ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;

-- Index for efficient expired memory cleanup
CREATE INDEX IF NOT EXISTS idx_memories_expires_at ON memories (expires_at)
  WHERE expires_at IS NOT NULL AND durability != 'permanent';

-- Update the search function to filter expired memories by default
-- The application layer handles this via the excludeExpired option,
-- but this index makes the WHERE clause efficient.

COMMENT ON COLUMN memories.durability IS 'permanent = never expires, temporary = has explicit TTL, session = expires with session';
COMMENT ON COLUMN memories.expires_at IS 'When this memory should be considered expired (null = never)';
