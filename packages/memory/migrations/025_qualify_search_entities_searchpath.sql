-- 025_qualify_search_entities_searchpath.sql
--
-- THE BUG (42P01, silent) — the SAME class as 020, one function over.
-- `search_entities` is declared `SET search_path = ''` ON THE LIVE DB but its body
-- references `memory_entities` UNQUALIFIED, so every call throws
-- `42P01: relation "memory_entities" does not exist`. Its only caller swallows it:
-- `vectordb/supabase.ts` findEntityByEmbedding → `if (error || !data || ...) return null`
-- — byte-identical to "no entity matched". So embedding-based (fuzzy/semantic) entity
-- lookup has been a silent no-op, while name-based dedup kept working and masked it.
--
-- PROVEN LIVE on traqr-db 2026-09-05 (Feature2 /bethesda), by calling the deployed fn:
--   SELECT * FROM public.search_entities('000...0'::uuid,
--            array_fill(0::real, ARRAY[1536])::vector, NULL, 0.85, 1);
--   ERROR: 42P01: relation "memory_entities" does not exist
--   CONTEXT: PL/pgSQL function public.search_entities(...) line 3 at RETURN QUERY
--
-- WHY THE REPO LOOKED CLEAN. This is OUT-OF-BAND DB drift, not a bad commit:
--   repo setup.sql : SET search_path = public  + bare memory_entities  -> RESOLVES (fine)
--   live traqr-db  : SET search_path = ''      + bare memory_entities  -> 42P01
-- The Supabase `function_search_path_mutable` advisor rewrites `= public` -> `= ''`
-- body-blind (TD-766) — exactly the "re-flag and re-break it" hazard 020's own header
-- warned about. `audit:sql-search-path` reads committed files, so it is STRUCTURALLY
-- blind to this and passes green forever.
--
-- NOTE ON THE LIVE GATE. `scripts/check-sql-search-path-live.mjs` exists precisely to
-- catch this and has NEVER RUN against a database — it needs TRAQR_DATABASE_URL /
-- DATABASE_URL, neither of which is provisioned (verified 2026-09-05); its header defers
-- that wiring to TD-903. Its own --selftest answer key already flags
-- `check_and_record_event`, so that instance was captured-but-unactioned. This migration
-- is the remediation; wiring the gate is the durable fix and is a separate ask.
--
-- Was it always broken? No — 019 (2026-06-14) captured a live EXPLAIN ANALYZE of this
-- function seq-scanning `memory_entities` ("Rows Removed by Filter: 1978", ~1.3 s/call),
-- so it executed then. The drift is later. This is a REGRESSION, not dead-on-arrival code.
--
-- FIX (identical shape to 020): keep `search_path = ''` — the advisor-approved secure end
-- state, so the advisor cannot re-flag and re-break it — and schema-qualify the body.
-- Idempotent; changes no signature, no plan, no behavior beyond "runs at all".
--
-- ALSO FIXED: `check_and_record_event` — same declaration/body mismatch on traqr-db
-- (`INSERT INTO slack_event_dedup` unqualified). On traqr-db it has no packages/ caller
-- (PokoTraqr calls its own project's copy), so this is hygiene, not a live outage — but it
-- is the identical defect and 020's precedent is to converge rather than leave a known
-- landmine armed.

CREATE OR REPLACE FUNCTION public.search_entities(
  p_user_id UUID,
  p_embedding vector(1536),
  p_entity_type VARCHAR DEFAULT NULL,
  p_threshold FLOAT DEFAULT 0.85,
  p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  name VARCHAR,
  entity_type VARCHAR,
  similarity FLOAT,
  mentions_count INTEGER
)
LANGUAGE plpgsql
-- TD-1383 correction (DevOps1, 2026-09-05, before this file was applied): under
-- search_path = '' the `<=>` operator does not resolve either — probed live:
--   42883: operator does not exist: public.vector <=> public.vector
-- so '' + a qualified table trades the 42P01 for a 42883. `public, extensions`
-- passes lint 0011 (it flags only an UNSET search_path) and resolves the operator
-- before and after 026 moves vector to `extensions`.
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id, e.name, e.entity_type,
    1 - (e.embedding <=> p_embedding) AS similarity,
    e.mentions_count
  FROM public.memory_entities e
  WHERE e.user_id = p_user_id
    AND e.is_archived = FALSE
    AND (p_entity_type IS NULL OR e.entity_type = p_entity_type)
    AND 1 - (e.embedding <=> p_embedding) >= p_threshold
  ORDER BY similarity DESC
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_and_record_event(
  p_event_id TEXT,
  p_event_type TEXT,
  p_message_ts TEXT,
  p_action_ts TEXT,
  p_user_id TEXT,
  p_team_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.slack_event_dedup (event_id, event_type, message_ts, action_ts, user_id, team_id)
  VALUES (p_event_id, p_event_type, p_message_ts, p_action_ts, p_user_id, p_team_id)
  ON CONFLICT (event_id) DO NOTHING;
  RETURN FOUND;
END;
$$;
