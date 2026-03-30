# TraqrDB — Memory-as-a-Service for AI Agents

A schema + intelligence layer on top of Postgres + pgvector. Store memories, search by meaning, track entity relationships, manage memory lifecycle — all via 10 MCP tools.

## Quick Start (10 minutes)

### 1. Set Up Your Database

**Option A: Supabase (easiest, free tier)**
1. Create a project at [supabase.com](https://supabase.com)
2. Go to SQL Editor, paste contents of `setup.sql`, run
3. Copy your project URL + service role key from Settings > API

**Option B: AWS RDS / Aurora**
1. Create RDS Postgres 15+ instance
2. Enable pgvector: `CREATE EXTENSION vector;`
3. Run setup.sql via psql: `psql $DATABASE_URL -f setup.sql`

**Option C: Docker (local dev)**
```bash
docker run -d --name traqrdb \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  pgvector/pgvector:pg16
psql postgresql://postgres:postgres@localhost:5432/postgres -f setup.sql
```

### 2. Configure Environment

```bash
# Required: Postgres connection
export DATABASE_URL="postgresql://user:pass@host:5432/dbname"
# OR for Supabase:
export SUPABASE_URL="https://xxx.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="eyJ..."

# Embedding provider (choose one)
export OPENAI_API_KEY="sk-..."        # OpenAI ($0.02/1M tokens)
export GOOGLE_API_KEY="AIza..."       # Gemini Embedding 2 (free tier)
# OR neither — entities use name matching, no semantic search

# Optional
export COHERE_API_KEY="..."           # Cohere Rerank v3.5
```

### 3. Connect to Your AI Agent

Add to your MCP client config (Claude Code, Cursor, etc.):
```json
{
  "traqr-memory": {
    "command": "npx",
    "args": ["traqr-memory-mcp"],
    "env": {
      "DATABASE_URL": "postgresql://...",
      "OPENAI_API_KEY": "sk-..."
    }
  }
}
```

### 4. Verify

Use `memory_audit` to check health, then `memory_store` to create your first memory.

---

## 10 MCP Tools

| Tool | Description |
|------|-------------|
| `memory_store` | Remember something. Only content required — everything else auto-derived. |
| `memory_search` | Search memories by meaning. Returns summaries. |
| `memory_read` | Expand a memory by ID. Full content + version history. |
| `memory_enhance` | Deepen understanding. Creates connected memories via triage pipeline. |
| `memory_browse` | Navigate by facet. Domain > category > summaries. Zero embedding cost. |
| `memory_context` | Load task-relevant context — principles, preferences, gotchas. |
| `memory_pulse` | Batch: capture multiple learnings + search + update in one call. |
| `memory_audit` | System health, stats, quality metrics. |
| `memory_archive` | Archive stale content that was once correct. |
| `memory_forget` | Forget incorrect or harmful content permanently. |

## What's Inside

**Schema** (created by `setup.sql`):
- `traqr_memories` — content, embeddings, lifecycle, dual tsvectors
- `memory_relationships` — graph edges between memories
- `memory_entities` — extracted entities with embeddings
- `memory_entity_links` — memory-to-entity junction table
- 12+ indexes including partial HNSW, BM25 GIN, lifecycle
- 10+ RPC functions for search, BM25, temporal, graph, confidence decay

**Intelligence** (in the TypeScript package):
- Multi-strategy retrieval: semantic + BM25 > RRF fusion > optional Cohere rerank
- 3-zone cosine triage: NOOP (>=0.90), ADD (<0.60), borderline (GPT-4o-mini decision)
- Type-aware lifecycle: facts invalidate, preferences supersede, patterns coexist
- Entity extraction: multi-signal canonicalization (name > ILIKE > embedding)
- Quality gate: 3-layer ingestion filter prevents noise

## Graceful Degradation

| Missing | Behavior |
|---------|----------|
| No embedding API key | Entities use name matching. BM25 keyword search works. No vector search. |
| No COHERE_API_KEY | Search uses RRF scores instead of Cohere rerank. |

## TypeScript Library API

```typescript
import { storeMemory, searchMemories, triageAndStore } from '@traqr/memory'

// Store a memory
await storeMemory({ content: 'Always use bun', sourceType: 'manual' })

// Search by meaning
const results = await searchMemories('package manager', { limit: 5 })

// Store with triage (dedup + edges + LLM borderline)
const result = await triageAndStore({ content: '...', sourceType: 'session' })
// result.zone: 'noop' | 'add' | 'borderline'
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` or `SUPABASE_URL` | Yes | Postgres connection |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase only | Service role key |
| `OPENAI_API_KEY` | Recommended | OpenAI embeddings |
| `GOOGLE_API_KEY` | Alternative | Gemini Embedding 2 (free) |
| `COHERE_API_KEY` | No | Cohere Rerank (quality boost) |

## License

Apache-2.0
