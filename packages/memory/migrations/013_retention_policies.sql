-- ============================================================================
-- Migration 013: Retention Policies & Right-to-Delete (TD-716)
-- ============================================================================
-- Per-client data lifecycle, automated cleanup, GDPR Article 17 compliance.
-- Depends on: 012_security_classification.sql (client_namespace, audit log)
-- Safe to re-run: all operations use IF NOT EXISTS / CREATE OR REPLACE.
-- ============================================================================


-- ============================================================================
-- SECTION A: Retention Policy Column
-- ============================================================================

-- Retention policy types:
--   permanent         — Sean's personal memories, never auto-deleted
--   client_engagement — deleted N days after engagement ends
--   session           — deleted after the session ends (same day)
--   manual            — explicitly kept, exempt from auto-cleanup

ALTER TABLE traqr_memories
  ADD COLUMN IF NOT EXISTS retention_policy VARCHAR(20) DEFAULT 'permanent';

DO $$
BEGIN
  ALTER TABLE traqr_memories
    ADD CONSTRAINT chk_retention_policy CHECK (
      retention_policy IN ('permanent', 'client_engagement', 'session', 'manual')
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- When this memory's retention expires (NULL = never)
ALTER TABLE traqr_memories
  ADD COLUMN IF NOT EXISTS retention_expires_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Index for cleanup job to find expired memories efficiently
CREATE INDEX IF NOT EXISTS idx_traqr_memories_retention_expires
  ON traqr_memories(retention_expires_at)
  WHERE retention_expires_at IS NOT NULL
    AND is_archived = FALSE
    AND is_forgotten = FALSE;


-- ============================================================================
-- SECTION B: Backfill — Set retention on existing client-namespaced memories
-- ============================================================================

-- Client-namespaced memories default to client_engagement (90-day retention)
UPDATE traqr_memories
SET retention_policy = 'client_engagement',
    retention_expires_at = created_at + INTERVAL '90 days'
WHERE client_namespace IS NOT NULL
  AND retention_policy = 'permanent';

-- Sean's personal memories stay permanent (the column default)


-- ============================================================================
-- SECTION C: Export Client Namespace (pre-deletion compliance export)
-- ============================================================================

CREATE OR REPLACE FUNCTION export_client_namespace(
  p_client_namespace VARCHAR
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  summary VARCHAR,
  category VARCHAR,
  tags VARCHAR[],
  domain VARCHAR,
  topic VARCHAR,
  classification VARCHAR,
  retention_policy VARCHAR,
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE,
  source_type VARCHAR,
  source_ref VARCHAR
)
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id, m.content, m.summary, m.category, m.tags,
    m.domain, m.topic, m.classification, m.retention_policy,
    m.created_at, m.updated_at, m.source_type, m.source_ref
  FROM public.traqr_memories m
  WHERE m.client_namespace = p_client_namespace
    AND m.is_forgotten = FALSE
  ORDER BY m.created_at ASC;
END;
$$;


-- ============================================================================
-- SECTION D: Purge Client Namespace (GDPR Article 17 right-to-delete)
-- ============================================================================
-- Hard-deletes ALL memories for a client namespace.
-- Audit log entries are RETAINED (proves compliance).
-- Returns count of deleted memories.

CREATE OR REPLACE FUNCTION purge_client_namespace(
  p_client_namespace VARCHAR,
  p_agent_id VARCHAR DEFAULT NULL,
  p_reason VARCHAR DEFAULT 'right-to-delete'
)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  deleted_count INTEGER;
  deleted_ids UUID[];
BEGIN
  -- Collect IDs before deletion (for audit trail)
  SELECT ARRAY_AGG(id) INTO deleted_ids
  FROM public.traqr_memories
  WHERE client_namespace = p_client_namespace;

  IF deleted_ids IS NULL OR array_length(deleted_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  -- Delete memory-entity links
  DELETE FROM public.memory_entity_links
  WHERE memory_id = ANY(deleted_ids);

  -- Delete memory relationships
  DELETE FROM public.memory_relationships
  WHERE source_memory_id = ANY(deleted_ids)
     OR target_memory_id = ANY(deleted_ids);

  -- Hard-delete the memories (including embeddings)
  DELETE FROM public.traqr_memories
  WHERE client_namespace = p_client_namespace;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  -- Log the purge to audit trail (audit entries RETAINED for compliance proof)
  INSERT INTO public.memory_audit_log (
    operation, agent_id, memory_ids, result_count,
    client_namespace, metadata
  ) VALUES (
    'delete', p_agent_id, deleted_ids, deleted_count,
    p_client_namespace,
    jsonb_build_object(
      'action', 'purge_namespace',
      'reason', p_reason,
      'purged_at', NOW()
    )
  );

  RETURN deleted_count;
END;
$$;


-- ============================================================================
-- SECTION E: Cleanup Expired Retention (automated cron job)
-- ============================================================================
-- Finds memories past their retention_expires_at and hard-deletes them.
-- Returns count of deleted memories.

CREATE OR REPLACE FUNCTION cleanup_expired_retention()
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  deleted_count INTEGER;
  deleted_ids UUID[];
  ns RECORD;
BEGIN
  deleted_count := 0;

  -- Process by namespace for per-namespace audit entries
  FOR ns IN
    SELECT DISTINCT client_namespace
    FROM public.traqr_memories
    WHERE retention_expires_at IS NOT NULL
      AND retention_expires_at <= NOW()
      AND is_forgotten = FALSE
  LOOP
    -- Collect IDs for this namespace batch
    SELECT ARRAY_AGG(id) INTO deleted_ids
    FROM public.traqr_memories
    WHERE retention_expires_at IS NOT NULL
      AND retention_expires_at <= NOW()
      AND is_forgotten = FALSE
      AND (
        (ns.client_namespace IS NULL AND client_namespace IS NULL)
        OR client_namespace = ns.client_namespace
      );

    IF deleted_ids IS NOT NULL AND array_length(deleted_ids, 1) > 0 THEN
      -- Clean up relationships
      DELETE FROM public.memory_entity_links
      WHERE memory_id = ANY(deleted_ids);

      DELETE FROM public.memory_relationships
      WHERE source_memory_id = ANY(deleted_ids)
         OR target_memory_id = ANY(deleted_ids);

      -- Hard-delete expired memories
      DELETE FROM public.traqr_memories
      WHERE id = ANY(deleted_ids);

      deleted_count := deleted_count + array_length(deleted_ids, 1);

      -- Audit log per namespace
      INSERT INTO public.memory_audit_log (
        operation, memory_ids, result_count,
        client_namespace, metadata
      ) VALUES (
        'delete', deleted_ids, array_length(deleted_ids, 1),
        ns.client_namespace,
        jsonb_build_object(
          'action', 'retention_cleanup',
          'reason', 'retention_expired',
          'cleaned_at', NOW()
        )
      );
    END IF;
  END LOOP;

  RETURN deleted_count;
END;
$$;


-- ============================================================================
-- SECTION F: Hard-Delete Single Memory (replaces soft-delete for GDPR)
-- ============================================================================

CREATE OR REPLACE FUNCTION hard_delete_memory(
  p_memory_id UUID,
  p_agent_id VARCHAR DEFAULT NULL,
  p_reason VARCHAR DEFAULT 'forgotten'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  mem_namespace VARCHAR;
  mem_classification VARCHAR;
BEGIN
  -- Capture metadata before deletion
  SELECT client_namespace, classification
  INTO mem_namespace, mem_classification
  FROM public.traqr_memories
  WHERE id = p_memory_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Clean up relationships
  DELETE FROM public.memory_entity_links WHERE memory_id = p_memory_id;
  DELETE FROM public.memory_relationships
  WHERE source_memory_id = p_memory_id OR target_memory_id = p_memory_id;

  -- Hard-delete the memory
  DELETE FROM public.traqr_memories WHERE id = p_memory_id;

  -- Audit trail
  INSERT INTO public.memory_audit_log (
    operation, agent_id, memory_ids, result_count,
    client_namespace, classification_level, metadata
  ) VALUES (
    'forget', p_agent_id, ARRAY[p_memory_id], 1,
    mem_namespace, mem_classification,
    jsonb_build_object('reason', p_reason, 'hard_delete', true)
  );

  RETURN TRUE;
END;
$$;


-- ============================================================================
-- SECTION G: Migration Tracking
-- ============================================================================

INSERT INTO _traqr_migrations (name) VALUES ('013_retention_policies.sql')
ON CONFLICT DO NOTHING;
