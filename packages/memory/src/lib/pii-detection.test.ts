/**
 * PII redaction for embeddings (TD-856).
 *
 * Pins the redaction contract wired into `generateEmbedding`: the four
 * high-sensitivity, never-searched-by-value types (credit card, SSN, phone,
 * email) are replaced with placeholders before reaching the embedding
 * provider; `financialAmount` + `address` are deliberately left RAW (they are
 * search-load-bearing for jiggy / life-CRM); and the
 * `MEMORY_REDACT_EMBEDDINGS` flag (default ON) is the kill-switch.
 *
 * Pure/deterministic — no live embedding provider or DB. Matches the
 * tsx-script convention of context.test.ts / retrieval.test.ts.
 *
 * Run: npx tsx packages/memory/src/lib/pii-detection.test.ts
 */

import { redactForEmbedding, detectPii, __resetKeywordCache } from './pii-detection.js'
import { redactEmbeddingInput } from './embeddings.js'

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

console.log('\n--- redactForEmbedding: high-sensitivity types redacted (TD-856) ---')

assert('email → [EMAIL]',
  redactForEmbedding('reach me at john.doe@example.com today') === 'reach me at [EMAIL] today')
assert('credit card → [CREDIT_CARD]',
  redactForEmbedding('card 4111 1111 1111 1111 declined').includes('[CREDIT_CARD]'))
assert('ssn → [SSN]',
  redactForEmbedding('ssn 123-45-6789 on file').includes('[SSN]'))
assert('phone → [PHONE]',
  redactForEmbedding('call (555) 123-4567 now').includes('[PHONE]'))

console.log('\n--- redactForEmbedding: search-load-bearing types stay RAW ---')

assert('financial amount preserved',
  redactForEmbedding('bought AVGO at $1,400.00') === 'bought AVGO at $1,400.00')
assert('address preserved',
  redactForEmbedding('lives at 123 Main Street') === 'lives at 123 Main Street')

console.log('\n--- redactForEmbedding: non-PII untouched + idempotent ---')

const clean = 'NVDA estimate revisions trending up, 34 up / 3 down'
assert('clean text untouched', redactForEmbedding(clean) === clean)
const once = redactForEmbedding('email a@b.co and a@b.co')
assert('all occurrences replaced', !once.includes('@'))
assert('idempotent', redactForEmbedding(once) === once)

console.log('\n--- redactEmbeddingInput: MEMORY_REDACT_EMBEDDINGS flag (default ON) ---')

delete process.env.MEMORY_REDACT_EMBEDDINGS
assert('default (unset) redacts', redactEmbeddingInput('mail x@y.com') === 'mail [EMAIL]')
process.env.MEMORY_REDACT_EMBEDDINGS = 'false'
assert('flag=false passes through raw', redactEmbeddingInput('mail x@y.com') === 'mail x@y.com')
process.env.MEMORY_REDACT_EMBEDDINGS = '0'
assert('flag=0 passes through raw', redactEmbeddingInput('mail x@y.com') === 'mail x@y.com')
process.env.MEMORY_REDACT_EMBEDDINGS = 'true'
assert('flag=true redacts', redactEmbeddingInput('mail x@y.com') === 'mail [EMAIL]')
delete process.env.MEMORY_REDACT_EMBEDDINGS

console.log('\n--- private classification vocabulary lives in env, not the repo (TD-1105) ---')

// The point of moving private terms into env is that classification must keep
// working. A test that only checked the terms were GONE would pass on the
// broken fix — the one where a private topic silently stops being flagged
// `restricted`, which is less private than where we started.
//
// The fixtures below are deliberately SYNTHETIC. This test file ships to the
// same public mirror as the source, so using the operator's real vocabulary
// here would republish exactly what the change removes — the leak would just
// move from an array to a fixture. What is under test is the merge mechanism,
// and a made-up word exercises it identically.
delete process.env.MEMORY_RESTRICTED_KEYWORDS
delete process.env.MEMORY_CONFIDENTIAL_KEYWORDS
__resetKeywordCache()

assert('generic health terms stay built in',
  detectPii('notes from therapy this week').suggestedClassification === 'restricted')
assert('generic secrets stay built in',
  detectPii('the private key is rotated').suggestedClassification === 'restricted')
assert('a private term is NOT hardcoded — unset env means unflagged',
  detectPii('a note about quorlybet').suggestedClassification !== 'restricted')

process.env.MEMORY_RESTRICTED_KEYWORDS = 'quorlybet,vantrex episode'
process.env.MEMORY_CONFIDENTIAL_KEYWORDS = 'plimsoll deck,zarn tier'
__resetKeywordCache()

assert('env-supplied restricted term classifies',
  detectPii('a note about quorlybet').suggestedClassification === 'restricted')
assert('env-supplied multi-word term classifies',
  detectPii('re: the vantrex episode').suggestedClassification === 'restricted')
assert('env-supplied confidential term classifies',
  detectPii('the plimsoll deck for Q3').suggestedClassification === 'confidential')
assert('built-ins still fire alongside env terms',
  detectPii('notes from therapy this week').suggestedClassification === 'restricted')
assert('unrelated content stays internal',
  detectPii('the weather was pleasant').suggestedClassification === 'internal')

process.env.MEMORY_RESTRICTED_KEYWORDS = '  Quorlybet , , vantrex episode  '
__resetKeywordCache()
assert('env parsing trims, lowercases and drops empties',
  detectPii('A NOTE ABOUT QUORLYBET').suggestedClassification === 'restricted')

delete process.env.MEMORY_RESTRICTED_KEYWORDS
delete process.env.MEMORY_CONFIDENTIAL_KEYWORDS
__resetKeywordCache()

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
