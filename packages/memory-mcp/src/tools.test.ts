/**
 * memory_correct accessLevel-forwarding contract (TD-887).
 *
 * The fix threads the caller's accessLevel into the getMemory() read of the
 * memory being corrected, so an over-tier target redacts as not-found (getById,
 * TD-883) and its summary is never echoed back. The SECURITY OUTCOME is a
 * composition of two halves, each tested where it lives:
 *   1. getById(over-tier) → null            — TD-883 (classification-ceiling.test.ts)
 *   2. memory_correct forwards accessLevel   — THIS test
 * So this guard pins (2): the exact wiring the fix adds. It mirrors the CONTRACT
 * half of TD-885's integration test — assert the arg is passed through, via a
 * fake, with no DB. Revert the wiring (getMemory(id) with no opts) and the
 * "accessLevel forwarded" assertion flips to FAIL.
 *
 * Hermetic: EMBEDDING_PROVIDER=none + a fake provider whose getById records the
 * opts it receives and returns null, short-circuiting memory_correct to its
 * not-found branch (no store/archive path, no DB). Uses the setVectorDB seam
 * (TD-885) now re-exported from @traqr/memory.
 *
 * Run: npx tsx packages/memory-mcp/src/tools.test.ts
 */

process.env.EMBEDDING_PROVIDER = 'none'

import { z } from 'zod'
import { registerTools } from './tools.js'
import { setVectorDB, resetVectorDB } from '@traqr/memory'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

let passed = 0
let failed = 0
function assert(label: string, cond: boolean) {
  if (cond) {
    console.log(`  PASS  ${label}`)
    passed++
  } else {
    console.log(`  FAIL  ${label}`)
    failed++
  }
}

type ToolResult = { content: { text: string }[] }
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>

// Capture the tool handlers registerTools() wires onto the server.
const handlers = new Map<string, ToolHandler>()
const schemas = new Map<string, Record<string, z.ZodTypeAny>>()
const fakeServer = {
  tool(name: string, _desc: string, schema: Record<string, z.ZodTypeAny>, handler: ToolHandler) {
    handlers.set(name, handler)
    schemas.set(name, schema)
  },
} as unknown as McpServer
registerTools(fakeServer)

// --- Registered-tool count matches the documented "12 tools" (TD-977 F10) ---
// index.ts, tools.ts, and package.json all advertise a tool count in prose; this
// pins it to what registerTools() actually wires so a doc-vs-code drift (the docs
// said "10"/"11" while 12 were registered) fails here instead of silently.
console.log('\n--- registered tool count (TD-977 F10) ---')
assert('exactly 12 memory tools are registered', handlers.size === 12)

// Fake provider: record the opts getById receives, then return null so
// memory_correct short-circuits to "not found" (never touches store/archive/DB).
let lastGetByIdOpts: unknown = 'UNSET'
const fakeProvider = {
  async getById(_id: string, opts?: unknown) {
    lastGetByIdOpts = opts
    return null
  },
} as unknown as Parameters<typeof setVectorDB>[0]

console.log('\n--- memory_correct accessLevel-forwarding contract (TD-887) ---')

const correct = handlers.get('memory_correct')
assert('memory_correct tool is registered', typeof correct === 'function')

if (correct) {
  // Case 1: caller passes accessLevel → it must reach getById verbatim.
  setVectorDB(fakeProvider)
  lastGetByIdOpts = 'UNSET'
  const res1 = await correct({
    wrongMemoryId: 'r1',
    correctedContent: 'x',
    reason: 'y',
    confidence: 0.9,
    accessLevel: 'exploration',
  })
  resetVectorDB()
  const opts1 = lastGetByIdOpts as { accessLevel?: string } | undefined
  assert('accessLevel forwarded to getById (the wiring this PR adds)', opts1?.accessLevel === 'exploration')
  assert('over-tier target → not-found (read redacted before any mutation)', res1.content[0].text.includes('not found'))

  // Case 2: no accessLevel → fail-safe pass-through (getById gets undefined = no ceiling).
  setVectorDB(fakeProvider)
  lastGetByIdOpts = 'UNSET'
  await correct({ wrongMemoryId: 'r1', correctedContent: 'x', reason: 'y', confidence: 0.9 })
  resetVectorDB()
  assert('no accessLevel → getById receives undefined (byte-identical fail-safe)', lastGetByIdOpts === undefined)
}

// --- memory_pulse empty-captures is never success-shaped (TD-1069) ---
// PR #1689 surfaced the silent capture-failure paths (errored / deduplicated /
// dropped / tooShort), but left one: when the captures array itself arrives empty,
// every one of those counters reads 0 and the summary line is byte-identical to a
// genuine all-noop batch. An agent reads "Captured 0, merged 0 | Zones: 0 noop,
// 0 new, 0 borderline" as success and moves on having lost the whole batch
// (observed 2026-07-27: a 4-memory batch vanished this way; the same items stored
// fine one-at-a-time via memory_store seconds later).
//
// Hermetic: captures:[] means Promise.all runs over an empty array — no triage, no
// DB. The search-only case injects a fake provider that throws on any method, which
// the handler's `.catch(() => [])` absorbs, so no live DB is needed there either.
console.log('\n--- memory_pulse empty-captures warning (TD-1069) ---')

const pulse = handlers.get('memory_pulse')
assert('memory_pulse tool is registered', typeof pulse === 'function')

if (pulse) {
  // Case 1: no captures AND no search → this call stored nothing. Must say so.
  const res1 = await pulse({ captures: [], searchLimit: 3 })
  const text1 = res1.content[0].text
  assert('0 captures + no search → WARNING that nothing was stored', text1.includes('WARNING: 0 captures received'))
  assert('0 captures + no search → tells the caller how to recover', text1.includes('memory_store'))

  // Case 2: no captures BUT a search was requested → legitimate search-only pulse,
  // so it must NOT cry wolf with the data-loss WARNING.
  const throwingProvider = new Proxy({}, {
    get() { return () => { throw new Error('no DB in test') } },
  }) as unknown as Parameters<typeof setVectorDB>[0]
  setVectorDB(throwingProvider)
  const res2 = await pulse({ captures: [], search: 'anything', searchLimit: 3 })
  resetVectorDB()
  const text2 = res2.content[0].text
  assert('0 captures + search → no false data-loss WARNING', !text2.includes('WARNING: 0 captures received'))
  assert('0 captures + search → labelled a search-only pulse', text2.includes('search-only pulse'))
}

// --- memory_pulse preserves per-item provenance/security fields (TD-1069) ---
// memory_store threads confidence / sourceReliability / classification into the
// stored row. memory_pulse — the DOCUMENTED batch path for the same captures —
// did not declare them, and zod STRIPS unknown keys instead of rejecting. So a
// caller that sent them got success-shaped output with the values silently gone:
// every pulsed memory pinned at confidence 0.6, classification auto-derived, and
// sourceReliability unset. A `restricted` capture batched via pulse was stored at
// whatever auto-derivation picked — a silent SECURITY-TIER downgrade, not just a
// lost hint. Same class as the empty-batch drop above: silent loss, no error.
//
// Tested at the SCHEMA seam, not through the handler: threading the values into
// MemoryInput requires triageAndStore, which needs a DB. What actually broke here
// was zod dropping the keys before the handler ever saw them, so parsing the
// declared shape pins the real defect. Revert the tools.ts schema addition and the
// three "survives" assertions flip to FAIL (verified non-vacuous).
console.log('\n--- memory_pulse per-item provenance fields (TD-1069) ---')
{
  const pulseShape = schemas.get('memory_pulse')
  assert('memory_pulse schema was captured', !!pulseShape)

  const parsed = z.object(pulseShape!).parse({
    captures: [{
      content: 'A capture long enough to clear the 20-char minimum for storage.',
      confidence: 0.95,
      sourceReliability: 'direct-user',
      classification: 'restricted',
    }],
  })
  const cap = (parsed.captures as Record<string, unknown>[])[0]

  assert('confidence survives the schema (was stripped → forced to 0.6)', cap.confidence === 0.95)
  assert('sourceReliability survives the schema (was stripped → unset)', cap.sourceReliability === 'direct-user')
  assert('classification survives the schema (was stripped → auto-derived)', cap.classification === 'restricted')

  // Omitting them stays legal — the fields are optional, and the handler falls
  // back to 0.6 / auto-derived. This pins that the fix is additive.
  const bare = z.object(pulseShape!).parse({
    captures: [{ content: 'Another capture that clears the 20-char minimum fine.' }],
  })
  const bareCap = (bare.captures as Record<string, unknown>[])[0]
  assert('the three fields stay OPTIONAL — a bare capture still parses', bareCap.confidence === undefined)

  // The enums are closed: a bogus tier must REJECT loudly, not silently coerce.
  const bogus = z.object(pulseShape!).safeParse({
    captures: [{ content: 'A capture that clears the 20-char minimum easily.', classification: 'top-secret' }],
  })
  assert('an out-of-enum classification is REJECTED, not silently dropped', !bogus.success)
}

console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('MEMORY-MCP TOOL CONTRACT TESTS FAILED')
  process.exit(1)
} else {
  console.log('All memory-mcp tool-contract tests passed!')
}
