-- 026_td1383_extensions_out_of_public.sql — TD-1383
--
-- vector, pg_trgm and btree_gist were created in `public` (setup.sql, jiggy 001),
-- the schema PostgREST exposes, so every one of their ~330 functions was an
-- anon-callable RPC endpoint (has_function_privilege('anon', fn, 'EXECUTE') was
-- true for all of them). Supabase's default home is `extensions`, which PostgREST
-- reaches through db-extra-search-path but never exposes (lint 0014). All three
-- report extrelocatable = true, so this is a catalog move: the vector(1536) and
-- halfvec(1536) column types, the HNSW index on traqr_memories and the two
-- btree_gist EXCLUDE constraints on jiggy.* follow their OIDs and are untouched.
--
-- The one thing a move can break is a function with a PINNED search_path that
-- omits `extensions` and resolves `<=>` (or `similarity()`) unqualified. Four do:
--   find_duplicate_memory_pairs, search_memories, search_memories_cross_project
--   (search_path = public) and search_entities (search_path = '' — which also
--   left it unable to find `memory_entities`; it has been unrunnable since its
--   search_path was pinned on 2026-04-08 and nothing in production calls it).
-- (025_qualify_search_entities_searchpath / #4523 qualified the table but pinned
-- search_path = ''; probed live 2026-09-05: `<=>` raises 42883 under an empty path,
-- so that file now pins `public, extensions` too, and this ALTER is belt-and-braces.)
-- They are re-pinned to `public, extensions` BEFORE the move, in the same
-- transaction. Sessions already carry `extensions`: the postgres role's
-- search_path is "$user", public, extensions and PostgREST's extra search path
-- is public, extensions. Every other pinned function was scanned (pg_proc,
-- 2026-09-05): none references a vector / trgm / gist operator.
--
-- Dry-run on traqr-db 2026-09-05 04:05Z: search_memories (3 rows),
-- search_memories_cross_project, search_entities and extensions.similarity() all
-- execute after the move; HNSW index valid; both EXCLUDE constraints present;
-- 0 extension functions left in public. setup.sql (memory + memory-mcp) now
-- creates the extensions WITH SCHEMA extensions and pins the same search_path,
-- so a fresh install matches this state.

-- ⚠️ ATOMICITY IS LOAD-BEARING, so this file opens its own transaction rather
-- than trusting the applier to. The header above states the re-pins happen
-- "in the same transaction" and the guard below says "refuse to commit" — but
-- nothing here opened one. A RAISE inside a DO block unwinds only that block,
-- so outside an explicit transaction the three ALTER EXTENSION statements have
-- already autocommitted by the time the guard runs: a failed check would leave
-- vector/pg_trgm/btree_gist moved out of public with the HNSW index unverified,
-- on the DB the fleet's entire recall path reads.
BEGIN;

ALTER FUNCTION public.find_duplicate_memory_pairs(double precision, integer) SET search_path = public, extensions;
ALTER FUNCTION public.search_memories(vector, uuid, character varying, character varying[], boolean, integer, double precision, boolean, character varying, character varying) SET search_path = public, extensions;
ALTER FUNCTION public.search_memories_cross_project(vector, uuid, character varying, character varying, character varying[], boolean, boolean, character varying, integer, double precision, boolean, character varying, character varying) SET search_path = public, extensions;
ALTER FUNCTION public.search_entities(uuid, vector, character varying, double precision, integer) SET search_path = public, extensions;

ALTER EXTENSION vector SET SCHEMA extensions;
ALTER EXTENSION pg_trgm SET SCHEMA extensions;
ALTER EXTENSION btree_gist SET SCHEMA extensions;

-- Guard: refuse to commit if anything stayed behind or the hot path stopped resolving.
DO $$
DECLARE emb extensions.vector; leftover int; hnsw_ok boolean;
BEGIN
  SELECT count(*) INTO leftover
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
  JOIN pg_extension e ON e.oid = d.refobjid
  WHERE e.extname IN ('vector', 'pg_trgm', 'btree_gist') AND ns.nspname = 'public';
  IF leftover > 0 THEN
    RAISE EXCEPTION '% extension functions still in public - refusing to apply', leftover;
  END IF;
  SELECT indisvalid INTO hnsw_ok FROM pg_index WHERE indexrelid = 'public.idx_traqr_memories_active_embedding'::regclass;
  IF NOT coalesce(hnsw_ok, false) THEN
    RAISE EXCEPTION 'idx_traqr_memories_active_embedding is not valid after the move - refusing to apply';
  END IF;
  SELECT embedding INTO emb FROM public.traqr_memories
  WHERE embedding IS NOT NULL AND is_archived = false ORDER BY created_at DESC LIMIT 1;
  IF emb IS NOT NULL THEN
    PERFORM public.search_memories(emb, NULL, NULL, NULL, false, 1, 0.0, true, NULL, NULL);
    PERFORM public.search_memories_cross_project(emb, NULL, NULL, NULL, NULL, false, true, NULL, 1, 0.0, true, NULL, NULL);
    PERFORM public.search_entities('00000000-0000-0000-0000-000000000000'::uuid, emb, NULL, 0.0, 1);
  END IF;
  PERFORM extensions.similarity('probe', 'probe');
END $$;

COMMIT;
