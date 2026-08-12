# @traqr/cli

CLI for the TraqrOS developer platform. Project initialization, template rendering, and service health checks.

Most users don't need to run CLI commands directly — Claude reads the [@traqr/core](https://www.npmjs.com/package/@traqr/core) README and sets up your project automatically. The CLI is a manual fallback for users without AI assistants.

## Commands

### `traqr render` (AI-First Path)

Non-interactive template generation from `.traqr/config.json`. This is what Claude runs after writing your config.

```bash
npx traqr render              # Generate all files (skip existing)
npx traqr render --dry-run    # Preview without writing
npx traqr render --force      # Overwrite existing files
```

### `traqr init` (Interactive Fallback)

Interactive project setup wizard for manual configuration:

1. Detects git remote, package manager, framework
2. Prompts for project name, description, org/repo
3. Choose a starter pack (solo/smart/production/full)
4. Renders all templates and writes to disk
5. Creates `.traqr/config.json`

```bash
npx traqr init
```

### `traqr status`

Show project config summary and check running services.

```bash
npx traqr status
# Project: My Project
# Config:  /path/to/.traqr/config.json
# Tier:    2 (smart)
# Score:   65/100
```

## Programmatic API

```typescript
import { writeFiles } from '@traqr/cli'

const result = await writeFiles(files, baseDir, { dryRun: false, force: true })
console.log(`Written: ${result.written.length}, Skipped: ${result.skipped.length}`)
```

## License

[Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0)
