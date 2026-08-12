/**
 * migration-files — the forward/rollback split the migration runner relies on.
 *
 * The hazard this guards (2026-07-02 ledger-reconcile finding): rollback
 * files sort after their forward migration, so a naive `*.sql` glob would
 * run `011_rollback.sql` as a "pending migration" — against the live DB that
 * drops search_memories and the whole v2 function set.
 *
 * Run: npx tsx packages/memory/src/lib/migration-files.test.ts
 */

import { selectForwardMigrations } from './migration-files.js'

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

// The real directory shape at the time of the incident.
const listing = [
  '011_memory_engine_v2_schema.sql',
  '011_rollback.sql',
  '015_archival_protected_tag_guard.sql',
  '015_optimize_find_duplicate_memory_pairs.sql',
  '015_rollback.sql',
  '018_search_memories_compute_once.sql',
  'README.md',
]

const { forward, rollbacks } = selectForwardMigrations(listing)

assert('rollback files are excluded from the forward run', !forward.some(f => f.endsWith('_rollback.sql')))
assert('both rollback files are reported for visibility', rollbacks.length === 2 && rollbacks.includes('011_rollback.sql') && rollbacks.includes('015_rollback.sql'))
assert('all forward migrations survive the split', forward.length === 4)
assert('non-sql files are ignored entirely', !forward.includes('README.md') && !rollbacks.includes('README.md'))
assert(
  'forward order is lexicographic even from an unsorted listing',
  selectForwardMigrations([...listing].reverse()).forward.join(',') === forward.join(',')
)
assert('a lone rollback file never becomes a forward migration', selectForwardMigrations(['023_rollback.sql']).forward.length === 0)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
