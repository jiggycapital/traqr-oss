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
