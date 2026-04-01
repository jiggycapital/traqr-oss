/**
 * --install — Interactive Setup Wizard
 *
 * Detects MCP client, asks 2-3 questions, writes config.
 * Uses @clack/prompts for polished interactive UI.
 *
 * Usage: npx traqr-memory-mcp --install
 */

import * as p from '@clack/prompts'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { detectMcpClients, readClientConfig, type DetectedClient } from './detect-client.js'
import { buildMcpConfig, formatConfig, type WizardAnswers, type DbProvider, type EmbeddingProvider } from './config-templates.js'

async function run() {
  p.intro('TraqrDB Memory — Setup Wizard')

  // Step 1: Detect MCP clients
  const clients = detectMcpClients()

  let targetClient: DetectedClient | null = null
  if (clients.length === 1) {
    p.log.info(`Detected ${clients[0].name} at ${clients[0].configPath}`)
    targetClient = clients[0]
  } else if (clients.length > 1) {
    const choice = await p.select({
      message: 'Multiple MCP clients detected. Which one?',
      options: [
        ...clients.map(c => ({ label: c.name, value: c.configPath })),
        { label: 'Print config to terminal (manual setup)', value: '__stdout__' },
      ],
    })
    if (p.isCancel(choice)) { p.cancel('Setup cancelled.'); process.exit(0) }
    if (choice !== '__stdout__') {
      targetClient = clients.find(c => c.configPath === choice) || null
    }
  } else {
    p.log.warn('No MCP client config detected. Config will be printed to terminal.')
  }

  // Step 2: Database provider
  const db = await p.select({
    message: 'Where is your database?',
    options: [
      { label: 'Supabase', value: 'supabase' as const, hint: 'easiest — free tier at supabase.com' },
      { label: 'Postgres', value: 'postgres' as const, hint: 'RDS, Aurora, Docker, any Postgres 15+ with pgvector' },
      { label: "I don't have one yet", value: 'none' as const, hint: 'we\'ll help you set one up' },
    ],
  })
  if (p.isCancel(db)) { p.cancel('Setup cancelled.'); process.exit(0) }

  if (db === 'none') {
    p.log.info('Create a free Supabase project at https://supabase.com')
    p.log.info('Then run this wizard again with your project URL and service role key.')
    p.outro('Come back when your database is ready!')
    process.exit(0)
  }

  // Step 3: Collect DB credentials
  const answers: WizardAnswers = { db: db as DbProvider, embedding: 'none' }

  if (db === 'supabase') {
    const url = await p.text({
      message: 'Supabase project URL',
      placeholder: 'https://xxx.supabase.co',
      validate: (v) => v && !v.includes('supabase.co') ? 'Should be a Supabase URL (https://xxx.supabase.co)' : undefined,
    })
    if (p.isCancel(url)) { p.cancel('Setup cancelled.'); process.exit(0) }
    answers.supabaseUrl = url

    const key = await p.text({
      message: 'Supabase service role key',
      placeholder: 'eyJ...',
      validate: (v) => v && !v.startsWith('eyJ') ? 'Service role key starts with eyJ (not the anon key)' : undefined,
    })
    if (p.isCancel(key)) { p.cancel('Setup cancelled.'); process.exit(0) }
    answers.supabaseKey = key
  } else {
    const url = await p.text({
      message: 'Postgres connection string',
      placeholder: 'postgresql://user:pass@host:5432/dbname',
      validate: (v) => v && !v.startsWith('postgres') ? 'Should start with postgresql:// or postgres://' : undefined,
    })
    if (p.isCancel(url)) { p.cancel('Setup cancelled.'); process.exit(0) }
    answers.databaseUrl = url
  }

  // Step 4: Embedding provider
  const embedding = await p.select({
    message: 'Which embedding provider?',
    options: [
      { label: 'OpenAI', value: 'openai' as const, hint: 'text-embedding-3-small — $0.02/1M tokens' },
      { label: 'Gemini', value: 'gemini' as const, hint: 'gemini-embedding-001 — free tier available' },
      { label: 'Amazon Bedrock', value: 'bedrock' as const, hint: 'Nova Embeddings — uses AWS credentials' },
      { label: 'Ollama', value: 'ollama' as const, hint: 'local models — no API key needed' },
      { label: 'None', value: 'none' as const, hint: 'BM25 keyword search only — no embeddings' },
    ],
  })
  if (p.isCancel(embedding)) { p.cancel('Setup cancelled.'); process.exit(0) }
  answers.embedding = embedding as EmbeddingProvider

  // Step 5: Collect embedding credentials
  switch (embedding) {
    case 'openai': {
      const key = await p.text({
        message: 'OpenAI API key',
        placeholder: 'sk-...',
        validate: (v) => v && !v.startsWith('sk-') ? 'OpenAI keys start with sk-' : undefined,
      })
      if (p.isCancel(key)) { p.cancel('Setup cancelled.'); process.exit(0) }
      answers.openaiKey = key
      break
    }
    case 'gemini': {
      const key = await p.text({
        message: 'Google API key',
        placeholder: 'AIza...',
      })
      if (p.isCancel(key)) { p.cancel('Setup cancelled.'); process.exit(0) }
      answers.googleKey = key
      break
    }
    case 'bedrock': {
      const region = await p.text({
        message: 'AWS region',
        placeholder: 'us-east-1',
        initialValue: 'us-east-1',
      })
      if (p.isCancel(region)) { p.cancel('Setup cancelled.'); process.exit(0) }
      answers.awsRegion = region
      p.log.info('Bedrock uses your AWS credentials (IAM role, env vars, or ~/.aws/credentials).')
      p.log.info('Make sure the role has bedrock:InvokeModel permission.')
      break
    }
    case 'ollama': {
      const url = await p.text({
        message: 'Ollama URL',
        placeholder: 'http://localhost:11434',
        initialValue: 'http://localhost:11434',
      })
      if (p.isCancel(url)) { p.cancel('Setup cancelled.'); process.exit(0) }
      answers.ollamaUrl = url
      break
    }
    // 'none' needs no credentials
  }

  // Step 6: Build config
  const config = buildMcpConfig(answers)
  const configJson = formatConfig(config)

  // Step 7: Write or print config
  if (targetClient) {
    const existingConfig = readClientConfig(targetClient)
    const servers = existingConfig[targetClient.configKey] || {}

    if (servers['traqr-memory']) {
      const overwrite = await p.confirm({
        message: 'traqr-memory already exists in your config. Overwrite?',
      })
      if (p.isCancel(overwrite) || !overwrite) {
        p.log.info('Existing config preserved. Here\'s the new config for reference:')
        console.log('\n' + configJson + '\n')
        p.outro('Add it manually if needed.')
        process.exit(0)
      }
    }

    servers['traqr-memory'] = config['traqr-memory']
    existingConfig[targetClient.configKey] = servers

    try {
      writeFileSync(targetClient.configPath, JSON.stringify(existingConfig, null, 2) + '\n')
      p.log.success(`Written to ${targetClient.configPath}`)
    } catch (err) {
      p.log.error(`Failed to write config: ${err instanceof Error ? err.message : err}`)
      p.log.info('Add this to your MCP config manually:')
      console.log('\n' + configJson + '\n')
    }
  } else {
    p.log.info('Add this to your MCP client config:')
    console.log('\n' + configJson + '\n')
  }

  // Step 8: Next steps
  p.log.step('Next steps:')
  if (db === 'supabase') {
    p.log.info('1. Run setup.sql in your Supabase SQL Editor')
    p.log.info('   Get it: npx traqr-memory-mcp --setup')
  } else {
    p.log.info('1. Run: npx traqr-memory-mcp --setup')
    p.log.info('   This will create the schema in your Postgres database')
  }
  p.log.info('2. Restart your MCP client')
  p.log.info('3. Run: npx traqr-memory-mcp --verify')
  p.log.info('4. Optional: npx traqr-memory-mcp --print-instructions')
  p.log.info('   Prints a CLAUDE.md section that teaches Claude how to use memory proactively')

  p.outro('Setup complete! Restart your MCP client to connect.')
}

run().catch((err) => {
  console.error('Setup failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
