/**
 * TD-1144 — unknown argument keys must be REJECTED, not silently stripped.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM tools.test.ts
 *
 * tools.test.ts captures handlers through a fake server and invokes them directly.
 * That is the right shape for handler-contract tests, but it means the fake NEVER
 * PARSES ANYTHING — so the property under test here (does the argument schema reject
 * an unrecognized key?) is structurally invisible to it. A guard that runs beside the
 * validation layer instead of through it cannot see this bug: it is the same
 * merge≠live / built≠loaded shape the ticket itself is about, one layer down.
 *
 * So this suite drives a REAL `McpServer` through a REAL client transport — the same
 * `getZodSchemaObject` → `normalizeObjectSchema` → `safeParseAsync` path a live
 * `memory_pulse` call takes.
 *
 * NON-VACUITY IS BUILT IN. A control tool is registered on the same server with the
 * OLD `server.tool(name, desc, rawShape, handler)` API and asserted to ACCEPT the very
 * key every real tool rejects. If someone reverts strictRegistrar, the control and the
 * real tools converge and the "control still strips" assertion is what tells you the
 * suite was measuring a real difference rather than passing by construction.
 *
 * Run: npx tsx packages/memory-mcp/src/tools.strict.test.ts
 */

process.env.EMBEDDING_PROVIDER = 'none'

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { registerTools } from './tools.js'

const toolsSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'tools.ts'), 'utf-8')

let passed = 0
let failed = 0
function assert(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  PASS  ${label}`)
    passed++
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
    failed++
  }
}

const PROBE_KEY = '__traqr_unknown_probe__'

const server = new McpServer({ name: 'memory-mcp-strict-test', version: '0.0.0' })
registerTools(server)

// The control: registered the pre-TD-1144 way, on the same server, with a shape whose
// only field carries a `.default()` — i.e. memory_pulse's exact silent-loss shape.
let controlSawCaptures = -1
;(server as unknown as {
  tool: (n: string, d: string, s: z.ZodRawShape, h: (a: { captures: unknown[] }) => unknown) => void
}).tool(
  '__control_raw_shape__',
  'Pre-TD-1144 registration, kept only to prove this suite can tell the two apart.',
  { captures: z.array(z.object({ content: z.string() })).default([]) },
  async (args) => {
    controlSawCaptures = args.captures.length
    return { content: [{ type: 'text' as const, text: `captures=${args.captures.length}` }] }
  },
)

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
const client = new Client({ name: 'strict-test-client', version: '0.0.0' })
await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

type CallOutcome = { rejected: boolean; text: string }
async function call(name: string, args: Record<string, unknown>): Promise<CallOutcome> {
  try {
    const r = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean
      content?: { text?: string }[]
    }
    const text = r.content?.map((c) => c.text ?? '').join(' ') ?? ''
    return { rejected: Boolean(r.isError) && /Input validation error/.test(text), text }
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err)
    return { rejected: /Input validation error/.test(text), text }
  }
}

// --- Every advertised tool rejects an unrecognized top-level key ---------------
//
// Sending ONLY the probe key: required fields are missing too, but zod's strict
// object reports `unrecognized_keys` alongside the missing-field issues, so the
// assertion below pins the strictness specifically rather than "it errored somehow".
console.log('\n--- unknown top-level key is rejected by name (TD-1144) ---')
const advertised = (await client.listTools()).tools.map((t) => t.name)
const realTools = advertised.filter((n) => n !== '__control_raw_shape__')

assert('registerTools() advertises exactly 12 tools over the wire', realTools.length === 12, `saw ${realTools.length}: ${realTools}`)

for (const name of realTools) {
  const { rejected, text } = await call(name, { [PROBE_KEY]: 'x' })
  assert(
    `${name}: rejects an unknown key and names it`,
    rejected && text.includes('unrecognized_keys') && text.includes(PROBE_KEY),
    text.replace(/\s+/g, ' ').slice(0, 160),
  )
}

// --- The two field reports, pinned as their own cases ---------------------------
console.log('\n--- the reported failures, verbatim ---')
{
  // TD-1069 / TD-1144: `memories:` instead of `captures:` returned "Captured 0" twice,
  // nine days apart, with the second landing after TD-1069 was marked Done.
  const { rejected, text } = await call('memory_pulse', {
    memories: [{ content: 'A capture long enough to clear the 20-char minimum for storage.' }],
  })
  assert('memory_pulse: `memories:` is rejected, not answered with "Captured 0"', rejected && text.includes('memories'))
  assert('…and the response does NOT claim a successful empty batch', !/Captured 0/.test(text))
}
{
  // The security half: `accessLevel` gates the classification ceiling the
  // TD-810/883/884/885/887 arc built. That arc enforces the ceiling once the
  // parameter ARRIVES — a stripped key silently means "no ceiling".
  const { rejected, text } = await call('memory_search', { query: 'anything', accesslevel: 'admin' })
  assert('memory_search: a typo\'d `accessLevel` is rejected, not silently un-gated', rejected && text.includes('accesslevel'))
}

// --- Well-formed calls still pass validation ------------------------------------
//
// The risk this change carries is rejecting a LEGITIMATE call shape, which would break
// every slot's captures at once. `captures: []` is hermetic: the handler short-circuits
// with no search requested, so nothing touches the DB.
console.log('\n--- well-formed calls are unaffected ---')
{
  const { rejected, text } = await call('memory_pulse', { captures: [] })
  assert('memory_pulse: a well-formed call passes validation', !rejected, text.replace(/\s+/g, ' ').slice(0, 160))
  // Bonus, and it is the ticket's own point: TD-1069's guard has never been observed
  // firing in a live slot, because no slot ever reloaded the build that carries it.
  // Through a real transport it demonstrably fires.
  assert('…and TD-1069\'s zero-capture warning actually fires end-to-end', /stored NOTHING|0 captures/i.test(text), text.replace(/\s+/g, ' ').slice(0, 160))
}
{
  // A no-argument tool must keep working — `z.object({}).strict()` is a real schema
  // where the old empty raw shape was not, so this is the migration's sharpest edge.
  const { rejected } = await call('memory_audit', {})
  assert('memory_audit: an empty argument object still passes validation', !rejected)
}

// --- Non-vacuity: the control proves the suite can tell the two APIs apart --------
console.log('\n--- control: the pre-TD-1144 API still strips (proves non-vacuity) ---')
{
  const { rejected, text } = await call('__control_raw_shape__', {
    memories: [{ content: 'the wrong key, sent to a raw-shape registration' }],
  })
  assert('control registered via server.tool() ACCEPTS the unknown key', !rejected, text.replace(/\s+/g, ' ').slice(0, 160))
  assert('…and its handler ran with an EMPTY batch — the silent loss, reproduced', controlSawCaptures === 0)
}

// --- Regression guard: the NEXT tool someone adds ---------------------------------
//
// Every assertion above examines the tools that exist TODAY. A thirteenth tool
// registered the old way would reintroduce the class in silence and keep this whole
// suite green — so the durable half is a source-level check that no registration
// bypasses the strict registrar.
console.log('\n--- regression guard: no registration bypasses the strict registrar ---')
{
  const bypasses = toolsSrc.match(/^\s*server\.tool\(/gm) ?? []
  assert(
    'no server.tool( registration in tools.ts — use strict.tool(',
    bypasses.length === 0,
    `${bypasses.length} bypass(es) found`,
  )
}

await client.close()

console.log('\n' + '='.repeat(50))
console.log(`Results: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.error('memory-mcp strict-argument tests FAILED')
  process.exit(1)
}
console.log('All memory-mcp strict-argument tests passed!')
process.exit(0)
