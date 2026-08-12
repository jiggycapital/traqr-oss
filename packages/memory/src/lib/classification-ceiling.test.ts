/**
 * Classification Ceiling — defense-in-depth post-filter tests (TD-810).
 *
 * Pins applyClassificationCeiling: the choke point at the END of searchMemoriesV2
 * that drops over-tier rows surfaced by the classification-BLIND strategies
 * (bm25/temporal/graph + getById hydration). Only `semantic` threaded accessLevel
 * to the DB, so any non-semantic strategy could leak confidential/restricted rows
 * past the accessLevel ceiling — this filter closes that gap at the result edge.
 *
 * Pure/deterministic: no DB, no embeddings. Matches the tsx-script convention of
 * retrieval.test.ts / context.test.ts.
 *
 * Run: npx tsx packages/memory/src/lib/classification-ceiling.test.ts
 */

import {
  applyClassificationCeiling,
  allowedClassificationsForCeiling,
  resolveClassificationCeiling,
} from './retrieval.js'
import { exceedsClassificationCeiling } from '../vectordb/types.js'
import type { MemoryClassification } from '../vectordb/types.js'

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

// Minimal row shape — applyClassificationCeiling only reads `classification`.
type Row = { id: string; classification?: MemoryClassification }

const rows: Row[] = [
  { id: 'pub', classification: 'public' },
  { id: 'int', classification: 'internal' },
  { id: 'conf', classification: 'confidential' },
  { id: 'restr', classification: 'restricted' },
]

console.log('\n--- applyClassificationCeiling (TD-810) ---')

// 1. The TD-810 leak shape: a confidential row surfaced by a non-semantic
//    strategy is excluded at exploration tier. Exploration ceiling = 'internal',
//    so confidential + restricted are dropped; public + internal are kept.
{
  const out = applyClassificationCeiling(rows, 'exploration')
  const ids = out.map((r) => r.id)
  assert('exploration keeps public + internal', ids.includes('pub') && ids.includes('int'))
  assert('exploration drops confidential (the TD-810 leak shape)', !ids.includes('conf'))
  assert('exploration drops restricted', !ids.includes('restr'))
  assert('exploration result count is 2', out.length === 2)
}

// 2. Fail-safe: no accessLevel + no maxClassification → input unchanged.
{
  const out = applyClassificationCeiling(rows)
  assert('no ceiling → same length', out.length === rows.length)
  assert('no ceiling → same order/identity', out.map((r) => r.id).join() === rows.map((r) => r.id).join())
  assert('no ceiling → returns the same array reference (zero-copy pass-through)', out === rows)
}

// 3. admin ceiling (restricted) keeps everything.
{
  const out = applyClassificationCeiling(rows, 'admin')
  assert('admin keeps all 4 rows', out.length === 4)
  assert('admin keeps restricted', out.some((r) => r.id === 'restr'))
}

// 4. A row with classification: undefined is treated as public (kept) even at
//    the lowest tier.
{
  const withUndefined: Row[] = [{ id: 'noclass' }, { id: 'conf', classification: 'confidential' }]
  const out = applyClassificationCeiling(withUndefined, 'exploration')
  const ids = out.map((r) => r.id)
  assert('undefined classification treated as public → kept', ids.includes('noclass'))
  assert('undefined-class row kept while confidential dropped', !ids.includes('conf') && out.length === 1)
}

// 5. Explicit maxClassification overrides accessLevel.
//    accessLevel=admin would keep all, but maxClassification=internal lowers it.
{
  const out = applyClassificationCeiling(rows, 'admin', 'internal')
  const ids = out.map((r) => r.id)
  assert('maxClassification overrides accessLevel (admin → internal ceiling)', out.length === 2)
  assert('override keeps public + internal only', ids.includes('pub') && ids.includes('int') && !ids.includes('conf'))
}

// 6. standard ceiling (confidential) keeps public/internal/confidential, drops restricted.
{
  const out = applyClassificationCeiling(rows, 'standard')
  const ids = out.map((r) => r.id)
  assert('standard keeps confidential', ids.includes('conf'))
  assert('standard drops restricted', !ids.includes('restr') && out.length === 3)
}

// 7. Fail-closed: an unknown classification string (not in CLASSIFICATION_RANK)
//    is dropped rather than leaked.
{
  const weird: Row[] = [
    { id: 'pub', classification: 'public' },
    { id: 'bogus', classification: 'topsecret' as unknown as MemoryClassification },
  ]
  const out = applyClassificationCeiling(weird, 'admin')
  const ids = out.map((r) => r.id)
  assert('unknown classification fails closed (dropped even at admin)', !ids.includes('bogus'))
  assert('known row alongside unknown still kept', ids.includes('pub') && out.length === 1)
}

// ===========================================================================
// TD-883: browse + getById direct-retrieval ceilings.
// The browse route filters at the DB via allowedClassificationsForCeiling;
// the getById path redacts over-tier rows via exceedsClassificationCeiling.
// These pure helpers back both surfaces, so pinning them pins the behavior.
// ===========================================================================

console.log('\n--- allowedClassificationsForCeiling (TD-883 browse) ---')

// (a) browse summaries drop over-tier rows under exploration, keep public+internal.
{
  const allowed = allowedClassificationsForCeiling('exploration')
  assert('exploration → allowed list defined', !!allowed)
  assert('exploration allows public', !!allowed?.includes('public'))
  assert('exploration allows internal', !!allowed?.includes('internal'))
  assert('exploration drops confidential', !allowed?.includes('confidential'))
  assert('exploration drops restricted', !allowed?.includes('restricted'))
  assert('exploration allowed count is 2', allowed?.length === 2)
  // 'internal' is in-tier → NULL rows (which hydrate to 'internal') are admitted.
  assert('exploration admits NULL rows (internal in tier)', !!allowed?.includes('internal'))
}

// (b) browse with no accessLevel = unchanged (undefined → caller skips filter).
{
  const allowed = allowedClassificationsForCeiling()
  assert('no accessLevel → undefined (no DB filter, unchanged behavior)', allowed === undefined)
  assert('no ceiling resolved when neither arg given', resolveClassificationCeiling() === undefined)
}

// standard ceiling allows public/internal/confidential, drops restricted.
{
  const allowed = allowedClassificationsForCeiling('standard')
  assert('standard allows confidential', !!allowed?.includes('confidential'))
  assert('standard drops restricted', !allowed?.includes('restricted'))
  assert('standard allowed count is 3', allowed?.length === 3)
}

// maxClassification overrides accessLevel (admin → internal ceiling).
{
  const allowed = allowedClassificationsForCeiling('admin', 'internal')
  assert('override: admin+internal allows only public+internal', allowed?.length === 2 && !allowed?.includes('confidential'))
}

// confidential ceiling: NULL rows still admitted (internal < confidential).
{
  const allowed = allowedClassificationsForCeiling('standard')
  assert('confidential ceiling still admits NULL (internal in tier)', !!allowed?.includes('internal'))
}

console.log('\n--- exceedsClassificationCeiling (TD-883 getById) ---')

// (c) getById returns null for over-tier under a ceiling.
{
  assert('confidential exceeds exploration ceiling → redacted', exceedsClassificationCeiling('confidential', 'exploration') === true)
  assert('restricted exceeds exploration ceiling → redacted', exceedsClassificationCeiling('restricted', 'exploration') === true)
}

// (c) getById returns the row when in-tier.
{
  assert('public in-tier at exploration → kept', exceedsClassificationCeiling('public', 'exploration') === false)
  assert('internal in-tier at exploration → kept', exceedsClassificationCeiling('internal', 'exploration') === false)
  assert('confidential in-tier at standard → kept', exceedsClassificationCeiling('confidential', 'standard') === false)
}

// (c) getById returns the row with no ceiling (no opts → never exceeds).
{
  assert('no ceiling → restricted never redacted', exceedsClassificationCeiling('restricted') === false)
  assert('no ceiling → undefined classification never redacted', exceedsClassificationCeiling(undefined) === false)
}

// undefined classification treated as public (kept) even at lowest tier.
{
  assert('undefined classification at exploration → kept (public)', exceedsClassificationCeiling(undefined, 'exploration') === false)
}

// maxClassification overrides accessLevel in the getById predicate too.
{
  assert('admin+internal ceiling redacts confidential', exceedsClassificationCeiling('confidential', 'admin', 'internal') === true)
}

// fail-closed: unknown classification string is redacted (exceeds) even at admin.
{
  assert('unknown classification fails closed → redacted', exceedsClassificationCeiling('topsecret' as MemoryClassification, 'admin') === true)
}

console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('CLASSIFICATION-CEILING TESTS FAILED')
  process.exit(1)
} else {
  console.log('All classification-ceiling tests passed!')
}
