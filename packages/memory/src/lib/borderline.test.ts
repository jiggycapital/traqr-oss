/**
 * Borderline triage — the CORRECT verdict must survive validation (TD-1334)
 *
 * #1223 shipped a CORRECT action: it added the value to `BorderlineAction`, to
 * the response-schema enum, to the prompt, and it wrote the full `correct`
 * branch in `triageAndStore` (store new, archive + supersede the wrong one).
 * It did not add it to the runtime validator's allowlist, which read
 * `['add', 'update', 'noop']`. So from 2026-04-03 a valid CORRECT verdict was
 * treated as a MALFORMED RESPONSE and `borderlineDecision` returned null.
 *
 * null means "the LLM failed" — the caller falls back to a length heuristic
 * that cannot read the two texts against each other. A correction is a near
 * neighbour of its target by construction, so it lands in the borderline zone
 * every time; when the correction was the shorter text the fallback discarded
 * it and called `validateMemory` on the target, writing
 * `last_validated = NOW()` onto the claim that had just been disproved.
 *
 * The tests below pin, in order:
 *
 *  1. The regression itself — a well-formed CORRECT is a decision, not null.
 *  2. The INVARIANT that makes the class unrepresentable: every action the
 *     model is permitted to emit is an action the validator accepts, and every
 *     one is named in the prompt. This is the test that would have caught
 *     #1223 on the day it shipped; test 1 alone would not have been written.
 *  3. The safety rails on newly-reachable destructive behaviour: CORRECT
 *     archives its target, so it must never act on a guessed or unrecognised
 *     one.
 *  4. Backward compatibility for add / update / noop.
 *
 * Hermetic: pure function, no client, no network, no API key.
 *
 * Run: npx tsx packages/memory/src/lib/borderline.test.ts
 */

import {
  interpretBorderlineResponse,
  BORDERLINE_ACTIONS,
  RESPONSE_SCHEMA,
  buildPrompt,
} from './borderline.js'

let passed = 0
let failed = 0

function check(label: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  PASS  ${label}`)
    passed++
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
    failed++
  }
}

// ============================================================
console.log('\n--- 1. TD-1334 regression: CORRECT is a verdict, not a failure ---')

const corrected = interpretBorderlineResponse({
  action: 'correct',
  target: 'MEMORY_A',
  reasoning: 'The new memory disproves the stored claim.',
})

check(
  'a well-formed CORRECT does not return null',
  corrected !== null,
  'null routes the caller to the length heuristic — the TD-1334 bug',
)
check("CORRECT keeps its action", corrected?.action === 'correct', `got '${corrected?.action}'`)
check("CORRECT keeps its target", corrected?.target === 'MEMORY_A')
check(
  "CORRECT maps to the 'updates' edge (was null)",
  corrected?.edgeType === 'updates',
  `got '${corrected?.edgeType}'`,
)
check('CORRECT carries its reasoning through', (corrected?.reasoning || '').includes('disproves'))

// ============================================================
console.log('\n--- 2. Invariant: schema, validator and prompt cannot drift apart ---')

const schemaEnum: string[] = (RESPONSE_SCHEMA as any).json_schema.schema.properties.action.enum

check(
  'the response-schema enum is exactly BORDERLINE_ACTIONS',
  schemaEnum.length === BORDERLINE_ACTIONS.length &&
    BORDERLINE_ACTIONS.every((a) => schemaEnum.includes(a)),
  `schema=[${schemaEnum}] actions=[${BORDERLINE_ACTIONS}]`,
)

// The load-bearing one: anything the model may EMIT, the validator must ACCEPT.
for (const action of schemaEnum) {
  // 'update' and 'correct' act on a target, so give them a valid label.
  const target = action === 'update' || action === 'correct' ? 'MEMORY_A' : null
  const out = interpretBorderlineResponse({ action, target, reasoning: 'r' })
  check(
    `schema action '${action}' is accepted by the validator`,
    out !== null,
    'the model may emit it, so rejecting it is a silent fallback',
  )
}

const prompt = buildPrompt('new', [{ label: 'MEMORY_A', content: 'old' }], 'fact')
for (const action of BORDERLINE_ACTIONS) {
  check(
    `prompt documents '${action}' to the model`,
    prompt.includes(action.toUpperCase()),
  )
}

// ============================================================
console.log('\n--- 3. CORRECT archives — it must never act on a guess ---')

const noTarget = interpretBorderlineResponse({
  action: 'correct',
  target: null,
  reasoning: 'contradicts something',
})
check(
  'CORRECT without a target degrades to ADD, not null',
  noTarget?.action === 'add',
  `got '${noTarget?.action}'`,
)
check('the degraded ADD carries no target', noTarget?.target === undefined)
check("the degraded ADD uses the 'related' edge", noTarget?.edgeType === 'related')

check(
  'CORRECT with an unrecognised label is rejected',
  interpretBorderlineResponse({ action: 'correct', target: 'MEMORY_Z', reasoning: 'r' }) === null,
  'an unknown label would resolve to the nearest neighbour and archive it',
)

// ============================================================
console.log('\n--- 4. Backward compatibility (unchanged behaviour) ---')

const add = interpretBorderlineResponse({ action: 'add', target: null, reasoning: 'r' })
check('ADD survives', add?.action === 'add')
check("ADD uses the 'related' edge", add?.edgeType === 'related')

const upd = interpretBorderlineResponse({ action: 'update', target: 'MEMORY_B', reasoning: 'r' })
check('UPDATE survives', upd?.action === 'update')
check("UPDATE uses the 'updates' edge", upd?.edgeType === 'updates')
check(
  'UPDATE with an unrecognised label is still rejected',
  interpretBorderlineResponse({ action: 'update', target: 'NOPE', reasoning: 'r' }) === null,
)

const noop = interpretBorderlineResponse({ action: 'noop', target: null, reasoning: 'r' })
check('NOOP survives', noop?.action === 'noop')
check('NOOP has no edge', noop?.edgeType === null)

check(
  'an unknown action is still rejected',
  interpretBorderlineResponse({ action: 'delete', target: null, reasoning: 'r' }) === null,
)
check('a null response is rejected', interpretBorderlineResponse(null) === null)
check('a non-object response is rejected', interpretBorderlineResponse('add' as any) === null)
check(
  'a missing reasoning defaults to empty string',
  interpretBorderlineResponse({ action: 'add', target: null })?.reasoning === '',
)

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
