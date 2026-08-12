# @traqr/memory

TypeScript library for persistent AI agent memory. Multi-strategy retrieval (semantic + BM25 + RRF), 3-zone cosine triage, entity extraction, type-aware lifecycle. Postgres + pgvector.

Use this library if you're building your own memory-powered application. For an MCP server that works out of the box, see [traqr-memory-mcp](https://www.npmjs.com/package/traqr-memory-mcp).

## Install

```bash
npm install @traqr/memory
```

## Quick Usage

```typescript
import { configureMemory, storeMemory, searchMemoriesV2, triageAndStore } from '@traqr/memory'

// Configure once at startup
configureMemory({
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
})
// OR for raw Postgres:
configureMemory({
  databaseUrl: process.env.DATABASE_URL,
})

// Store a memory
const memory = await storeMemory({
  content: 'React Server Components require "use client" for interactive components',
  sourceType: 'session',
})

// Search by meaning (multi-strategy: semantic + BM25 + RRF fusion)
const results = await searchMemoriesV2('React component patterns', { limit: 5 })

// Store with deduplication triage (cosine similarity zones + LLM borderline)
const result = await triageAndStore({
  content: 'Always use useCallback for event handlers passed to memoized children',
  sourceType: 'session',
})
// result.zone: 'noop' (duplicate) | 'add' (new) | 'borderline' (LLM decided)
```

## VectorDB Providers

Two providers, same SQL functions, different transport:

| Provider | Connection | Transport | When to use |
|----------|-----------|-----------|-------------|
| Supabase | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | PostgREST (HTTP) | Easiest setup, free tier |
| Postgres | `DATABASE_URL` | pg wire protocol | RDS, Aurora, Docker, self-hosted |

Auto-detected from environment variables. Or explicit:

```typescript
import { getVectorDB } from '@traqr/memory'

const db = getVectorDB({ type: 'postgres' })
await db.ping() // true
```

For raw Postgres, install the `pg` package: `npm install pg`

## Embedding Providers

| Provider | Env Var | Model | Dimensions |
|----------|---------|-------|-----------|
| OpenAI | `OPENAI_API_KEY` | text-embedding-3-small | 1536 |
| Gemini | `GOOGLE_API_KEY` | gemini-embedding-001 | 1536 |
| Bedrock | `EMBEDDING_PROVIDER=bedrock` + AWS creds | amazon.nova-embed-v1:0 | 1536 |
| Ollama | `EMBEDDING_PROVIDER=ollama` | nomic-embed-text | 768 |
| None | `EMBEDDING_PROVIDER=none` | — | 0 (BM25 only) |

Set `EMBEDDING_PROVIDER` explicitly, or it auto-detects from available API keys.

```typescript
import { getEmbeddingProvider } from '@traqr/memory'

const ep = getEmbeddingProvider()
console.log(ep.provider, ep.model, ep.dimensions)
// 'openai', 'text-embedding-3-small', 1536
```

## Key Exports

```typescript
// High-level operations
import {
  storeMemory, searchMemoriesV2, getMemory, updateMemory, deleteMemory,
  triageAndStore, storeWithDedup, archiveMemory, remember, recall,
} from '@traqr/memory'

// VectorDB layer
import { getVectorDB, resetVectorDB } from '@traqr/memory'
import type { VectorDBProvider, Memory, MemorySearchResult } from '@traqr/memory'

// Embeddings
import { generateEmbedding, getEmbeddingProvider } from '@traqr/memory'
import type { EmbeddingProvider, EmbeddingResult } from '@traqr/memory'

// Configuration
import { configureMemory, getMemoryConfig } from '@traqr/memory'

// Auto-derive (extracts domain, category, topic, tags from content)
import { deriveAll } from '@traqr/memory'

// Multi-strategy retrieval internals
import { reciprocalRankFusion, detectStrategies } from '@traqr/memory'
```

## Database Setup

Run `setup.sql` on your Postgres 15+ database (pgvector required):

```bash
# Supabase: paste into SQL Editor
# Postgres: psql $DATABASE_URL -f setup.sql
# Docker:
docker run -d --name traqrdb -e POSTGRES_PASSWORD=postgres -p 5432:5432 pgvector/pgvector:pg16
psql postgresql://postgres:postgres@localhost:5432/postgres -f node_modules/traqr-memory-mcp/setup.sql
```

## License

[FSL-1.1-ALv2](https://fsl.software) — use freely for any purpose except offering a competing commercial memory service. Converts to Apache-2.0 after 2 years.
