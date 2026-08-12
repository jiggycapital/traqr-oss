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
//
// TD-1144 moved registration from `server.tool(name, desc, rawShape, handler)` to
// `server.registerTool(name, { description, inputSchema }, handler)` so unknown
// argument keys are rejected instead of stripped. This fake mirrors the new API and
// unwraps `.shape` so the schema-seam assertions below keep reading a raw shape.
//
// The fake deliberately does NOT parse — it captures handlers for hermetic contract
// tests. Strictness itself is therefore UNTESTABLE here (a fake that never validates
// cannot show validation), which is exactly why it is pinned end-to-end through a real
// McpServer + client transport in tools.strict.test.ts instead.
const handlers = new Map<string, ToolHandler>()
const schemas = new Map<string, Record<string, z.ZodTypeAny>>()
const fakeServer = {
  registerTool(
    name: string,
    config: { description: string; inputSchema: z.ZodObject<z.ZodRawShape> },
    handler: ToolHandler,
  ) {
    handlers.set(name, handler)
    schemas.set(name, config.inputSchema.shape)
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

  // --- a FAILED search must not read as a search that found nothing ---
  // `throwingProvider` above has been exercising this exact path since the test was
  // written — the comment at the top of this block even names the `.catch(() => [])`
  // that absorbs it — but the assertions only checked that it didn't cry wolf, never
  // that the failure was reported. It wasn't: the empty array is indistinguishable
  // from a genuine zero-match search, and the renderer omits the whole `Search:`
  // block at length 0, so a failed search was SILENCE. Same class as the three
  // capture-side warnings this block already guards (TD-1069), on the one path that
  // never got the treatment; same inner-catch-shadowing shape as #3431.
  assert('a FAILED search is reported, not silently empty', text2.includes('search half of this pulse FAILED'))
  assert('…and says the captures are unaffected, so nothing is re-sent', text2.includes('do NOT re-send'))
  assert('…and distinguishes could-not-check from 0 matches', text2.includes('NOT "0 matches"'))
  assert('a failed search never claims a verified empty', !text2.includes('verified empty'))
}

// --- a SUCCESSFUL zero-match search says zero rather than vanishing (the mirror) ---
// Absent, empty and failed are three different substrates and a reader acts
// differently on each. Before this, a requested search that genuinely matched
// nothing rendered byte-identically to one that was never requested.
if (pulse) {
  const emptyProvider = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'search' || prop === 'searchMemories') return async () => []
      return async () => []
    },
  }) as unknown as Parameters<typeof setVectorDB>[0]
  setVectorDB(emptyProvider)
  const res3 = await pulse({ captures: [], search: 'nothing-will-match-this', searchLimit: 3 })
  resetVectorDB()
  const text3 = res3.content[0].text
  assert('a successful 0-hit search SAYS 0 results', text3.includes('Search: 0 results'))
  assert('…and labels it a verified empty', text3.includes('verified empty'))
  assert('…and does not claim a failure', !text3.includes('search half of this pulse FAILED'))
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

// --- memory_purge never reports a lossy export as a clean one (TD-887 finding 2) ---
// The same silent-loss class the memory_pulse blocks above guard, on the one tool
// where the loss is PERMANENT. `exportFirst: true` (the default) reads the namespace
// into an in-memory array, hard-deletes every row, then echoes the JSON into the
// response — truncated. Nothing writes that array to a file, bucket or table, so the
// response IS the only copy. The old output said "N memories captured" and sliced
// silently: at a median content length of 867 chars (12,729 rows, measured
// 2026-08-09) a serialized record runs ~1.4KB, so the echo held ~2 records whatever
// the namespace size, and an operator reading "captured" had no way to learn the
// rest was gone.
//
// Hermetic: a fake provider supplies exportNamespace/purgeNamespace, so no DB and
// nothing is actually deleted. Revert either the truncation notice or the
// NOT PERSISTED line in tools.ts and the assertions below flip to FAIL.
console.log('\n--- memory_purge lossy-export reporting (TD-887 finding 2) ---')

const purge = handlers.get('memory_purge')
assert('memory_purge tool is registered', typeof purge === 'function')

if (purge) {
  const makeRows = (n: number, contentChars: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `mem-${i}`,
      content: 'x'.repeat(contentChars),
      summary: `summary ${i}`,
      category: 'insight',
      tags: ['active'],
      domainName: 'traqr',
    }))

  const providerFor = (rows: unknown[]) => ({
    async exportNamespace() { return rows },
    async purgeNamespace() { return rows.length },
  }) as unknown as Parameters<typeof setVectorDB>[0]

  // Case 1: a realistic namespace — 20 records at ~900 chars of content each.
  // Far more than the 3000-char echo can hold, so the truncation MUST be named.
  setVectorDB(providerFor(makeRows(20, 900)))
  const lossy = (await purge({ namespace: 'client-a', exportFirst: true })).content[0].text
  resetVectorDB()

  assert('a truncated export is labelled TRUNCATED', lossy.includes('TRUNCATED'))
  assert('…and says how many records are UNRECOVERABLE', /\d+ are UNRECOVERABLE/.test(lossy))
  assert('…and states the export is NOT PERSISTED anywhere', lossy.includes('NOT PERSISTED'))
  assert('…and no longer claims the memories were "captured"', !lossy.includes('memories captured'))
  // The count must be honest in both terms, not a hardcoded string.
  assert('…and reports 20 memories read', lossy.includes('20 memories read'))

  // Case 2 (the mirror): an export small enough to fit whole must NOT cry wolf.
  // Without this, "always warn" would pass case 1 while being useless.
  setVectorDB(providerFor(makeRows(1, 20)))
  const whole = (await purge({ namespace: 'client-b', exportFirst: true })).content[0].text
  resetVectorDB()

  assert('a fully-echoed export is NOT labelled TRUNCATED', !whole.includes('TRUNCATED'))
  assert('…and claims nothing is unrecoverable', !whole.includes('UNRECOVERABLE'))
  // Still not persisted anywhere — that warning is about the sink, not the size.
  assert('…but still warns it is NOT PERSISTED (sink ≠ size)', whole.includes('NOT PERSISTED'))

  // Case 3: exportFirst:false is the documented "I persisted it myself" path.
  // It must not emit export prose it never produced.
  setVectorDB(providerFor(makeRows(20, 900)))
  const noExport = (await purge({ namespace: 'client-c', exportFirst: false })).content[0].text
  resetVectorDB()

  assert('exportFirst:false echoes no export block', !noExport.includes('Export data:'))
  assert('…and still confirms the deletion', noExport.includes('permanently deleted'))
}

console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('MEMORY-MCP TOOL CONTRACT TESTS FAILED')
  process.exit(1)
} else {
  console.log('All memory-mcp tool-contract tests passed!')
}
