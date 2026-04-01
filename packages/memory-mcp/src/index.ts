#!/usr/bin/env node
/**
 * TraqrDB Memory MCP Server
 *
 * CLI flags (run instead of MCP server):
 *   --install             Interactive setup wizard
 *   --setup               Run setup.sql on your database
 *   --verify              Health check + round trip test
 *   --print-instructions  Print CLAUDE.md memory instructions
 *
 * Standalone MCP server for AI agents. 10 memory tools powered by
 * Postgres + pgvector. Multi-strategy retrieval (semantic + BM25 + RRF),
 * cosine triage, LLM borderline decisions, entity extraction.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx traqr-memory-mcp
 */

// CLI flag routing — handle before heavy imports
const cliFlag = process.argv[2]
if (cliFlag === '--install') { await import('./cli/install.js'); process.exit(0) }
if (cliFlag === '--setup') { await import('./cli/setup-db.js'); process.exit(0) }
if (cliFlag === '--verify') { await import('./cli/verify.js'); process.exit(0) }
if (cliFlag === '--print-instructions') { await import('./cli/instructions.js'); process.exit(0) }
if (cliFlag === '--help' || cliFlag === '-h') {
  console.log(`
  traqr-memory-mcp — MCP server for persistent AI agent memory

  Usage: npx traqr-memory-mcp [flag]

  Flags:
    --install             Interactive setup wizard
    --setup               Run setup.sql on your database
    --verify              Health check + round trip test
    --print-instructions  Print CLAUDE.md memory instructions
    --help, -h            Show this help

  No flags: start MCP server (for MCP client config, not direct use)

  Quick start:
    npx traqr-memory-mcp --install
`)
  process.exit(0)
}

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { configureMemory, getVectorDB, getEmbeddingProvider } from '@traqr/memory'
import { registerTools } from './tools.js'
import { teachingError } from './errors.js'

// Read version from package.json
const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))

// Configure database from environment
const supabaseUrl = process.env.SUPABASE_URL
const databaseUrl = process.env.DATABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl && !databaseUrl) {
  console.error(`
TraqrDB: No database connection configured.

Set one of these in your MCP client config:
  SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY  (easiest: supabase.com free tier)
  DATABASE_URL                               (any Postgres 15+ with pgvector)

Example (Claude Code settings.json):
  "traqr-memory": {
    "command": "npx",
    "args": ["traqr-memory-mcp"],
    "env": {
      "SUPABASE_URL": "https://xxx.supabase.co",
      "SUPABASE_SERVICE_ROLE_KEY": "eyJ..."
    }
  }

Setup guide: https://github.com/jiggycapital/traqr-oss#quick-start
`)
  process.exit(1)
}

if (supabaseUrl && !supabaseKey) {
  console.error(`
TraqrDB: SUPABASE_SERVICE_ROLE_KEY is missing.

When using SUPABASE_URL, you also need the service role key.
Find it at: Supabase Dashboard > Settings > API > service_role (not anon!)

Add to your MCP config env block:
  "SUPABASE_SERVICE_ROLE_KEY": "eyJ..."
`)
  process.exit(1)
}

configureMemory({
  supabaseUrl: supabaseUrl,
  supabaseKey: supabaseKey,
  databaseUrl: databaseUrl,
  userId: process.env.TRAQR_USER_ID,
  projectId: process.env.TRAQR_PROJECT_ID,
})

// Create and start MCP server
const server = new McpServer({
  name: 'traqr-memory',
  version: pkg.version,
})

registerTools(server)

const REQUIRED_SCHEMA_VERSION = 2

async function checkSchemaAndReport() {
  const dbProvider = supabaseUrl ? 'Supabase' : 'Postgres'
  const ep = getEmbeddingProvider()
  const embeddingProvider = ep.provider === 'none' ? 'None (BM25 only)' : `${ep.provider}/${ep.model}`
  let schemaVersion = '?'

  try {
    const db = getVectorDB()
    const version = await db.schemaVersion()

    if (version === null) {
      console.error(teachingError(
        'TraqrDB: schema_version table not found.',
        'setup.sql may not have been run on your database.',
        [
          'For Supabase: paste setup.sql into SQL Editor',
          'For Postgres: psql $DATABASE_URL -f setup.sql',
          'Get setup.sql from: node_modules/traqr-memory-mcp/setup.sql',
        ]
      ))
    } else {
      schemaVersion = `v${version}`
      if (version < REQUIRED_SCHEMA_VERSION) {
        console.error(`TraqrDB: Schema v${version} detected, v${REQUIRED_SCHEMA_VERSION} required.`)
        console.error(`Run upgrade-v${REQUIRED_SCHEMA_VERSION}.sql on your database. See UPGRADING.md.`)
      } else if (version > REQUIRED_SCHEMA_VERSION) {
        console.error(`TraqrDB: Schema v${version} is newer than this server (expects v${REQUIRED_SCHEMA_VERSION}).`)
        console.error('Update the package: npm update traqr-memory-mcp')
      }
    }
  } catch {
    // Can't check — proceed and let tool calls surface errors
  }

  console.error(`TraqrDB Memory MCP v${pkg.version} | Schema ${schemaVersion} | DB: ${dbProvider} | Embeddings: ${embeddingProvider} | Ready`)
}

async function main() {
  const transport = new StdioServerTransport()
  await checkSchemaAndReport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error(`
TraqrDB Memory MCP server failed to start.

Error: ${err instanceof Error ? err.message : String(err)}

Troubleshooting:
  1. Check that SUPABASE_URL or DATABASE_URL is correct
  2. Verify your database is running and accessible
  3. Ensure setup.sql has been run on the database
  4. Check your MCP client config for env var typos

Guide: https://github.com/jiggycapital/traqr-oss#quick-start
`)
  process.exit(1)
})
