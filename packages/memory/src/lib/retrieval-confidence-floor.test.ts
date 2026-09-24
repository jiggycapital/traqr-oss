/**
 * The confidence floor — a memory must be able to retrieve ITSELF.
 *
 * The bug this pins, in one sentence: `confidence` looks like a caveat and
 * behaves like a delete.
 *
 * `search_memories` orders by `relevance_score = similarity * current_confidence
 * * citationBoost`, never by similarity. For a fresh row `current_confidence` IS
 * `original_confidence`. So confidence is a flat, unbounded multiplier on rank —
 * and an agent that honestly marks uncertain content as low-confidence does not
 * caveat that memory, it removes it from search.
 *
 * Measured 2026-09-14 against the live corpus (11,654 candidates) by querying
 * rows with their OWN embedding — similarity 1.0000, rank 1 of 11,654 on
 * similarity alone. Rank by relevance_score:
 *
 *     0.50 -> 340, 477      0.70 -> 1
 *     0.60 -> 109           0.85 -> 1     0.90 -> 1     1.00 -> 1
 *
 * The candidate pool is `limit * 2`, capped at EXACT_ID_RECALL_POOL = 100. So a
 * row written at 0.60 — which was `memory_store`'s own DEFAULT — sat at rank 109,
 * outside the deepest pool the system can request. It was unreachable on its own
 * verbatim text, at any limit, forever, silently.
 *
 * Found via JGC-922: 10 Muse rows harvested into TraqrDB were healthy in every
 * field and returned from zero probes. They were written at 0.5 — a deliberate
 * and CORRECT trust annotation for an unattended web-only source, expressed in
 * the one field that is not a trust annotation. Re-scored at 0.7 they move from
 * rank 105-340 to rank 1-2.
 *
 * Hermetic: pure arithmetic + source parsing. No DB, no network.
 *
 * Run: npx tsx packages/memory/src/lib/retrieval-confidence-floor.test.ts
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { RETRIEVAL_CONFIDENCE_FLOOR, EXACT_ID_RECALL_POOL } from './retrieval.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../../..')

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

/** The production ranking formula, verbatim from the search_memories RPC body. */
function relevance(similarity: number, confidence: number, timesCited = 0): number {
  return similarity * confidence * (1 + Math.log(1 + timesCited) * 0.1)
}

// A strong semantic neighbour drawn from the measured corpus: the established
// band is 0.85-0.95 confidence, and a close neighbour sits at similarity ~0.75.
// Against the Muse rows the top competitor scored 0.7898 and 12th place 0.6165.
const COMPETITOR = relevance(0.75, 0.9)

// A perfect self-match: the query IS the memory's own text.
const selfMatch = (confidence: number) => relevance(1.0, confidence)

console.log('\nretrieval confidence floor\n')

assert(
  'the floor is at or above the measured cliff (0.60 ranked 109th; 0.70 ranked 1st)',
  RETRIEVAL_CONFIDENCE_FLOOR >= 0.7,
)

assert(
  'a memory written AT the floor outranks a strong neighbour on its own text',
  selfMatch(RETRIEVAL_CONFIDENCE_FLOOR) > COMPETITOR,
)

// The regression pin. This is the assertion that proves the one above is not
// vacuous: the SAME check applied to the previous default fails. If someone
// lowers the default back to 0.6, the test above starts failing for real.
assert(
  'the OLD default (0.6) FAILS to retrieve itself — the bug this floor fixes',
  selfMatch(0.6) < COMPETITOR,
)

assert(
  'rank 109 (the 0.6 self-rank) is outside the deepest requestable pool',
  109 > EXACT_ID_RECALL_POOL,
)

// --- the shipped defaults must not drift back below the floor ------------------

const toolsSrc = readFileSync(resolve(REPO, 'packages/memory-mcp/src/tools.ts'), 'utf8')

const literalDefaults = [...toolsSrc.matchAll(/confidence:[^\n]*?\.default\((0\.\d+)\)/g)]
  .map((m) => Number(m[1]))
assert(
  `no memory-MCP tool hardcodes a default below the floor (found: ${JSON.stringify(literalDefaults)})`,
  literalDefaults.every((d) => d >= RETRIEVAL_CONFIDENCE_FLOOR),
)

const fallbackMatch = toolsSrc.match(/confidence:\s*\w+\.confidence\s*\?\?\s*([\w.]+)/)
assert(
  `the memory_pulse capture fallback is the floor CONSTANT, not a literal (found: ${
    fallbackMatch ? fallbackMatch[1] : 'NO FALLBACK MATCHED — check is blind'})`,
  fallbackMatch !== null && fallbackMatch[1] === 'RETRIEVAL_CONFIDENCE_FLOOR',
)

// --- writers must not re-express "low trust" as low confidence ----------------

const museSrc = readFileSync(resolve(REPO, 'scripts/jiggy/muse-harvest.ts'), 'utf8')
const museLiteral = museSrc.match(/confidence:\s*(0\.\d+)/)
assert(
  'muse-harvest does not hardcode a sub-floor confidence (the caveat lives in the content)',
  museLiteral === null,
)
// The trust signal must survive the confidence raise. It cannot survive in
// `sourceReliability` — that field is accepted by the tool schema and by
// MemoryInput but reaches no column (TD-1456), so it is silently dropped. The
// only durable home is the embedded CONTENT.
assert(
  'muse-harvest puts the SOURCE-NEVER-SUBSTRATE caveat in the embedded content',
  /SOURCE, NEVER SUBSTRATE/.test(museSrc),
)
// ⚠️ This binds to the WRITE PATH, not to a builder's NAME, and that is deliberate.
// The prior form asserted `indexOf('SOURCE, NEVER SUBSTRATE') > indexOf('export function
// buildMemoryContent')` — raw source POSITION. It broke the moment muse-harvest hoisted the
// caveat into a constant above that function (2026-09-22, per-section chunking), and worse, it
// had been grading `buildMemoryContent` for a while — a builder the storeMemory call no longer
// calls. A green assertion about a function nothing invokes is the failure this rewrite prevents.
const writeBuilder = museSrc.match(/content:\s*(\w+)\(/)
assert(
  `the storeMemory call names a content builder (found: ${writeBuilder ? writeBuilder[1] : 'NONE — check is blind'})`,
  writeBuilder !== null,
)
// ⚠️ Scoped to the FUNCTION BODY and stripped of comments, and both halves are load-bearing.
// A slice that ran to END OF FILE passed both mutations below, because a COMMENT 6KB further
// down ("the load-bearing caveat is the SOURCE, NEVER SUBSTRATE header that buildChunkContent
// puts in every row") contains the phrase. The check was matching the code's own documentation
// — green, and blind. A comment NAMING the caveat is not the caveat.
const builderStart = writeBuilder
  ? museSrc.indexOf(`export function ${writeBuilder[1]}(`)
  : -1
const fnBody =
  builderStart >= 0
    ? museSrc
        .slice(builderStart, museSrc.indexOf('\n}', builderStart))
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
    : ''
const caveatConst = museSrc.match(/export const (\w*CAVEAT\w*)\s*=/)
const caveatConstCarriesIt =
  caveatConst !== null &&
  new RegExp(
    `export const ${caveatConst[1]}[\\s\\S]{0,800}?SOURCE, NEVER SUBSTRATE`,
  ).test(museSrc)
assert(
  'that caveat is built into every row, not a doc-only note — the builder the write path ' +
    'actually calls emits it (inline, or via an exported caveat constant that carries it)',
  /SOURCE, NEVER SUBSTRATE/.test(fnBody) ||
    (caveatConstCarriesIt && fnBody.includes(caveatConst![1])),
)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
