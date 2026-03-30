/**
 * Migration Runner for @traqr/memory
 *
 * Reads SQL migration files from packages/memory/migrations/ and executes
 * them in order against a Supabase database. Tracks applied migrations
 * in a _traqr_migrations table to avoid re-running.
 *
 * Standalone usage:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   npx ts-node packages/memory/src/migrate.ts
 *
 * Requires the `exec_sql` RPC function in your Supabase project.
 * If not available, paste the SQL from .traqr/schema.sql directly
 * into Supabase SQL Editor instead.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const MIGRATIONS_TABLE = '_traqr_migrations'

async function migrate() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const client = createClient(supabaseUrl, supabaseKey)

  // Ensure migrations tracking table exists
  await client.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      );
    `,
  }).then(({ error }) => {
    if (error) {
      // If RPC doesn't exist, try raw query via REST
      console.warn('exec_sql RPC not available, attempting direct execution...')
    }
  })

  // Find migration files
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort()

  console.log(`Found ${files.length} migration files`)

  // Check which have been applied
  const { data: applied } = await client
    .from(MIGRATIONS_TABLE)
    .select('name')

  const appliedSet = new Set((applied || []).map(r => r.name))

  let appliedCount = 0
  let skippedCount = 0

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`  SKIP  ${file} (already applied)`)
      skippedCount++
      continue
    }

    const sql = readFileSync(join(migrationsDir, file), 'utf-8')
    console.log(`  RUN   ${file}...`)

    const { error } = await client.rpc('exec_sql', { sql })
    if (error) {
      console.error(`  FAIL  ${file}: ${error.message}`)
      process.exit(1)
    }

    // Record migration
    await client.from(MIGRATIONS_TABLE).insert({ name: file })
    appliedCount++
    console.log(`  OK    ${file}`)
  }

  console.log(`\nDone: ${appliedCount} applied, ${skippedCount} skipped`)
}

migrate().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
