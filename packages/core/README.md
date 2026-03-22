# @traqr/core

Config schema, template engine, configuration resolver, and template bundling for the Traqr platform.

## Quick Start

```typescript
import {
  STARTER_PACK_DEFAULTS,
  buildTemplateVars,
  renderAllTemplates,
  resolveConfig,
} from '@traqr/core'

// Render all templates for a config
const result = await renderAllTemplates(config)
console.log(Object.keys(result.files)) // output paths

// Resolve config from 5-level hierarchy
const resolved = resolveConfig({ projectRoot: '.' })
```

## API

### Config Schema

| Export | Description |
|--------|-------------|
| `TraqrConfig` | Main project configuration type |
| `DaemonConfig` | Daemon orchestration config type |
| `GuardianConfig` | Guardian merge config type |
| `STARTER_PACK_DEFAULTS` | Preset configs for solo/smart/production/full tiers |
| `getDefaultDaemonConfig(name)` | Build default daemon config for a project |
| `DEFAULT_GUARDIAN_CONFIG` | Default guardian configuration |
| `calculateAutomationScore(config)` | Compute 0-100 automation score |

### Template Engine

| Export | Description |
|--------|-------------|
| `TemplateVars` | Type for all template variables |
| `generateSlots(config)` | Derive slot list from config |
| `buildTemplateVars(config)` | Build all template variables from config |
| `getFeatureFlags(config)` | Derive feature flags for conditionals |
| `validateTemplate(template, vars)` | Check for unknown `{{VAR}}` placeholders |
| `renderTemplate(template, vars, tier, flags)` | Render a single template string |

### Template Loader

| Export | Description |
|--------|-------------|
| `getTemplatesDir()` | Absolute path to bundled `templates/` directory |
| `listTemplates(dir?)` | List all `.tmpl` files recursively |
| `loadTemplate(path, dir?)` | Read a single template by relative path |
| `templateToOutputPath(path, prefix)` | Map template path to output path |
| `shouldIncludeTemplate(path, tier, flags)` | Tier-gating logic |
| `renderAllTemplates(config, dir?)` | Full pipeline: config to rendered files |
| `RenderResult` | Type: `{ files: Record<string, string>, warnings: string[] }` |

### Config Resolver

| Export | Description |
|--------|-------------|
| `OrgConfig` | Org-level config type (`~/.traqr/config.json`) |
| `ResolvedConfig` | Fully resolved config with daemon/guardian guaranteed |
| `deepMerge(target, source)` | Deep merge utility |
| `loadOrgConfig()` | Load org config from `~/.traqr/config.json` |
| `loadProjectConfig(root?)` | Load project config from `.traqr/config.json` |
| `resolveConfig(options?)` | Resolve full config from 5-level hierarchy |
| `printConfigSummary(config)` | Human-readable config summary string |

## Configuration Hierarchy

Priority (highest wins):
1. Environment variables (`TRAQR_*`, `GUARDIAN_*`)
2. Slot-level overrides (runtime)
3. Project config (`.traqr/config.json`)
4. Organization config (`~/.traqr/config.json`)
5. Built-in defaults

## Templates

50 `.tmpl` files bundled in `templates/` covering:
- `commands/` — Claude Code slash commands
- `scripts/` — Shell scripts (aliases, worktree setup, pre-push guard)
- `agents/` — Agent configuration
- `CLAUDE.md.tmpl` — Project instructions
- `settings.json.tmpl` — Claude Code settings
