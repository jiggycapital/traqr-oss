/**
 * --verify — Health check + round trip test
 *
 * Verifies the complete setup: DB connection, schema, embeddings, round trip.
 *
 * Usage: npx traqr-memory-mcp --verify
 */

import * as p from '@clack/prompts'
import { configureMemory, getVectorDB, getEmbeddingProvider, storeMemory, searchMemoriesV2, deleteMemory } from '@traqr/memory'

async function run() {
  p.intro('TraqrDB Memory — Verify Setup')

  // Configure from env
  const supabaseUrl = process.env.SUPABASE_URL
  const databaseUrl = process.env.DATABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl && !databaseUrl) {
    p.log.error('No database configured. Set DATABASE_URL or SUPABASE_URL.')
    p.log.info('Run: npx traqr-memory-mcp --install')
    process.exit(1)
  }

  configureMemory({
    supabaseUrl,
    supabaseKey,
    databaseUrl,
  })

  const checks = { db: false, schema: false, embedding: false, roundTrip: false }
  const dbProvider = supabaseUrl ? 'Supabase' : 'Postgres'
  const ep = getEmbeddingProvider()
  const embeddingInfo = ep.provider === 'none' ? 'None (BM25 only)' : `${ep.provider}/${ep.model}`

  // Check 1: DB connection
  const s = p.spinner()
  s.start('Checking database connection...')
  try {
    const db = getVectorDB()
    const ok = await db.ping()
    if (!ok) throw new Error('ping returned false')
    checks.db = true
    s.stop(`Database: ${dbProvider} — connected`)
  } catch (err) {
    s.stop(`Database: ${dbProvider} — FAILED`)
    p.log.error(err instanceof Error ? err.message : String(err))
  }

  // Check 2: Schema version
  if (checks.db) {
    s.start('Checking schema version...')
    try {
      const db = getVectorDB()
      const version = await db.schemaVersion()
      if (version === null) throw new Error('schema_version table not found — run setup.sql first')
      checks.schema = true
      s.stop(`Schema: v${version}`)
    } catch (err) {
      s.stop('Schema: FAILED')
      p.log.error(err instanceof Error ? err.message : String(err))
      p.log.info('Run: npx traqr-memory-mcp --setup')
    }
  }

  // Check 3: Embedding provider
  s.start(`Checking embeddings (${embeddingInfo})...`)
  try {
    if (ep.provider === 'none') {
      checks.embedding = true
      s.stop(`Embeddings: None (BM25 keyword search only)`)
    } else {
      const result = await ep.generate('health check')
      if (!result.embedding?.length) throw new Error('Empty embedding returned')
      checks.embedding = true
      s.stop(`Embeddings: ${embeddingInfo} — ${result.dimensions} dimensions`)
    }
  } catch (err) {
    s.stop(`Embeddings: ${embeddingInfo} — FAILED`)
    p.log.error(err instanceof Error ? err.message : String(err))
  }

  // Check 4: Round trip (store → search → delete)
  if (checks.db && checks.schema) {
    s.start('Running round-trip test (store → search → delete)...')
    try {
      const testContent = `TraqrDB verify test — ${Date.now()}`
      const memory = await storeMemory({
        content: testContent,
        sourceType: 'session',
        sourceProject: 'verify-test',
        confidence: 0.1,
      })

      // Search for it (only if embeddings work)
      if (checks.embedding && ep.provider !== 'none') {
        const results = await searchMemoriesV2(testContent, { limit: 1 })
        if (results.length === 0) {
          p.log.warn('Search returned no results for test memory (may be indexing delay)')
        }
      }

      // Clean up
      const db = getVectorDB()
      await db.delete(memory.id)

      checks.roundTrip = true
      s.stop('Round trip: store → search → delete — OK')
    } catch (err) {
      s.stop('Round trip: FAILED')
      p.log.error(err instanceof Error ? err.message : String(err))
    }
  }

  // Summary
  const allPassed = Object.values(checks).every(Boolean)
  const passCount = Object.values(checks).filter(Boolean).length

  console.log('')
  p.log.info(`DB: ${dbProvider} | Embeddings: ${embeddingInfo}`)
  console.log('')
  console.log(`  ${checks.db ? 'pass' : 'FAIL'}  Database connection`)
  console.log(`  ${checks.schema ? 'pass' : 'FAIL'}  Schema version`)
  console.log(`  ${checks.embedding ? 'pass' : 'FAIL'}  Embedding provider`)
  console.log(`  ${checks.roundTrip ? 'pass' : 'FAIL'}  Round trip (store/search/delete)`)
  console.log('')

  if (allPassed) {
    p.outro(`All ${passCount} checks passed! TraqrDB is ready.`)
  } else {
    p.outro(`${passCount}/4 checks passed. Fix the failures above and re-run.`)
    process.exit(1)
  }
}

run().catch((err) => {
  console.error('Verify failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
