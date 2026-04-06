# TraqrOS

**AI that remembers you.** Persistent memory, automation, and developer tooling for AI coding assistants.

TraqrOS is the open-source infrastructure layer that gives your AI assistant a real memory system. Store learnings, search by meaning, and build a knowledge base that compounds across sessions. Works with Claude Code, Cursor, Codex, and any MCP client.

## Get Started in 10 Minutes

### TraqrDB (AI Memory)

Give your AI assistant persistent memory. BYO Postgres + any embedding provider.

```bash
npx traqr-memory-mcp --install
```

The install wizard detects your MCP client, asks a few questions, and configures everything. Or let Claude do it — just say "set up TraqrDB" and it handles the rest.

**What you get:** 11 MCP tools for storing, searching, and managing memories. Multi-strategy retrieval (semantic + BM25 + RRF fusion), 3-zone cosine triage, entity extraction, and type-aware lifecycle.

**Database:** Supabase (free tier), AWS RDS, Docker, or any Postgres 15+ with pgvector.

**Embeddings:** OpenAI, Amazon Bedrock, Google Gemini, Ollama (local), or BM25-only (no embeddings).

### Traqr CLI (Full Dev Platform)

Template engine, worktree-based parallel development, 50+ skills, and Guardian automated PR lifecycle.

```bash
npx traqr init
```

Or for AI-first setup, have Claude read the [@traqr/core docs](https://www.npmjs.com/package/@traqr/core), write your `.traqr/config.json`, and run `npx traqr render` — zero interactive prompts needed.

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| [`@traqr/memory`](https://www.npmjs.com/package/@traqr/memory) | TypeScript library — multi-strategy retrieval, entity extraction, BYO Postgres | [![npm](https://img.shields.io/npm/v/@traqr/memory)](https://www.npmjs.com/package/@traqr/memory) |
| [`traqr-memory-mcp`](https://www.npmjs.com/package/traqr-memory-mcp) | MCP server — 11 tools, interactive setup wizard, works with any MCP client | [![npm](https://img.shields.io/npm/v/traqr-memory-mcp)](https://www.npmjs.com/package/traqr-memory-mcp) |
| [`@traqr/core`](https://www.npmjs.com/package/@traqr/core) | Config schema, template engine, VCS abstraction (GitHub + GitLab) | [![npm](https://img.shields.io/npm/v/@traqr/core)](https://www.npmjs.com/package/@traqr/core) |
| [`@traqr/cli`](https://www.npmjs.com/package/@traqr/cli) | CLI — `traqr init`, `traqr render`, `traqr status` | [![npm](https://img.shields.io/npm/v/@traqr/cli)](https://www.npmjs.com/package/@traqr/cli) |

## How It Works

```
TraqrOS (npm packages)          Your Product              Feedback Loop
======================          ============              =============
@traqr/memory                   Your app code             PostHog events
@traqr/core                     Your skills               Slack alerts
@traqr/cli                      Your CLAUDE.md            Memory captures
@traqr/daemon                    Your workflows            Guardian learnings
```

**TraqrOS** is the infrastructure layer — install via npm, configure for your VCS (GitHub or GitLab), and build your product on top. Your code stays yours. TraqrOS handles the automation, memory, and developer experience.

## VCS Support

TraqrOS works with both GitHub and GitLab out of the box:

- **GitHub:** PR automation, GitHub Actions, Linear integration
- **GitLab:** MR automation, GitLab CI, fast-forward merge, rebase-and-retry

VCS is auto-detected from your git remote. No configuration needed.

## License

- **@traqr/memory, traqr-memory-mcp, @traqr/daemon, @traqr/server:** [FSL-1.1-ALv2](./LICENSE) — use freely for any purpose except offering a competing commercial service. Converts to Apache-2.0 after 2 years.
- **@traqr/core, @traqr/cli, @traqr/kv:** [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0)

**What this means:** Install it, use it, modify it, build products on it — all permitted. The only restriction: don't fork it and sell it as a competing memory-as-a-service product.

## Links

- [traqr.dev](https://traqr.dev) — Product site
- [@traqr/memory on npm](https://www.npmjs.com/package/@traqr/memory) — Memory library
- [traqr-memory-mcp on npm](https://www.npmjs.com/package/traqr-memory-mcp) — MCP server
