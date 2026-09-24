/**
 * entity-pipeline — countMentions must not swallow a structurally dead RPC silently.
 *
 * TD-902's migration 020 header named TWO swallow sites: `vectordb/supabase.ts` and
 * `vectordb/postgres.ts`. Only the supabase one was instrumented. `countMentions()` in
 * entity-pipeline.ts is the SHARED CONSUMER of both, and its `catch { return 0 }` was
 * bare — so on the postgres provider (raw `pool.query`, which THROWS rather than
 * resolving `{error}`) a dead `count_entity_mentions` became a silent 0.
 *
 * That 0 is load-bearing: it feeds MENTION_THRESHOLD, so every entity fails the
 * documented "3+ mentions" promotion check — exactly the defect TD-902 named.
 *
 * This test drives the real pipeline through the setVectorDB seam with a provider that
 * throws the postgres shape, and asserts the structural log fires. Fail-open is
 * preserved: the call must still resolve, not reject.
 *
 * FIXTURE NOTE: the content MUST contain a capitalized MULTI-WORD name (or an ALL-CAPS
 * acronym) or extractEntityCandidates() returns [] and processEntitiesForMemory returns
 * before Step 2 ever runs — the test then passes vacuously on the fail-open assertions
 * while never reaching countMentions. That is exactly how this test first failed.
 *
 * Run: npx tsx packages/memory/src/lib/entity-pipeline-swallow.test.ts
 */
process.env.EMBEDDING_PROVIDER = 'none'

import { processEntitiesForMemory } from './entity-pipeline.js'
import { setVectorDB, resetVectorDB } from '../vectordb/index.js'

let passed = 0
let failed = 0
function assert(label: string, cond: boolean) {
  if (cond) { console.log(`  PASS  ${label}`); passed++ }
  else { console.log(`  FAIL  ${label}`); failed++ }
}

function deadProvider(err: unknown) {
  return {
    async findEntityByName() { return null },
    async findEntityByNameFuzzy() { return null },
    async findEntityByEmbedding() { return null },
    async countEntityMentions(): Promise<number> { throw err },
    async createEntity() { return { id: 'e1' } },
    async bumpReturned() {}, async citeMemory() {},
  } as never
}

async function run(err: unknown): Promise<{ warnings: string[]; rejected: boolean }> {
  const warnings: string[] = []
  const realWarn = console.warn
  console.warn = (...a: unknown[]) => { warnings.push(a.map((x) => String(x)).join(' ')) }
  let rejected = false
  setVectorDB(deadProvider(err))
  try {
    await processEntitiesForMemory('mem-1', 'Vita Coco beat again and Vita Coco guided up', {} as never)
  } catch { rejected = true } finally {
    resetVectorDB(); console.warn = realWarn
  }
  return { warnings, rejected }
}

console.log('\n--- countMentions: a dead RPC must be LOUD, still fail open ---')
{
  const e = Object.assign(new Error('relation "traqr_memories" does not exist'), { code: '42P01' })
  const { warnings, rejected } = await run(e)
  const hit = warnings.find((w) => w.includes('countMentions') && w.includes('structurallyDead=true'))
  assert('structural death is logged (not silently 0)', Boolean(hit))
  assert('names the RPC so it is greppable', Boolean(hit && hit.includes('count_entity_mentions')))
  assert('still FAILS OPEN — pipeline resolves, does not reject', !rejected)
}

console.log('\n--- a transient error is NOT labelled structurally dead ---')
{
  const { warnings, rejected } = await run(new Error('Connection terminated due to connection timeout'))
  const logged = warnings.find((w) => w.includes('countMentions'))
  assert('transient failure is still logged at all', Boolean(logged))
  assert('but NOT tagged structurallyDead', Boolean(logged && !logged.includes('structurallyDead=true')))
  assert('still fails open', !rejected)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
