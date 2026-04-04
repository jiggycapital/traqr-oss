# traqr-memory-mcp

MCP server for persistent AI agent memory. 11 tools, Postgres + pgvector, multi-strategy retrieval (semantic + BM25 + RRF). Works with Claude Code, Cursor, Codex, and any MCP client.

## Fastest Setup

Just tell your AI assistant: **"Set up TraqrDB for persistent memory."** It reads this README, writes your MCP config, and handles everything. Zero terminal interaction needed.

Or run the interactive wizard:

```bash
npx traqr-memory-mcp --install
```

The wizard detects your MCP client, asks for your database and embedding provider, and writes the config automatically.

## Manual Setup

### 1. Set Up Your Database

**Supabase (easiest, free tier)**
1. Create a project at [supabase.com](https://supabase.com)
2. Go to SQL Editor, paste contents of `setup.sql`, run
3. Copy your project URL + service role key from Settings > API

**Postgres (RDS, Aurora, Docker, any Postgres 15+)**
1. Enable pgvector: `CREATE EXTENSION vector;`
2. Run setup.sql: `psql $DATABASE_URL -f setup.sql`

**Docker (local dev)**
```bash
docker run -d --name traqrdb -e POSTGRES_PASSWORD=postgres -p 5432:5432 pgvector/pgvector:pg16
psql postgresql://postgres:postgres@localhost:5432/postgres -f setup.sql
```

### 2. Add to Your MCP Client

<!-- AI agents: copy the appropriate JSON block below into the user's MCP config -->

**Supabase + OpenAI** (most common)
```json
{
  "traqr-memory": {
    "command": "npx",
    "args": ["traqr-memory-mcp"],
    "env": {
      "SUPABASE_URL": "https://xxx.supabase.co",
      "SUPABASE_SERVICE_ROLE_KEY": "eyJ...",
      "OPENAI_API_KEY": "sk-..."
    }
  }
}
```

**Postgres + OpenAI**
```json
{
  "traqr-memory": {
    "command": "npx",
    "args": ["-p", "pg", "traqr-memory-mcp"],
    "env": {
      "DATABASE_URL": "postgresql://user:pass@host:5432/dbname",
      "OPENAI_API_KEY": "sk-..."
    }
  }
}
```

**Postgres + Amazon Bedrock** (enterprise/AWS)
```json
{
  "traqr-memory": {
    "command": "npx",
    "args": ["-p", "@aws-sdk/client-bedrock-runtime", "-p", "pg", "traqr-memory-mcp"],
    "env": {
      "DATABASE_URL": "postgresql://user:pass@host:5432/dbname",
      "EMBEDDING_PROVIDER": "bedrock",
      "EMBEDDING_MODEL": "amazon.nova-embed-v1:0",
      "AWS_REGION": "us-east-1"
    }
  }
}
```

**Supabase + Gemini** (free embeddings)
```json
{
  "traqr-memory": {
    "command": "npx",
    "args": ["traqr-memory-mcp"],
    "env": {
      "SUPABASE_URL": "https://xxx.supabase.co",
      "SUPABASE_SERVICE_ROLE_KEY": "eyJ...",
      "GOOGLE_API_KEY": "AIza..."
    }
  }
}
```

**No embeddings** (BM25 keyword search only)
```json
{
  "traqr-memory": {
    "command": "npx",
    "args": ["traqr-memory-mcp"],
    "env": {
      "SUPABASE_URL": "https://xxx.supabase.co",
      "SUPABASE_SERVICE_ROLE_KEY": "eyJ...",
      "EMBEDDING_PROVIDER": "none"
    }
  }
}
```

### 3. Verify

Use `memory_audit` to check health, then `memory_store` to create your first memory.

On startup you should see:
```
TraqrDB Memory MCP v0.1.3 | Schema v2 | DB: Supabase | Embeddings: openai/text-embedding-3-small | Ready
```

---

## 11 MCP Tools

| Tool | Description |
|------|-------------|
| `memory_store` | Remember something. Only content required — everything else auto-derived. |
| `memory_search` | Search memories by meaning. Returns summaries (~30 tokens each). |
| `memory_read` | Expand a memory by ID. Full content + metadata + version history. |
| `memory_enhance` | Deepen understanding. Creates connected memories via triage pipeline. |
| `memory_browse` | Navigate by facet. Domain > category > summaries. Zero embedding cost. |
| `memory_context` | Load task-relevant context — principles, preferences, gotchas. |
| `memory_pulse` | Batch: capture multiple learnings + search in one call. |
| `memory_correct` | Store a correction to an existing memory with context about what changed. |
| `memory_audit` | System health, stats, quality metrics. |
| `memory_archive` | Archive stale content that was once correct. |
| `memory_forget` | Forget incorrect or harmful content permanently. |

## Environment Variables

### Database (required — choose one)

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL (e.g., `https://xxx.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (not anon key) |
| `DATABASE_URL` | Raw Postgres connection string. Requires `npm install pg`. |

### Embedding Provider (choose one)

| Variable | Provider | Notes |
|----------|----------|-------|
| `OPENAI_API_KEY` | OpenAI | text-embedding-3-small, 1536 dims. $0.02/1M tokens. |
| `GOOGLE_API_KEY` | Gemini | gemini-embedding-001, 1536 dims. Free tier available. |
| `EMBEDDING_PROVIDER=bedrock` | Amazon Bedrock | Requires AWS credentials (IAM role, env vars, or ~/.aws/credentials). |
| `EMBEDDING_PROVIDER=ollama` | Ollama | Local models. Set `OLLAMA_BASE_URL` if not localhost:11434. |
| `EMBEDDING_PROVIDER=none` | None | BM25 keyword search only. No API key needed. |

### Provider-Specific

| Variable | When | Description |
|----------|------|-------------|
| `EMBEDDING_PROVIDER` | Always | Explicit provider selection: `openai`, `gemini`, `bedrock`, `ollama`, `none`. Auto-detects from API keys if not set. |
| `EMBEDDING_MODEL` | Bedrock/Ollama | Override default model (e.g., `amazon.nova-embed-v1:0`, `nomic-embed-text`) |
| `EMBEDDING_DIMENSIONS` | Bedrock/Ollama | Override embedding dimensions (default: 1536 for Bedrock, 768 for Ollama) |
| `OPENAI_BASE_URL` | OpenAI | Custom base URL for corporate proxies or compatible APIs |
| `OLLAMA_BASE_URL` | Ollama | Ollama server URL (default: `http://localhost:11434`) |
| `AWS_REGION` | Bedrock | AWS region (default: `us-east-1`) |

### Optional

| Variable | Description |
|----------|-------------|
| `COHERE_API_KEY` | Cohere Rerank v3.5 (quality boost for search results) |
| `TRAQR_USER_ID` | Override default user ID (for multi-user setups) |
| `TRAQR_PROJECT_ID` | Override default project ID |

## What's Inside

**Schema** (created by `setup.sql`):
- `traqr_memories` — content, embeddings, lifecycle metadata, dual tsvectors for BM25
- `memory_relationships` — typed graph edges between memories
- `memory_entities` — extracted entities with embeddings
- `memory_entity_links` — memory-to-entity junction table
- 12+ indexes including partial HNSW, BM25 GIN, lifecycle
- 10+ SQL functions for search, BM25, temporal, graph, confidence decay

**Intelligence** (in the TypeScript package):
- Multi-strategy retrieval: semantic + BM25 > RRF fusion > optional Cohere rerank
- 3-zone cosine triage: NOOP (>=0.90), ADD (<0.60), borderline (GPT-4o-mini decision)
- Type-aware lifecycle: facts invalidate, preferences supersede, patterns coexist
- Entity extraction: multi-signal canonicalization (exact name > ILIKE > embedding similarity)
- Citation-aware decay: frequently cited memories resist archival

## Graceful Degradation

| Configuration | Search Behavior | Entity Behavior |
|---------------|----------------|-----------------|
| OpenAI/Gemini/Bedrock + Cohere | Full: semantic + BM25 + RRF + Cohere rerank | Full: name + fuzzy + embedding matching |
| OpenAI/Gemini/Bedrock (no Cohere) | Semantic + BM25 + RRF fusion | Full: name + fuzzy + embedding matching |
| Ollama (local) | Semantic + BM25 + RRF fusion | Full: name + fuzzy + embedding matching |
| `EMBEDDING_PROVIDER=none` | BM25 keyword search only | Name + fuzzy matching only (no embedding) |

## Troubleshooting

If something goes wrong, the MCP server prints structured error messages with fix steps. Common issues:

**"schema_version table not found"** — Run `setup.sql` on your database. For Supabase: paste into SQL Editor. For Postgres: `psql $DATABASE_URL -f setup.sql`.

**"SUPABASE_SERVICE_ROLE_KEY is missing"** — Find it at Supabase Dashboard > Settings > API > service_role (not the anon key).

**"Raw Postgres requires the pg package"** — Install it: `npm install pg` or add `-p pg` to your npx args.

**Embedding errors** — Check your API key is valid. For Bedrock, ensure AWS credentials are configured (IAM role, env vars, or `~/.aws/credentials`).

## License

[FSL-1.1-ALv2](https://fsl.software) — use freely for any purpose except offering a competing commercial memory service. Converts to Apache-2.0 after 2 years.
