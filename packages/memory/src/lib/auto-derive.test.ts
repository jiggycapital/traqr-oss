/**
 * Auto-Derive — deriveCategory verification (TD-726)
 *
 * Guards the base 7-category keyword classifier AND the additive TD-726
 * refinements: the substrate-invariant / proxy-trap class now lands in
 * `gotcha` (was silently `insight`), and explicit steering markers land in
 * `preference`. Run: tsx src/lib/auto-derive.test.ts
 */

import { deriveCategory, deriveAll } from './auto-derive.js'

let passed = 0
let failed = 0

function assertCat(label: string, content: string, expected: string) {
  const actual = deriveCategory(content)
  if (actual === expected) {
    console.log(`  PASS  ${label}`)
    passed++
  } else {
    console.log(`  FAIL  ${label} (got '${actual}', expected '${expected}')`)
    failed++
  }
}

// ============================================================
// Base categories — regression guard (existing keywords unchanged)
// ============================================================
console.log('\n--- Base categories (regression guard) ---')
assertCat('gotcha: warning phrasing', 'Warning: this silently fails on cold start', 'gotcha')
assertCat('fix: root cause', 'Root cause found: the redirect dropped the POST body', 'fix')
assertCat('preference: base keyword', 'Sean prefers concise, direct responses', 'preference')
assertCat('pattern: approach', 'The parallel-subagent approach is the reusable technique here', 'pattern')
assertCat('convention: naming rule', 'Convention: script files use verb-noun naming', 'convention')
assertCat('question: unsolved', 'Open question, still unclear — needs more investigation', 'question')
assertCat('insight: generic learning', 'The book spans Fidelity, IBKR, and SoFi accounts', 'insight')

// ============================================================
// TD-726 — substrate-invariant / proxy-trap class -> gotcha
// (previously fell through to `insight`)
// ============================================================
console.log('\n--- TD-726: substrate-invariant / proxy-trap -> gotcha ---')
assertCat(
  'substrate-invariant instance',
  "substrate-invariant instance: spot-at-print is a proxy; the intra-quarter AVERAGE is the substrate",
  'gotcha',
)
assertCat(
  'proxy-trap phrasing',
  "proxy-trap — tier='HOLDING' is still not ownership, re-confirmed today",
  'gotcha',
)
assertCat(
  'never grade on the proxy',
  'The rule: never grade on the liveness proxy; verify against the substrate',
  'gotcha',
)
assertCat(
  'silent restore class',
  'The orphaned builder silently restored the staged git rm deletions under the live session',
  'gotcha',
)
assertCat('stale proxy', 'The computed_at column was a stale proxy for the reconcile', 'gotcha')

// ============================================================
// TD-726 — explicit steering markers -> preference
// ============================================================
console.log('\n--- TD-726: steering markers -> preference ---')
assertCat(
  'bracketed STEERING marker',
  '[STEERING — Sean, Granola] wants the vault reorganized around positions, not tickers',
  'preference',
)
assertCat('Sean steered', 'Sean steered the fleet toward Jiggy investing intelligence on 5/19', 'preference')
assertCat("Sean's taste", "This is a taste call — Sean's taste on brand voice governs", 'preference')
assertCat('Sean greenlit', 'Sean greenlit the Life-OS financial dimension on 7/04', 'preference')

// ============================================================
// Additive invariant — a plain fact must still be `insight`,
// and an explicit override must always win.
// ============================================================
console.log('\n--- Invariants ---')
assertCat('no false-positive: plain news fact', 'TSMC June revenue rose 6.2% month over month', 'insight')

function assertEq(label: string, actual: string, expected: string) {
  if (actual === expected) { console.log(`  PASS  ${label}`); passed++ }
  else { console.log(`  FAIL  ${label} (got '${actual}', expected '${expected}')`); failed++ }
}
assertEq(
  'deriveAll respects explicit category override',
  deriveAll('substrate-invariant instance …', { category: 'insight' }).category,
  'insight',
)
assertEq(
  'deriveAll derives gotcha when category omitted',
  deriveAll('substrate-invariant: the proxy is not the substrate').category,
  'gotcha',
)

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
