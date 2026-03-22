# @traqr/cli

CLI entry point for the Traqr platform. Interactive setup wizard, template rendering, and server management.

## Quick Start

```bash
# Initialize a new project
npx traqr init

# Re-render templates after config changes
npx traqr render

# Check config and service health
npx traqr status
```

## Commands

### `traqr init`

Interactive project setup wizard:
1. Detects git remote, package manager, framework
2. Prompts for project name, description, GitHub org/repo
3. Choose a starter pack (solo/smart/production/full)
4. Renders all templates and writes to disk
5. Creates `.traqr/config.json`

### `traqr render`

Non-interactive template render from `.traqr/config.json`.

```bash
traqr render              # Write files (skip existing)
traqr render --dry-run    # Print to stdout
traqr render --force      # Overwrite existing files
```

### `traqr daemon`

Start the daemon orchestrator server.

```bash
traqr daemon              # Default port 4200
traqr daemon --port 4201  # Custom port
```

### `traqr memory`

Start the memory vector DB server.

```bash
traqr memory              # Default port 4100
traqr memory --port 4101  # Custom port
```

Requires: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`

### `traqr guardian`

Stub — Guardian requires dependency injection. Use `GuardianPlugin` as a library via `@traqr/daemon`.

### `traqr status`

Show project config summary and ping running services.

```bash
traqr status
# Project: NookTraqr
# Config:  /path/to/.traqr/config.json
# Tier:    4 (full)
# Score:   87/100
#   Daemon: UP
#   Memory: UP
```

## Programmatic API

```typescript
import { writeFiles } from '@traqr/cli'

const result = await writeFiles(files, baseDir, { dryRun: false, force: true })
console.log(`Written: ${result.written.length}, Skipped: ${result.skipped.length}`)
```
