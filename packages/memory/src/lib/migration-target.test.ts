/**
 * migration-target — the wrong-database guard the migration runner relies on.
 *
 * The hazard this guards (2026-08-12, TD-1211 cave): every one of the 18
 * worktrees carried a `.env.local` whose `SUPABASE_URL` resolved to project
 * `dqrpvkpvtxgmacdjfxdt` — with a live matching `service_role` key — while
 * these migrations belong to `krzajogmytxbudzisydm`. The runner had no notion
 * of a target; it applied whatever was pending to whatever answered.
 *
 * It failed closed only because the wrong project happened to lack the tracking
 * table, and the message it printed on that exit told the operator to create the
 * missing piece — on the wrong database. Hence the explicit refusal, and hence
 * the test below asserting the refusal does NOT recommend that.
 *
 * Run: npx tsx packages/memory/src/lib/migration-target.test.ts
 */

import {
  KNOWN_MEMORY_DB_REF,
  extractProjectRef,
  resolveMigrationTarget,
} from './migration-target.js'

let passed = 0
let failed = 0

function assert(label: string, condition: boolean) {
  if (condition) {
    console.log(`  PASS  ${label}`)
    passed++
  } else {
    console.log(`  FAIL  ${label}`)
    failed++
  }
}

const RIGHT = `https://${KNOWN_MEMORY_DB_REF}.supabase.co`
// The exact value found in all 18 worktrees on 2026-08-12.
const WRONG = 'https://dqrpvkpvtxgmacdjfxdt.supabase.co'

// --- ref extraction ---------------------------------------------------------
assert('extracts the ref from a project URL', extractProjectRef(RIGHT) === KNOWN_MEMORY_DB_REF)
assert('extracts the ref regardless of trailing path', extractProjectRef(`${RIGHT}/rest/v1/`) === KNOWN_MEMORY_DB_REF)
assert('returns null for a non-supabase host', extractProjectRef('https://example.com') === null)
assert('returns null for localhost', extractProjectRef('http://localhost:54321') === null)
assert('returns null for unparseable input', extractProjectRef('not a url') === null)

// --- the live incident ------------------------------------------------------
const wrong = resolveMigrationTarget({ supabaseUrl: WRONG })
assert('the 2026-08-12 fleet-wide value is REFUSED', wrong.ok === false)
assert(
  'the refusal names both the actual and the intended project',
  !wrong.ok && wrong.reason.includes('dqrpvkpvtxgmacdjfxdt') && wrong.reason.includes(KNOWN_MEMORY_DB_REF)
)
// The pre-fix runner told the operator to create exec_sql / paste the schema.
// Doing that on the wrong database is what turns this from a stalled run into
// a schema overwrite, so the refusal must actively warn against it.
assert(
  'the refusal warns against creating the missing pieces on the wrong DB',
  !wrong.ok && /do not/i.test(wrong.reason) && wrong.reason.includes('exec_sql')
)

// --- the correct target -----------------------------------------------------
const right = resolveMigrationTarget({ supabaseUrl: RIGHT })
assert('the memory store is allowed', right.ok === true && right.ref === KNOWN_MEMORY_DB_REF)
assert(
  'the correct target needs no env override (zero friction on the good path)',
  resolveMigrationTarget({ supabaseUrl: RIGHT, expectedRef: undefined }).ok === true
)

// --- deliberate override ----------------------------------------------------
assert(
  'TRAQR_MEMORY_DB_REF permits a deliberately different memory store',
  resolveMigrationTarget({ supabaseUrl: WRONG, expectedRef: 'dqrpvkpvtxgmacdjfxdt' }).ok === true
)
assert(
  'an override that does not match the URL is still refused',
  resolveMigrationTarget({ supabaseUrl: WRONG, expectedRef: 'zwjiqdpjlnblxmnsoxhj' }).ok === false
)
assert(
  'a blank override falls back to the known store rather than allowing anything',
  resolveMigrationTarget({ supabaseUrl: WRONG, expectedRef: '   ' }).ok === false
)

// --- missing / unidentifiable target ----------------------------------------
assert('an unset SUPABASE_URL is refused', resolveMigrationTarget({ supabaseUrl: undefined }).ok === false)
assert('an empty SUPABASE_URL is refused', resolveMigrationTarget({ supabaseUrl: '' }).ok === false)
assert(
  'an unidentifiable host is refused rather than assumed correct',
  resolveMigrationTarget({ supabaseUrl: 'https://example.com' }).ok === false
)

// A guard that can only ever say "no" is not a guard — pin that it can pass.
assert(
  'the guard is capable of returning ok (not vacuously refusing)',
  resolveMigrationTarget({ supabaseUrl: RIGHT }).ok === true
)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
