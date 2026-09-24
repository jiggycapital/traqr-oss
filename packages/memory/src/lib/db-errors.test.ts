/**
 * db-errors — structural-vs-transient classification for swallowed reads.
 *
 * Pins the predicate behind `logSwallowedDbError`. The failure it exists to prevent:
 * a structurally dead RPC (42P01 etc.) returning exactly what "no rows" returns, with
 * no log, forever — the shape of TD-894, TD-902 and #4523, where each fix repaired the
 * SQL and left the caller blind so the next drift was silent again.
 *
 * Run: npx tsx packages/memory/src/lib/db-errors.test.ts
 */
import { isStructuralDbError } from './db-errors.js'

let passed = 0
let failed = 0
function assert(label: string, cond: boolean) {
  if (cond) { console.log(`  PASS  ${label}`); passed++ }
  else { console.log(`  FAIL  ${label}`); failed++ }
}

console.log('\n--- structural (must be TRUE) ---')
// PostgrestError is a plain object, not an Error — the exact shape that bit PokoTraqr.
assert('42P01 undefined_table', isStructuralDbError({ code: '42P01', message: 'relation "memory_entities" does not exist' }))
assert('42883 undefined_function', isStructuralDbError({ code: '42883' }))
assert('42703 undefined_column', isStructuralDbError({ code: '42703' }))
assert('PGRST202 fn not in schema cache', isStructuralDbError({ code: 'PGRST202' }))
assert('message-only "does not exist" (no code)', isStructuralDbError({ message: 'relation "traqr_memories" does not exist' }))
assert('message-only "could not find the function"', isStructuralDbError({ message: 'Could not find the function public.search_entities' }))
assert('real Error instance carrying the text', isStructuralDbError(new Error('relation "x" does not exist')))

console.log('\n--- transient / benign (must be FALSE) ---')
assert('connection timeout is NOT structural', !isStructuralDbError({ message: 'Connection terminated due to connection timeout' }))
assert('statement timeout is NOT structural', !isStructuralDbError({ code: '57014', message: 'canceling statement due to statement timeout' }))
assert('PGRST116 (0 rows) is NOT structural', !isStructuralDbError({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }))
assert('null error is NOT structural', !isStructuralDbError(null))
assert('undefined error is NOT structural', !isStructuralDbError(undefined))
assert('empty string is NOT structural', !isStructuralDbError(''))

console.log('\n--- the discrimination that matters ---')
// Both of these are what a caller sees as `error`; only one recurs forever.
const dead = { code: '42P01', message: 'relation "memory_entities" does not exist' }
const blip = { message: 'fetch failed' }
assert('dead and blip are classified DIFFERENTLY', isStructuralDbError(dead) !== isStructuralDbError(blip))

// PostgREST's TRANSIENT schema-cache reload (PGRST001/PGRST002) shares the substring
// 'schema cache' with PGRST202/204's permanent 'Could not find ... in the schema cache'.
// traqr-db's edge logs carried 32x PGRST001 as HTTP 503 during the 2026-09-04 pooler
// restart, so this is the outage window the token exists for — it must not fire there.
assert('PGRST001 schema-cache reload is NOT structural', !isStructuralDbError({ code: 'PGRST001', message: 'Could not query the database for the schema cache. Retrying.' }))
assert('PGRST002 schema-cache reload is NOT structural', !isStructuralDbError({ code: 'PGRST002', message: 'Could not query the database for the schema cache. Retrying.' }))


console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
