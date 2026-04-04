# @traqr/core

Config schema, template engine, VCS abstraction (GitHub + GitLab), and skill templates for TraqrOS.

This package powers the Traqr developer platform — worktree-based parallel development, 50+ skill templates, Guardian automated PR lifecycle, and detection-first project setup.

## AI-First Setup (Recommended)

The fastest way to set up Traqr is to let your AI assistant do it. Tell Claude:

> "Set up Traqr for my project."

Claude reads this README, detects your environment, writes `.traqr/config.json`, and runs `npx traqr render` to generate everything. No interactive CLI needed.

### How It Works

1. Claude detects your VCS (GitHub/GitLab), framework, and package manager from the repo
2. Claude selects a Golden Path preset matching your environment
3. Claude writes `.traqr/config.json` with the right settings
4. Claude runs `npx traqr render` — generates all skills, scripts, CLAUDE.md, and config files
5. Claude runs `npx traqr render --dry-run` to verify

### Config Schema (for AI agents)

Write this to `.traqr/config.json`:

```json
{
  "version": "2.0.0",
  "project": {
    "name": "my-project",
    "displayName": "My Project",
    "description": "What this project does",
    "repoPath": "/path/to/repo",
    "ghOrgRepo": "org/repo",
    "framework": "nextjs",
    "packageManager": "npm"
  },
  "tier": 2,
  "prefix": "MP",
  "shipEnvVar": "MY_PROJECT_SHIP_AUTHORIZED",
  "sessionPrefix": "my-project",
  "coAuthor": "Claude Opus 4.6",
  "vcs": {
    "provider": "github"
  },
  "slots": { "feature": 3, "bugfix": 1, "devops": 0 },
  "ports": { "main": 3000, "featureStart": 3001, "bugfixStart": 3011 }
}
```

Then run: `npx traqr render`

## Golden Path Presets

| Preset | VCS | Integrations | Tier | Best For |
|--------|-----|-------------|------|----------|
| **GitHub Pro** | GitHub | Linear + Slack + Guardian | 3 | Full automation, open source projects |
| **GitLab Team** | GitLab | GitLab Issues + Console | 2 | Corporate teams, AWS environments |
| **GitLab Minimal** | GitLab | None | 0 | Solo developers, minimal setup |

## VCS Support

TraqrOS works with both GitHub and GitLab out of the box. VCS is auto-detected from your git remote.

```json
{
  "vcs": {
    "provider": "gitlab",
    "projectId": 12345,
    "baseUrl": "https://gitlab.your-company.com",
    "mergeStrategy": "ff"
  }
}
```

| Feature | GitHub | GitLab |
|---------|--------|--------|
| PR/MR creation | `gh pr create` | `glab mr create` |
| Auto-merge | Native | API-driven |
| CI | GitHub Actions | GitLab CI |
| Labels | Additive | Read-append-write |

## Manual Setup (Fallback)

If you prefer an interactive wizard:

```bash
npx traqr init
```

Or non-interactive:

```bash
npx traqr render              # Generate files from config
npx traqr render --dry-run    # Preview without writing
npx traqr render --force      # Overwrite existing files
```

## API

### Config Schema

| Export | Description |
|--------|-------------|
| `TraqrConfig` | Main project configuration type |
| `STARTER_PACK_DEFAULTS` | Preset configs for solo/smart/production/full tiers |
| `resolveConfig(options?)` | Resolve full config from 5-level hierarchy |
| `buildTemplateVars(config)` | Build all template variables from config |
| `getFeatureFlags(config)` | Derive feature flags for conditionals |
| `renderAllTemplates(config)` | Full pipeline: config to rendered files |

### Configuration Hierarchy

Priority (highest wins):
1. Environment variables (`TRAQR_*`, `GUARDIAN_*`)
2. Slot-level overrides (runtime)
3. Project config (`.traqr/config.json`)
4. Organization config (`~/.traqr/config.json`)
5. Built-in defaults

## Templates

50+ `.tmpl` files bundled covering:
- `commands/` — Claude Code slash commands (skills)
- `scripts/` — Shell scripts (aliases, worktree setup, pre-push guard)
- `agents/` — Agent configuration
- `CLAUDE.md.tmpl` — Project instructions
- `settings.json.tmpl` — Claude Code settings

## License

[Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0)
