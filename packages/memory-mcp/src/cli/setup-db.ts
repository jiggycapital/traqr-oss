/**
 * --setup — Run setup.sql on configured database
 *
 * For Postgres: executes setup.sql directly via pg.
 * For Supabase: prints the SQL with instructions to paste into SQL Editor.
 *
 * Usage: npx traqr-memory-mcp --setup
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as p from '@clack/prompts'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function run() {
  p.intro('TraqrDB Memory — Database Setup')

  const setupSqlPath = join(__dirname, '..', 'setup.sql')
  let setupSql: string
  try {
    setupSql = readFileSync(setupSqlPath, 'utf-8')
  } catch {
    p.log.error(`setup.sql not found at ${setupSqlPath}`)
    p.log.info('If installed via npm, it should be at: node_modules/traqr-memory-mcp/setup.sql')
    process.exit(1)
  }

  const databaseUrl = process.env.DATABASE_URL
  const supabaseUrl = process.env.SUPABASE_URL

  if (!databaseUrl && !supabaseUrl) {
    p.log.error('No database configured.')
    p.log.info('Set DATABASE_URL or SUPABASE_URL environment variable, then run again.')
    p.log.info('Or run: npx traqr-memory-mcp --install')
    process.exit(1)
  }

  if (databaseUrl) {
    // Postgres: execute directly
    p.log.info(`Connecting to Postgres...`)

    let pg: any
    try {
      pg = await (Function('return import("pg")')() as Promise<any>)
    } catch {
      p.log.error('The pg package is required for direct Postgres setup.')
      p.log.info('Install it: npm install pg')
      process.exit(1)
    }

    const Pool = pg.default?.Pool || pg.Pool
    const pool = new Pool({ connectionString: databaseUrl })

    try {
      // Check if schema already exists
      try {
        const result = await pool.query('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
        if (result.rows.length > 0) {
          const version = result.rows[0].version
          p.log.success(`Schema v${version} already exists.`)
          const proceed = await p.confirm({
            message: 'Re-run setup.sql anyway? (safe — uses IF NOT EXISTS)',
          })
          if (p.isCancel(proceed) || !proceed) {
            p.outro('Schema is up to date.')
            await pool.end()
            process.exit(0)
          }
        }
      } catch {
        // schema_version doesn't exist — fresh database
        p.log.info('Fresh database detected. Running setup.sql...')
      }

      const s = p.spinner()
      s.start('Running setup.sql...')
      await pool.query(setupSql)
      s.stop('Schema created successfully!')

      // Verify
      const result = await pool.query('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
      if (result.rows.length > 0) {
        p.log.success(`Schema v${result.rows[0].version} is ready.`)
      }

      await pool.end()
    } catch (err) {
      p.log.error(`Failed to run setup.sql: ${err instanceof Error ? err.message : err}`)
      p.log.info('Check your DATABASE_URL and ensure pgvector is enabled:')
      p.log.info('  CREATE EXTENSION IF NOT EXISTS vector;')
      await pool.end()
      process.exit(1)
    }
  } else {
    // Supabase: print instructions
    p.log.info('Supabase detected. Setup.sql must be run via the Supabase SQL Editor.')
    p.log.step('Steps:')
    p.log.info('1. Go to your Supabase project dashboard')
    p.log.info('2. Open SQL Editor (left sidebar)')
    p.log.info('3. Paste the contents of setup.sql')
    p.log.info('4. Click "Run"')
    p.log.info('')
    p.log.info(`setup.sql location: ${setupSqlPath}`)
    p.log.info('')

    const print = await p.confirm({
      message: 'Print setup.sql contents to terminal? (for easy copy-paste)',
    })
    if (!p.isCancel(print) && print) {
      console.log('\n--- BEGIN setup.sql ---\n')
      console.log(setupSql)
      console.log('\n--- END setup.sql ---\n')
    }
  }

  p.outro('Database setup complete! Run: npx traqr-memory-mcp --verify')
}

run().catch((err) => {
  console.error('Setup failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
