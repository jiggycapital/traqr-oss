/**
 * triageAndStore may RETIRE an existing row only at or above the retire floor (TD-1334).
 *
 * The defect, measured on traqr-db 2026-09-23: over 30 days `memory_pulse` retired 666 rows,
 * 93% of them through a borderline match under 0.80 similarity, and a hand-graded sample under
 * 0.70 was 0-for-5 the same claim. Every retiring path is covered here, each on both sides of the
 * floor, because a floor wired into one branch and forgotten in another is the #1223 shape (one
 * action added in four places, missed in the fifth).
 *
 * Hermetic: EMBEDDING_PROVIDER=none, a fake VectorDBProvider via the setVectorDB seam that
 * records every mutating call, and the LLM verdict injected through TriageOptions.decide.
 *
 * Run: npx tsx packages/memory/src/lib/triage-retire-floor.test.ts
 */

process.env.EMBEDDING_PROVIDER = 'none'

import { triageAndStore, mayRetire, DEFAULT_RETIRE_THRESHOLD } from './memory.js'
import type { BorderlineDecision } from './borderline.js'
import { setVectorDB, resetVectorDB } from '../vectordb/index.js'
import type { VectorDBProvider, MemorySearchResult, MemoryInput, Memory } from '../vectordb/types.js'

let passed = 0
let failed = 0
function assert(label: string, condition: boolean) {
  if (condition) { console.log(`  PASS  ${label}`); passed++ }
  else { console.log(`  FAIL  ${label}`); failed++ }
}

const EXISTING_ID = 'mem-existing'

interface Recorder {
  stored: number
  invalidated: string[]
  superseded: string[]
  archived: string[]
  edges: Array<{ type: string; target: string; metadata: Record<string, unknown> }>
}

const row = (id: string, similarity: number, content: string, memoryType: string) => ({
  id, content, memoryType, tags: [],
  classification: 'public', createdAt: new Date(0), similarity, relevanceScore: similarity,
}) as unknown as MemorySearchResult

function install(similarity: number, existingContent: string, memoryType: string): Recorder {
  return installRows([row(EXISTING_ID, similarity, existingContent, memoryType)])
}

/** `rows` is the search result IN ORDER — the store ranks by relevance_score, not similarity. */
function installRows(rows: MemorySearchResult[]): Recorder {
  const rec: Recorder = { stored: 0, invalidated: [], superseded: [], archived: [], edges: [] }
  const existing = rows[0]
  const provider = {
    async search(): Promise<MemorySearchResult[]> { return rows },
    async store(input: MemoryInput): Promise<Memory> {
      rec.stored++
      return { id: `mem-new-${rec.stored}`, ...input, createdAt: new Date(0), updatedAt: new Date(0) } as unknown as Memory
    },
    async invalidate(id: string) { rec.invalidated.push(id) },
    async supersede(id: string) { rec.superseded.push(id) },
    async archive(id: string) { rec.archived.push(id); return existing as unknown as Memory },
    async validate() { return existing as unknown as Memory },
    async update() { return existing as unknown as Memory },
    async createRelationship(_s: string, target: string, type: string, metadata: Record<string, unknown>) {
      rec.edges.push({ type, target, metadata }); return `edge-${rec.edges.length}`
    },
  }
  setVectorDB(provider as unknown as VectorDBProvider)
  return rec
}

const verdict = (action: BorderlineDecision['action'], target = 'MEMORY_A') =>
  async (): Promise<BorderlineDecision> => ({ action, target, edgeType: 'updates', reasoning: 'test' } as BorderlineDecision)
const noVerdict = async (): Promise<BorderlineDecision | null> => null

const SHORT = 'packages/memory/src/lib/memory.ts: follow-up adds ONE fact (reserve grade 0.47%) to TD-1334.'
const LONG = SHORT + ' ' + 'Full record: capital structure, convert terms, Q2 split, offtake economics, bars. '.repeat(4)
const input = (content: string, memoryType: 'fact' | 'preference' | 'pattern' = 'fact'): MemoryInput =>
  ({ content, category: 'insight', memoryType, tags: [] }) as unknown as MemoryInput

const retiredAnything = (r: Recorder) => r.invalidated.length + r.superseded.length + r.archived.length > 0

async function main() {
  console.log('\n--- the floor itself ---')
  assert('default floor is 0.80', DEFAULT_RETIRE_THRESHOLD === 0.80)
  assert('0.80 may retire (inclusive)', mayRetire(0.80))
  assert('0.7999 may not', !mayRetire(0.7999))
  assert('an explicit retireThreshold overrides the default', mayRetire(0.65, { retireThreshold: 0.6 }))

  for (const action of ['update', 'correct'] as const) {
    console.log(`\n--- LLM ${action.toUpperCase()} ---`)
    {
      const rec = install(0.68, LONG, 'fact')
      const res = await triageAndStore(input(SHORT), { decide: verdict(action) })
      assert(`${action} at 0.68: nothing invalidated, superseded or archived`, !retiredAnything(rec))
      assert(`${action} at 0.68: the new row IS stored`, rec.stored === 1 && res.action === 'related')
      assert(`${action} at 0.68: reported as no supersede (merged=false)`, res.merged === false)
      assert(
        `${action} at 0.68: the edge records the declined verdict`,
        rec.edges.length === 1 && rec.edges[0].type === 'related' && rec.edges[0].metadata.retireDeclined === action,
      )
    }
    {
      const rec = install(0.86, LONG, 'fact')
      const res = await triageAndStore(input(SHORT), { decide: verdict(action) })
      assert(`${action} at 0.86: the existing row IS retired`, retiredAnything(rec) && res.merged === true)
    }
  }

  // The verdict may name MEMORY_B/C, and each row carries its own similarity. Grading the top
  // match let a 0.86 MEMORY_A license archiving a 0.62 MEMORY_C (DevOps2's probe on #4978).
  for (const action of ['update', 'correct'] as const) {
    console.log(`\n--- LLM ${action.toUpperCase()} aimed at a lower-ranked row ---`)
    {
      const rec = installRows([
        row('mem-a', 0.86, LONG, 'fact'), row('mem-b', 0.70, LONG, 'fact'), row('mem-c', 0.62, LONG, 'fact'),
      ])
      const res = await triageAndStore(input(SHORT), { decide: verdict(action, 'MEMORY_C') })
      assert(`${action} on C (0.62) under A (0.86): nothing retired`, !retiredAnything(rec) && res.merged === false)
      assert(
        `${action} on C: the declined edge points at C and carries C's own similarity`,
        rec.edges.length === 1 && rec.edges[0].target === 'mem-c' && rec.edges[0].metadata.confidence === 0.62
          && rec.edges[0].metadata.retireDeclined === action,
      )
      assert(`${action} on C: reported against C, not A`, res.existingId === 'mem-c')
    }
    {
      // relevance_score order: A leads on citations while B is the closer text.
      const rec = installRows([row('mem-a', 0.78, LONG, 'fact'), row('mem-b', 0.84, LONG, 'fact')])
      const res = await triageAndStore(input(SHORT), { decide: verdict(action, 'MEMORY_B') })
      const retired = [...rec.invalidated, ...rec.superseded, ...rec.archived]
      assert(`${action} on B (0.84) under A (0.78): B is retired, A is not`, retired.includes('mem-b') && !retired.includes('mem-a') && res.merged === true)
      assert(`${action} on B: the updates edge carries B's similarity`, rec.edges[0]?.target === 'mem-b' && rec.edges[0]?.metadata.confidence === 0.84)
    }
  }

  console.log('\n--- LLM ADD / NOOP are untouched by the floor ---')
  {
    const rec = install(0.68, LONG, 'fact')
    const res = await triageAndStore(input(SHORT), { decide: verdict('add') })
    assert('add at 0.68 stores alongside, retires nothing', rec.stored === 1 && !retiredAnything(rec) && res.action === 'related')
  }
  {
    const rec = install(0.68, LONG, 'fact')
    const res = await triageAndStore(input(SHORT), { decide: verdict('noop') })
    assert('noop at 0.68 still dedupes (floor only gates retirement)', rec.stored === 0 && res.deduplicated === true)
  }

  console.log('\n--- heuristic fallback (LLM unavailable), new text longer ---')
  {
    const rec = install(0.68, SHORT, 'fact')
    const res = await triageAndStore(input(LONG), { decide: noVerdict })
    assert('longer-new at 0.68: old row NOT invalidated', !retiredAnything(rec))
    assert('longer-new at 0.68: new row stored as related', rec.stored === 1 && res.action === 'related' && res.merged === false)
  }
  {
    const rec = install(0.86, SHORT, 'fact')
    const res = await triageAndStore(input(LONG), { decide: noVerdict })
    assert('longer-new at 0.86: old row invalidated as before', rec.invalidated.includes(EXISTING_ID) && res.merged === true)
  }

  resetVectorDB()
  console.log(`\nResults: ${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => { console.error(err); process.exit(1) })
