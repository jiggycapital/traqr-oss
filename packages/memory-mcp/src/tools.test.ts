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
import { registerTools, formatPulseHeadline, formatPulseIds } from './tools.js'
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

// --- memory_correct / memory_enhance domain inheritance (TD-1221) ---
//
// deriveDomain is an ordered first-match-wins cascade whose rule #1 is /\bsean\b/,
// so ANY content naming Sean domains as `sean` before `jiggy` is ever tested.
// Correction prose almost always names who said what — which is why corrections
// flipped domain. Measured in-corpus: mcp-correct was a perfect bijection (all 52
// rows tripping rule #1 landed in `sean`; all 25 not tripping it landed elsewhere),
// while mcp-store tripped the same rule 1,217 times and landed 82% elsewhere —
// because its callers can pass `domain`. The missing PARAMETER was the whole defect.
//
// Hermetic: a fake provider returns a jiggy-domained target from getById and captures
// what store() receives. Every other db method the handler touches (archive/supersede/
// relationship) is a no-op via the Proxy fallback, so no DB is needed.
console.log('\n--- memory_correct/enhance domain inheritance (TD-1221) ---')

{
  // Content that trips deriveDomain rule #1 — this is the whole point: it MUST NOT
  // win over the inherited domain.
  const seanFlavoured = 'Correcting this: Sean said the IESC read was wrong, and I would prefer the mid-cycle multiple.'

  // Read through a cast: `stored` is only ever assigned inside the fake's async
  // store(), which TS cannot see, so it narrows the variable to `never` at the
  // assertion sites. The cast is about control-flow visibility, not type safety.
  let stored: Record<string, unknown> | undefined
  const got = () => stored as Record<string, unknown> | undefined
  const target = { id: 'w1', summary: 'old IESC read', domain: 'jiggy', topic: 'iesc', tags: [] }
  const inheritProvider = new Proxy({} as Record<string, unknown>, {
    get(_t, prop: string) {
      if (prop === 'getById') return async () => target
      if (prop === 'store') return async (input: Record<string, unknown>) => { stored = input; return { ...input, id: 'new1' } }
      // archiveMemory / supersedeMemory / createRelationship and anything else the
      // handler reaches for — succeed silently; none of them affect the assertion.
      return async () => ({})
    },
  }) as unknown as Parameters<typeof setVectorDB>[0]

  if (correct) {
    // Case 1: no override → inherit the superseded memory's domain/topic, NOT the
    // domain the corrected prose derives to. This is the regression guard: revert the
    // fix and `sean` wins here.
    setVectorDB(inheritProvider); stored = undefined
    const r1 = await correct({ wrongMemoryId: 'w1', correctedContent: seanFlavoured, reason: 'was wrong', confidence: 0.9 })
    resetVectorDB()
    assert('correct: inherits domain from the superseded memory (not re-derived to sean)', got()?.domain === 'jiggy')
    assert('correct: inherits topic from the superseded memory', got()?.topic === 'iesc')
    assert('correct: echoes the domain it actually stored (acceptance #3)', r1.content[0].text.includes('Domain: jiggy'))
    assert('correct: echo names the provenance of that domain', r1.content[0].text.includes('inherited from the corrected memory'))

    // Case 2: explicit override beats BOTH the inherited and the derived value.
    setVectorDB(inheritProvider); stored = undefined
    const r2 = await correct({ wrongMemoryId: 'w1', correctedContent: seanFlavoured, reason: 'r', confidence: 0.9, domain: 'traqr', topic: 'pinned-topic' })
    resetVectorDB()
    assert('correct: explicit domain override wins over the inherited value', got()?.domain === 'traqr')
    assert('correct: explicit topic override wins over the inherited value', got()?.topic === 'pinned-topic')
    assert('correct: echo reports the override as explicit', r2.content[0].text.includes('explicit override'))

    // Case 3: superseded memory carries no domain → fall through to derivation,
    // i.e. byte-identical to the pre-fix behaviour. Guards against over-correcting.
    setVectorDB(new Proxy({} as Record<string, unknown>, {
      get(_t, prop: string) {
        if (prop === 'getById') return async () => ({ id: 'w2', summary: 'no domain', tags: [] })
        if (prop === 'store') return async (input: Record<string, unknown>) => { stored = input; return { ...input, id: 'new2' } }
        return async () => ({})
      },
    }) as unknown as Parameters<typeof setVectorDB>[0])
    stored = undefined
    await correct({ wrongMemoryId: 'w2', correctedContent: seanFlavoured, reason: 'r', confidence: 0.9 })
    resetVectorDB()
    assert('correct: no inheritable domain → still derives (pre-fix behaviour preserved)', got()?.domain === 'sean')
  }

  // Schema seam — the defect WAS the absent parameter, so pin its presence directly.
  const correctShape = schemas.get('memory_correct')
  assert('memory_correct exposes a domain override', correctShape?.domain !== undefined)
  assert('memory_correct exposes a topic override', correctShape?.topic !== undefined)

  const enhanceShape = schemas.get('memory_enhance')
  assert('memory_enhance exposes a domain override (had none at all)', enhanceShape?.domain !== undefined)
  assert('memory_enhance exposes a topic override', enhanceShape?.topic !== undefined)
  assert('memory_enhance exposes a category override', enhanceShape?.category !== undefined)
  assert('memory_enhance exposes a tags override', enhanceShape?.tags !== undefined)
}

// --- memory_pulse headline reports the WRITE OUTCOME, not the triage band (TD-1334 a) ---
// The old headline was arithmetically correct and misread five times, always in the same
// direction: readers concluded FEWER rows were written than actually were. The canonical
// instance is three fresh inserts rendering as `Captured 3, merged 1 | Zones: 0 noop,
// 0 new, 3 borderline` — where `merged 1` means "stored AND retired an older row" and
// `0 new` is the band `add`, not the row count.
//
// Hermetic by construction: formatPulseHeadline is pure over TriageResult shapes.
console.log('\n--- memory_pulse headline vocabulary (TD-1334 half a) ---')
{
  // The exact live shape from 2026-09-02, the fifth instance.
  const threeBorderlineOneSuperseding = formatPulseHeadline([
    { zone: 'borderline', deduplicated: false, merged: false },
    { zone: 'borderline', deduplicated: false, merged: true },
    { zone: 'borderline', deduplicated: false, merged: false },
  ])
  assert(
    'three borderline inserts report THREE rows stored, not zero',
    threeBorderlineOneSuperseding.includes('Stored 3 new row(s)'),
  )
  assert(
    'a superseding capture says the text WAS stored (the word "merged" said the opposite)',
    threeBorderlineOneSuperseding.includes('ALSO retired an older memory') &&
      threeBorderlineOneSuperseding.includes('WAS stored, not absorbed'),
  )
  assert(
    'the band histogram is labelled as classification, not as rows written',
    threeBorderlineOneSuperseding.includes('CLASSIFIED, not whether it stored'),
  )
  // The regression that matters: re-introducing the band as the headline count.
  //
  // ⚠️ This assertion was itself vacuous on its first draft — it tested
  // `split('\n')[1]`, and the old headline is a SINGLE line, so the mutation run
  // scored it green against `undefined ?? ''`. Caught by mutating the source rather
  // than by reading the test. Scan the WHOLE string, and let "N new row(s)" through
  // while rejecting the band form "N new,".
  assert(
    'never renders a band count under the word "new" (the misread that cost 5 instances)',
    !/\d+ new(?! row)/.test(threeBorderlineOneSuperseding),
  )

  // A genuine dedup — the ONE outcome where the caller's text was not written.
  const twoDeduped = formatPulseHeadline([
    { zone: 'noop', deduplicated: true, merged: false },
    { zone: 'noop', deduplicated: true, merged: false },
  ])
  assert('an all-dedup batch reports 0 stored', twoDeduped.includes('Stored 0 new row(s)'))
  assert('an all-dedup batch names the not-stored count', twoDeduped.includes('2 NOT stored'))
  assert(
    'a batch with nothing superseded does not claim a supersede',
    !twoDeduped.includes('ALSO retired'),
  )

  // A plain add batch: no noise about outcomes that did not occur.
  const twoPlainAdds = formatPulseHeadline([
    { zone: 'add', deduplicated: false, merged: false },
    { zone: 'add', deduplicated: false, merged: false },
  ])
  assert('a clean add batch reports both rows', twoPlainAdds.includes('Stored 2 new row(s)'))
  assert('a clean add batch mentions no dedup', !twoPlainAdds.includes('NOT stored'))
}

console.log('\n--- memory_pulse IDs line names the row a supersede retired (TD-1334) ---')
{
  // The 2026-09-23 shape: a follow-up superseded the fuller record and the line named only the new row.
  const line = formatPulseIds([
    { index: 0, zone: 'borderline', merged: true, existingId: 'f41e8b56-old', memory: { id: '862f6c0c-new' } },
    { index: 1, zone: 'add', merged: false, memory: { id: 'aaaa-plain' } },
    { index: 2, zone: 'borderline', merged: false, existingId: 'bbbb-neighbour', memory: { id: 'cccc-related' } },
  ])
  assert('a supersede names the retired row', !!line && line.includes('#1=862f6c0c-new (borderline) retired f41e8b56-old'))
  assert('a plain add names no retired row', !!line && line.includes('#2=aaaa-plain (add)') && !line.includes('aaaa-plain (add) retired'))
  assert(
    'a related insert (existingId set, nothing retired) does not claim a retirement',
    !!line && !line.includes('bbbb-neighbour'),
  )
  assert('no stored ids renders no line', formatPulseIds([{ index: 0, zone: 'noop' }]) === null)
}

console.log('\n--- memory_browse counts the CORPUS, not browse()\'s page ---')

// The defect: the no-facet branch tallied the rows browse() returned. browse() is
// capped at 20 by contract, so the "domain counts" were a histogram of the 20
// NEWEST memories — jiggy read 6 against 5,868 real ones, and any domain absent
// from that window (sean: 2,060; tooling: 816) reported as not existing at all.
//
// The fake pins the two apart on purpose: browse() hands back a 20-row page whose
// mix does NOT match the corpus, and browseDomainCounts() returns the true totals.
// Any implementation that counts the page cannot pass.
const TRUE_COUNTS = { jiggy: 5868, traqr: 4643, sean: 2060, tooling: 816 }
const pageRows = [
  ...Array.from({ length: 14 }, (_, i) => ({ id: `j${i}`, domain: 'jiggy', content: 'c' })),
  ...Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, domain: 'traqr', content: 'c' })),
] // 20 rows, and neither sean nor tooling appears in it

const browseCalls: string[] = []
let countsOpts: unknown = 'UNSET'
const browseProvider = {
  async browse(opts?: { domain?: string }) {
    browseCalls.push(opts?.domain ?? '(no facet)')
    return pageRows
  },
  async browseDomainCounts(opts?: unknown) {
    countsOpts = opts
    return TRUE_COUNTS
  },
} as unknown as Parameters<typeof setVectorDB>[0]

const browseTool = handlers.get('memory_browse')
assert('memory_browse tool is registered', typeof browseTool === 'function')

if (browseTool) {
  // Case 1: no facet → the corpus aggregate, never the page tally.
  setVectorDB(browseProvider)
  browseCalls.length = 0
  countsOpts = 'UNSET'
  const res = await browseTool({})
  resetVectorDB()
  const domains = JSON.parse(res.content[0].text).domains as Record<string, number>

  assert('jiggy reports the corpus total (5868), not the page count (14)', domains.jiggy === 5868)
  assert('a domain absent from the newest page still appears (sean)', domains.sean === 2060)
  assert('...and tooling too — absence from a page is not absence from the corpus', domains.tooling === 816)
  assert('no-facet browse does NOT read a page at all (the regression)', browseCalls.length === 0)
  assert('counts sum to the corpus, not to browse()\'s 20-row cap',
    Object.values(domains).reduce((a, b) => a + b, 0) === 13387)

  // Case 2: the classification ceiling must reach the aggregate. Filtering rows
  // after a GROUP BY is impossible, so a dropped ceiling here would silently count
  // over-tier memories into a number an exploration-tier caller can read.
  setVectorDB(browseProvider)
  countsOpts = 'UNSET'
  await browseTool({ accessLevel: 'exploration' })
  resetVectorDB()
  assert('accessLevel forwarded to browseDomainCounts (ceiling reaches the aggregate)',
    (countsOpts as { accessLevel?: string } | undefined)?.accessLevel === 'exploration')

  // Case 3: the faceted path is unchanged — it still reads rows.
  setVectorDB(browseProvider)
  browseCalls.length = 0
  const faceted = await browseTool({ domain: 'jiggy' })
  resetVectorDB()
  assert('a faceted browse still pages rows', browseCalls.length === 1 && browseCalls[0] === 'jiggy')
  assert('a faceted browse returns summaries, not counts', Array.isArray(JSON.parse(faceted.content[0].text)))
}

console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('MEMORY-MCP TOOL CONTRACT TESTS FAILED')
  process.exit(1)
} else {
  console.log('All memory-mcp tool-contract tests passed!')
}
