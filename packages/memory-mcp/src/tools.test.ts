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
const fakeServer = {
  tool(name: string, _desc: string, _schema: unknown, handler: ToolHandler) {
    handlers.set(name, handler)
  },
} as unknown as McpServer
registerTools(fakeServer)

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

console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('MEMORY_CORRECT FORWARDING CONTRACT FAILED')
  process.exit(1)
} else {
  console.log('All memory_correct forwarding-contract tests passed!')
}
