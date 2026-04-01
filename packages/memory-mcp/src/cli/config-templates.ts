/**
 * MCP Config Templates
 *
 * Builds the JSON config block that goes into the user's MCP client config.
 * Templates match the README exactly — same args, same env vars.
 */

export type DbProvider = 'supabase' | 'postgres'
export type EmbeddingProvider = 'openai' | 'gemini' | 'bedrock' | 'ollama' | 'none'

export interface WizardAnswers {
  db: DbProvider
  embedding: EmbeddingProvider
  // DB credentials
  supabaseUrl?: string
  supabaseKey?: string
  databaseUrl?: string
  // Embedding credentials
  openaiKey?: string
  googleKey?: string
  awsRegion?: string
  ollamaUrl?: string
  ollamaModel?: string
}

export function buildMcpConfig(answers: WizardAnswers): Record<string, any> {
  const args: string[] = []

  // Optional peer deps via npx -p
  if (answers.embedding === 'bedrock') args.push('-p', '@aws-sdk/client-bedrock-runtime')
  if (answers.db === 'postgres') args.push('-p', 'pg')
  args.push('traqr-memory-mcp')

  // Env vars
  const env: Record<string, string> = {}

  // DB
  if (answers.db === 'supabase') {
    if (answers.supabaseUrl) env.SUPABASE_URL = answers.supabaseUrl
    if (answers.supabaseKey) env.SUPABASE_SERVICE_ROLE_KEY = answers.supabaseKey
  } else {
    if (answers.databaseUrl) env.DATABASE_URL = answers.databaseUrl
  }

  // Embedding
  switch (answers.embedding) {
    case 'openai':
      if (answers.openaiKey) env.OPENAI_API_KEY = answers.openaiKey
      break
    case 'gemini':
      if (answers.googleKey) env.GOOGLE_API_KEY = answers.googleKey
      break
    case 'bedrock':
      env.EMBEDDING_PROVIDER = 'bedrock'
      env.EMBEDDING_MODEL = 'amazon.nova-embed-v1:0'
      if (answers.awsRegion) env.AWS_REGION = answers.awsRegion
      break
    case 'ollama':
      env.EMBEDDING_PROVIDER = 'ollama'
      if (answers.ollamaUrl) env.OLLAMA_BASE_URL = answers.ollamaUrl
      if (answers.ollamaModel) env.EMBEDDING_MODEL = answers.ollamaModel
      break
    case 'none':
      env.EMBEDDING_PROVIDER = 'none'
      break
  }

  return {
    'traqr-memory': {
      command: 'npx',
      args,
      env,
    },
  }
}

export function formatConfig(config: Record<string, any>): string {
  return JSON.stringify(config, null, 2)
}
