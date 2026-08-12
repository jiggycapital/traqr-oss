/**
 * Teaching error helpers.
 * Every error tells: what went wrong, why it matters, and what to do.
 * First-mover DX differentiator — no memory competitor does this.
 */

export function teachingError(what: string, why: string, fixes: string[], docUrl?: string): string {
  let msg = `${what}\n\n${why}\n\nQuick fixes:\n`
  fixes.forEach((fix, i) => { msg += `  ${i + 1}. ${fix}\n` })
  if (docUrl) msg += `\nDocs: ${docUrl}`
  return msg
}

/**
 * Pattern-match common Postgres/Supabase/embedding errors and add teaching context.
 * Used by errorResult() in tools.ts to enrich every tool error automatically.
 */
export function enrichError(toolName: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)

  // Missing tables (setup.sql not run)
  if (msg.includes('relation') && msg.includes('does not exist')) {
    return teachingError(
      `Tool "${toolName}" failed: database tables not found.`,
      'setup.sql has not been run on your database.',
      [
        'For Supabase: paste setup.sql into SQL Editor at supabase.com/dashboard',
        'For Postgres: psql $DATABASE_URL -f node_modules/traqr-memory-mcp/setup.sql',
        'Get setup.sql: it ships inside this package (check node_modules/traqr-memory-mcp/)',
      ],
      'https://github.com/jiggycapital/traqr-oss#quick-start'
    )
  }

  // Invalid API key (Supabase returns specific error)
  if (msg.includes('Invalid API key') || msg.includes('JWT') || msg.includes('invalid claim')) {
    return teachingError(
      `Tool "${toolName}" failed: invalid database credentials.`,
      'The SUPABASE_SERVICE_ROLE_KEY is incorrect or expired.',
      [
        'Get the correct key from: Supabase Dashboard > Settings > API > service_role',
        'Make sure you copied the full key (starts with "eyJ...")',
        'Check your MCP config env block for typos',
      ]
    )
  }

  // Network/connection errors
  if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('fetch failed') || msg.includes('network')) {
    return teachingError(
      `Tool "${toolName}" failed: cannot reach database.`,
      'The database URL may be wrong or the server is unreachable.',
      [
        'Verify SUPABASE_URL or DATABASE_URL is correct',
        'Check if the database server is running',
        'For Supabase: verify the project is not paused (check dashboard)',
      ]
    )
  }

  // Embedding/API key errors
  if (msg.includes('OPENAI_API_KEY') || (msg.includes('embedding') && msg.includes('not set'))) {
    return teachingError(
      `Tool "${toolName}" failed: embedding provider not configured.`,
      'Semantic search needs an embedding API key. Keyword search (BM25) still works without one.',
      [
        'Set OPENAI_API_KEY for OpenAI ($0.02/1M tokens) — https://platform.openai.com/api-keys',
        'Or set GOOGLE_API_KEY for Gemini (free tier) — https://aistudio.google.com',
        'Or skip embeddings entirely — BM25 keyword search still works',
      ]
    )
  }

  // OpenAI rate limit / quota
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('quota')) {
    return teachingError(
      `Tool "${toolName}" failed: API rate limit or quota exceeded.`,
      'Your embedding provider is temporarily throttling requests.',
      [
        'Wait a moment and try again',
        'Check your API usage at your provider dashboard',
        'Consider switching to Gemini (free tier) via EMBEDDING_PROVIDER=gemini',
      ]
    )
  }

  // Default: return with tool context
  return `Error in ${toolName}: ${msg}`
}
