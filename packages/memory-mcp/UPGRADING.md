# Upgrading TraqrDB

## Version Compatibility

| MCP Server | Required Schema | Upgrade Script |
|-----------|----------------|----------------|
| 0.1.x     | v2             | (initial setup.sql) |
| 0.2.x     | v3             | upgrade-v3.sql |

## How to Upgrade

1. Update the npm package:
   ```bash
   npm update traqr-memory-mcp
   ```

2. The MCP server will warn on startup if your schema needs upgrading:
   ```
   TraqrDB: Schema v2 detected, v3 required.
   Run upgrade-v3.sql on your database. See UPGRADING.md.
   ```

3. Run the upgrade script on your database:
   - **Supabase:** Paste `upgrade-v3.sql` into SQL Editor at supabase.com/dashboard
   - **Postgres:** `psql $DATABASE_URL -f node_modules/traqr-memory-mcp/upgrade-v3.sql`

4. Restart the MCP server. The startup line should now show the new schema version.

## Gotcha: the `npx` cache can freeze you at a stale version

Most MCP clients launch this server via **`npx -y traqr-memory-mcp`** (see your
client config, e.g. `~/.claude.json` → `mcpServers`), **not** via a local
`npm install`. That changes how upgrades take effect:

- With an **unpinned** spec (`traqr-memory-mcp`, no `@version`), npx resolves the
  dependency tree **once**, caches it under `~/.npm/_npx/<hash>/node_modules/`,
  and on later spawns **reuses the cache without re-checking the registry**. New
  publishes never load — you can run week-old code while believing your merges
  and `npm update` took effect. (This bit the whole Traqr fleet 2026-06-07 →
  06-14: ~7-day-stale memory code ran fleet-wide while every published fix sat
  unloaded. See `docs/claude/proxy-invariant.md` § Distribution layer.)

**`npm update` does NOT fix this** — it updates a local `node_modules`, but the
npx launcher reads from the separate `_npx` cache.

**Fixes (either works):**

1. **Clear the npx cache** so the next spawn re-resolves to the latest publish:
   ```bash
   rm -rf ~/.npm/_npx/*           # or just the specific <hash> dir holding it
   ```
2. **Pin `@latest` in your MCP config** so npx re-checks the registry every
   spawn (no freeze, at the cost of one registry round-trip per cold start):
   ```jsonc
   "args": ["-y", "traqr-memory-mcp@latest"]
   ```

**Either way, restart your MCP client.** An already-running server keeps the
stale code in memory until the client session (e.g. Claude Code) restarts — a
cache clear only takes effect on the next process spawn.

## Schema Version Policy

- **Patch updates** (0.1.x) never change the database schema
- **Minor updates** (0.x.0) may require running an upgrade script
- Upgrade scripts are safe to re-run (idempotent)
- The MCP server warns but does not crash on schema mismatch — tools that work on the old schema still function

## Finding Upgrade Scripts

Upgrade scripts ship inside the npm package:
```bash
ls node_modules/traqr-memory-mcp/upgrade-*.sql
```

Or check the [releases page](https://github.com/jiggycapital/traqr-oss/releases) for changelogs.
