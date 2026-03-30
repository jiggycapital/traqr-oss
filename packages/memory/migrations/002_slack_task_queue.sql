-- NookTraqr Slack Task Queue Schema
-- Migration 002: Task queue and idempotency tables
-- Run this in Supabase SQL Editor
--
-- This replaces /tmp/nooktraqr-claude-tasks.json with persistent storage
-- and adds request deduplication to prevent Slack retry duplicates.

-- ============================================================
-- 1. SLACK TASK QUEUE
-- Persistent task queue for Claude daemon (replaces /tmp/ file)
-- ============================================================

CREATE TABLE IF NOT EXISTS slack_task_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Task identification
    task_id TEXT NOT NULL UNIQUE, -- e.g., "fix-1706234567890" or "plan-1706234567890"
    task_type TEXT NOT NULL CHECK (task_type IN ('fix', 'plan', 'investigate', 'custom')),

    -- Task details
    description TEXT NOT NULL,
    issue_id TEXT, -- Linear issue ID (e.g., "NTQ-123")
    issue_title TEXT,
    issue_url TEXT,
    issue_labels JSONB DEFAULT '[]',

    -- Source tracking
    source TEXT NOT NULL DEFAULT 'slack' CHECK (source IN ('slack', 'dev-inbox', 'webhook', 'cron', 'manual')),

    -- Slack context
    slack_user_id TEXT,
    slack_user_name TEXT,
    slack_channel_id TEXT,
    slack_message_ts TEXT,
    slack_response_url TEXT,
    slack_permalink TEXT,

    -- Status tracking
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
    claimed_by TEXT, -- Daemon instance ID that claimed this task
    claimed_at TIMESTAMPTZ,

    -- Error tracking
    error_message TEXT,
    error_count INTEGER DEFAULT 0,
    last_error_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,

    -- Expiration (auto-cleanup old completed tasks)
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days')
);

-- Indexes for efficient queries
CREATE INDEX idx_task_queue_status ON slack_task_queue(status);
CREATE INDEX idx_task_queue_task_type ON slack_task_queue(task_type);
CREATE INDEX idx_task_queue_created ON slack_task_queue(created_at DESC);
CREATE INDEX idx_task_queue_issue_id ON slack_task_queue(issue_id);
CREATE INDEX idx_task_queue_pending ON slack_task_queue(status, created_at) WHERE status = 'pending';
CREATE INDEX idx_task_queue_expires ON slack_task_queue(expires_at);

-- ============================================================
-- 2. SLACK EVENT DEDUPLICATION
-- Prevents duplicate processing from Slack retries (3-second timeout)
-- ============================================================

CREATE TABLE IF NOT EXISTS slack_event_dedup (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Event identification
    event_id TEXT NOT NULL UNIQUE, -- Combination of type + identifiers
    event_type TEXT NOT NULL, -- e.g., "block_action", "message", "interaction"

    -- Slack identifiers for dedup
    slack_message_ts TEXT,
    slack_action_ts TEXT,
    slack_user_id TEXT,
    slack_team_id TEXT,

    -- Result tracking (for idempotent responses)
    processed_at TIMESTAMPTZ DEFAULT NOW(),
    result_status TEXT, -- success, error
    result_data JSONB DEFAULT '{}',

    -- TTL - events older than 1 hour can be safely re-processed
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '1 hour'),

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient lookups
CREATE INDEX idx_event_dedup_event_id ON slack_event_dedup(event_id);
CREATE INDEX idx_event_dedup_expires ON slack_event_dedup(expires_at);
CREATE INDEX idx_event_dedup_type ON slack_event_dedup(event_type);

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Function to claim the next pending task (atomic)
CREATE OR REPLACE FUNCTION claim_next_task(p_daemon_id TEXT)
RETURNS TABLE(
    task_id TEXT,
    task_type TEXT,
    description TEXT,
    issue_id TEXT,
    issue_title TEXT,
    issue_url TEXT,
    slack_channel_id TEXT,
    slack_message_ts TEXT,
    slack_response_url TEXT,
    slack_permalink TEXT,
    slack_user_name TEXT
) AS $$
DECLARE
    claimed_row slack_task_queue%ROWTYPE;
BEGIN
    -- Atomically claim the oldest pending task
    UPDATE slack_task_queue
    SET
        status = 'in_progress',
        claimed_by = p_daemon_id,
        claimed_at = NOW(),
        updated_at = NOW()
    WHERE id = (
        SELECT id FROM slack_task_queue
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    RETURNING * INTO claimed_row;

    IF claimed_row.id IS NOT NULL THEN
        RETURN QUERY SELECT
            claimed_row.task_id,
            claimed_row.task_type,
            claimed_row.description,
            claimed_row.issue_id,
            claimed_row.issue_title,
            claimed_row.issue_url,
            claimed_row.slack_channel_id,
            claimed_row.slack_message_ts,
            claimed_row.slack_response_url,
            claimed_row.slack_permalink,
            claimed_row.slack_user_name;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to check and record event for deduplication
-- Returns TRUE if event should be processed, FALSE if duplicate
CREATE OR REPLACE FUNCTION check_and_record_event(
    p_event_id TEXT,
    p_event_type TEXT,
    p_message_ts TEXT DEFAULT NULL,
    p_action_ts TEXT DEFAULT NULL,
    p_user_id TEXT DEFAULT NULL,
    p_team_id TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
    existing_event slack_event_dedup%ROWTYPE;
BEGIN
    -- Try to find existing event
    SELECT * INTO existing_event
    FROM slack_event_dedup
    WHERE event_id = p_event_id
    AND expires_at > NOW();

    IF existing_event.id IS NOT NULL THEN
        -- Event already processed, return false (duplicate)
        RETURN FALSE;
    END IF;

    -- Record new event
    INSERT INTO slack_event_dedup (
        event_id,
        event_type,
        slack_message_ts,
        slack_action_ts,
        slack_user_id,
        slack_team_id
    ) VALUES (
        p_event_id,
        p_event_type,
        p_message_ts,
        p_action_ts,
        p_user_id,
        p_team_id
    )
    ON CONFLICT (event_id) DO NOTHING;

    -- Return true (process this event)
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function to cleanup expired records (call from pg_cron or application)
CREATE OR REPLACE FUNCTION cleanup_slack_queue() RETURNS TABLE(
    tasks_deleted INTEGER,
    events_deleted INTEGER
) AS $$
DECLARE
    task_count INTEGER;
    event_count INTEGER;
BEGIN
    -- Delete expired completed/cancelled/failed tasks
    DELETE FROM slack_task_queue
    WHERE expires_at < NOW()
    AND status IN ('completed', 'failed', 'cancelled');
    GET DIAGNOSTICS task_count = ROW_COUNT;

    -- Delete expired dedup records
    DELETE FROM slack_event_dedup WHERE expires_at < NOW();
    GET DIAGNOSTICS event_count = ROW_COUNT;

    RETURN QUERY SELECT task_count, event_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get queue stats
CREATE OR REPLACE FUNCTION get_task_queue_stats()
RETURNS TABLE(
    pending_count BIGINT,
    in_progress_count BIGINT,
    completed_today BIGINT,
    failed_today BIGINT
) AS $$
BEGIN
    RETURN QUERY SELECT
        COUNT(*) FILTER (WHERE status = 'pending'),
        COUNT(*) FILTER (WHERE status = 'in_progress'),
        COUNT(*) FILTER (WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours'),
        COUNT(*) FILTER (WHERE status = 'failed' AND updated_at > NOW() - INTERVAL '24 hours')
    FROM slack_task_queue;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

ALTER TABLE slack_task_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_event_dedup ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "Service role full access" ON slack_task_queue FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON slack_event_dedup FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- SCHEDULED CLEANUP
-- ============================================================

-- Note: Run after enabling pg_cron extension in Supabase dashboard
-- SELECT cron.schedule('cleanup-slack-queue', '0 */6 * * *', 'SELECT cleanup_slack_queue()');
