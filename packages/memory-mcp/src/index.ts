#!/usr/bin/env node
/**
 * TraqrDB Memory MCP Server
 *
 * Standalone MCP server for AI agents. 10 memory tools powered by
 * Postgres + pgvector. Multi-strategy retrieval (semantic + BM25 + RRF),
 * cosine triage, LLM borderline decisions, entity extraction.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx traqr-memory-mcp
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { configureMemory } from '@traqr/memory'
import { registerTools } from './tools.js'

// Read version from package.json
const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))

// Configure database from environment
const supabaseUrl = process.env.SUPABASE_URL
const databaseUrl = process.env.DATABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl && !databaseUrl) {
  console.error('Error: SUPABASE_URL or DATABASE_URL environment variable required.')
  console.error('See README.md for setup instructions.')
  process.exit(1)
}

if (supabaseUrl && !supabaseKey) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY required when using SUPABASE_URL.')
  console.error('Find it in your Supabase dashboard: Settings > API > service_role key')
  process.exit(1)
}

configureMemory({
  supabaseUrl: supabaseUrl || databaseUrl!,
  supabaseKey: supabaseKey || 'not-needed-for-raw-postgres',
  userId: process.env.TRAQR_USER_ID,
  projectId: process.env.TRAQR_PROJECT_ID,
})

// Create and start MCP server
const server = new McpServer({
  name: 'traqr-memory',
  version: pkg.version,
})

registerTools(server)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('TraqrDB Memory MCP server failed to start:', err)
  process.exit(1)
})
