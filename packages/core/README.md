# @traqr/core

Config schema, template engine, VCS abstraction (GitHub + GitLab), and skill templates for TraqrOS.

TraqrOS is the AI-powered developer platform — worktree-based parallel development, persistent memory via [traqr-memory-mcp](https://www.npmjs.com/package/traqr-memory-mcp), 50+ skill templates, Guardian automated PR lifecycle, and detection-first project setup.

## AI-First Setup (Recommended)

The fastest way to set up Traqr is to let your AI assistant do it:

> "Set up Traqr for my project."

Claude reads this README, detects your environment, writes `.traqr/config.json`, and runs `npx traqr render` to generate everything. No interactive CLI needed.

### How It Works

1. Claude detects your VCS (GitHub/GitLab), framework, and package manager from the repo
2. Claude selects a Golden Path preset matching your environment (see decision tree below)
3. Claude writes `.traqr/config.json` with the right settings
4. Claude runs `npx traqr render` — generates CLAUDE.md, worktree slots, skills, and scripts
5. Claude verifies with `npx traqr render --dry-run`
6. If memory enabled (tier 2+): Claude sets up [traqr-memory-mcp](https://www.npmjs.com/package/traqr-memory-mcp)

### Installation Sequence

```bash
# 1. Install the package
npm install @traqr/core

# 2. Detect your environment (Claude does this automatically)
git config --get remote.origin.url    # GitHub or GitLab?
cat package.json | grep workspaces    # Monorepo?

# 3. Write .traqr/config.json (use Golden Path example below)

# 4. Generate everything
npx traqr render
npx traqr render --dry-run    # Preview first (recommended)

# 5. Verify success
ls .traqr/                    # Should have config.json, CLAUDE.md, scripts/
cat CLAUDE.md | head -20      # Should show project name

# 6. If memory enabled (tier 2+):
npm install traqr-memory-mcp
npx traqr-memory-mcp --install    # Interactive wizard for DB + MCP config
# Or tell Claude: "Set up TraqrDB for persistent memory"
```

**Time to ready state:** 5-10 minutes for config + render. 15+ minutes if setting up a memory database.

---

## Two Flavors of TraqrOS

TraqrOS comes in two flavors — same packages, same config schema, different Golden Path preset:

| | TraqrOS-Personal | TraqrOS-AWS |
|---|---|---|
| VCS | GitHub | GitLab (cloud or self-hosted) |
| Issues | Linear (paid seats) | GitLab Issues (free) |
| Memory DB | Supabase Postgres | RDS Postgres (AWS CLI provisioned) |
| Embeddings | OpenAI / Gemini | Amazon Bedrock |
| CI/CD | GitHub Actions | GitLab CI |
| Team | Solo or small team | Corporate team (5+) |
| Notifications | Slack | Console / none (corporate policy) |
| Golden Path | `github-pro` | `gitlab-team` |

Both flavors use `@traqr/core` + `traqr-memory-mcp`. The Golden Path preset is the only difference.

---

## Golden Path Presets

### How to Pick Yours

**Step 1: Where's your code?**

```bash
# Claude runs this automatically:
git config --get remote.origin.url
# Contains 'github.com' → GitHub paths
# Contains 'gitlab'     → GitLab paths
# No remote yet         → default to github-pro
```

**Step 2: Decision tree**

```
GitHub.com?
  └─ Yes → github-pro (tier 3, full automation)

GitLab (cloud or self-hosted)?
  └─ Solo developer? → gitlab-minimal (tier 0, zero integrations)
  └─ Team of 2+?     → gitlab-team (tier 2, team automation)

Corporate + AWS + RDS + Bedrock?
  └─ gitlab-team with corporate overrides (see config example below)
```

**Step 3 (optional): Do you have Linear?**
If yes, you can override `issues.provider` to `"linear"` on any Golden Path.

### Preset Comparison

| Preset | VCS | Issues | Memory | Notifications | Tier | Best For |
|--------|-----|--------|--------|---------------|------|----------|
| **github-pro** | GitHub | Linear | Supabase | Slack (standard) | 3 | Full automation, open source, startups |
| **gitlab-team** | GitLab | GitLab Issues | Supabase or RDS | None (console) | 2 | Corporate teams, AWS environments |
| **gitlab-minimal** | GitLab | None | Local (CLAUDE.md only) | None | 0 | Solo developers, minimal setup |

### Tier to Features Mapping

Each tier unlocks more automation:

| Tier | Pack | Slots | Memory | Issues | Notifications | Monitoring | Score |
|------|------|-------|--------|--------|---------------|------------|-------|
| 0 | Solo | 3F + 1B | None | None | None | None | ~25 |
| 2 | Smart | 3F + 2B + 1D | Supabase/RDS | GitHub/GitLab | None | None | ~50 |
| 3 | Production | 3F + 2B + 3D | Supabase | Linear | Slack | Sentry + PostHog | ~75 |
| 4 | Full | 3F + 2B + 3D + G + A | Supabase + voice | Linear | Slack (full) | Full suite | ~95 |

**Relationship:** Golden Path → selects Starter Pack → sets Tier → unlocks features.

---

## Config Examples (Per Golden Path)

Write the appropriate config to `.traqr/config.json`:

### GitHub Pro (TraqrOS-Personal)

For GitHub teams with Linear, Slack, and Supabase memory:

```json
{
  "version": "2.0.0",
  "project": {
    "name": "my-app",
    "displayName": "My App",
    "description": "What this project does",
    "repoPath": "/Users/you/my-app",
    "worktreesPath": "/Users/you/my-app/.worktrees",
    "ghOrgRepo": "yourorg/my-app",
    "framework": "nextjs",
    "packageManager": "npm"
  },
  "tier": 3,
  "starterPack": "production",
  "prefix": "myapp",
  "shipEnvVar": "MYAPP_SHIP_AUTHORIZED",
  "sessionPrefix": "myapp",
  "coAuthor": "Claude Opus 4.6",
  "vcs": { "provider": "github" },
  "slots": { "feature": 3, "bugfix": 2, "devops": 1, "analysis": false },
  "ports": { "main": 3000, "featureStart": 3001, "bugfixStart": 3011, "devopsStart": 3021, "analysis": 3099 },
  "memory": {
    "provider": "supabase",
    "projectSlug": "my-app",
    "crossProject": false
  },
  "issues": {
    "provider": "linear",
    "ticketPrefix": "APP",
    "planDispatch": true,
    "autoLabels": true
  },
  "notifications": {
    "slackLevel": "standard"
  }
}
```

**After writing config:** Run `npx traqr render`, then set up memory with `npx traqr-memory-mcp --install` (picks Supabase + OpenAI by default).

### GitLab Team (TraqrOS-AWS)

For corporate GitLab teams with RDS memory and Bedrock embeddings:

```json
{
  "version": "2.0.0",
  "project": {
    "name": "my-platform",
    "displayName": "My Platform",
    "description": "Internal platform",
    "repoPath": "/home/user/my-platform",
    "worktreesPath": "/home/user/my-platform/.worktrees",
    "ghOrgRepo": "team/my-platform",
    "framework": "nextjs",
    "packageManager": "npm"
  },
  "tier": 2,
  "starterPack": "smart",
  "prefix": "plat",
  "shipEnvVar": "PLAT_SHIP_AUTHORIZED",
  "sessionPrefix": "plat",
  "coAuthor": "Claude Sonnet 4.6",
  "vcs": {
    "provider": "gitlab",
    "projectId": "12345",
    "baseUrl": "https://gitlab.your-company.com",
    "mergeStrategy": "squash",
    "autoMerge": true,
    "removeSourceBranch": true
  },
  "slots": { "feature": 3, "bugfix": 2, "devops": 1, "analysis": false },
  "ports": { "main": 3000, "featureStart": 3001, "bugfixStart": 3011, "devopsStart": 3021, "analysis": 3099 },
  "memory": {
    "provider": "supabase",
    "projectSlug": "my-platform",
    "crossProject": false
  },
  "issues": {
    "provider": "gitlab",
    "ticketPrefix": "PLAT",
    "planDispatch": true,
    "autoLabels": true
  },
  "notifications": {
    "slackLevel": "none"
  }
}
```

**After writing config:** Run `npx traqr render`. For memory, use `npx traqr-memory-mcp --install` and select "Postgres + Bedrock" when prompted. You'll need:
- `DATABASE_URL` — your RDS connection string (ask your DBA or provision via AWS CLI)
- `EMBEDDING_PROVIDER=bedrock` — uses AWS credentials from your environment
- `AWS_REGION` — your team's AWS region

**Finding your GitLab Project ID:** Go to your project page on GitLab → Settings → General → the numeric ID is shown at the top.

### GitLab Minimal (Solo)

For solo developers who want worktrees with zero integrations:

```json
{
  "version": "2.0.0",
  "project": {
    "name": "side-project",
    "displayName": "Side Project",
    "description": "Personal project",
    "repoPath": "/Users/you/side-project",
    "worktreesPath": "/Users/you/side-project/.worktrees",
    "ghOrgRepo": "you/side-project",
    "framework": "nextjs",
    "packageManager": "npm"
  },
  "tier": 0,
  "starterPack": "solo",
  "prefix": "side",
  "shipEnvVar": "SIDE_SHIP_AUTHORIZED",
  "sessionPrefix": "side",
  "coAuthor": "Claude",
  "vcs": { "provider": "gitlab" },
  "slots": { "feature": 2, "bugfix": 1, "devops": 0, "analysis": false },
  "ports": { "main": 3000, "featureStart": 3001, "bugfixStart": 3011, "devopsStart": 3021, "analysis": 3099 }
}
```

**No memory, no issues, no notifications.** Just worktrees + CLAUDE.md + `/ship`. Upgrade later by adding `memory`, `issues`, and `notifications` sections and bumping `tier`.

---

## Team Setup

Once `.traqr/config.json` is committed to the repo, teammates can clone and join.

### For the Team Lead (First Setup)

1. Follow the Installation Sequence above
2. **Commit config to repo:** `git add .traqr/config.json && git commit -m "feat: add TraqrOS config"`
3. **Do NOT commit secrets** — `.claude/mcp.json` contains API keys and stays local

### For Teammate #2+ (Joining an Existing Team)

1. **Clone the repo** — `.traqr/config.json` is already there
2. **Install and render:**
   ```bash
   npm install
   npx traqr render
   ```
3. **Set up memory** (if the team uses it):
   - Ask your team lead for the database connection details
   - Run `npx traqr-memory-mcp --install` and enter the credentials
   - Or create `.claude/mcp.json` manually (see [traqr-memory-mcp](https://www.npmjs.com/package/traqr-memory-mcp) for config examples)
4. **Verify:** Run `/startup` in Claude Code — it should connect to the shared memory DB
5. **Start working:**
   ```bash
   source scripts/<prefix>-aliases.sh
   z1 && claude    # Jump to slot 1, open Claude Code
   ```

### What's Shared vs Personal

| File | Shared (in repo) | Personal (gitignored) |
|------|:-:|:-:|
| `.traqr/config.json` | x | |
| `CLAUDE.md` | x | |
| `.traqr/scripts/` | x | |
| `.claude/mcp.json` | | x |
| `.env.local` | | x |

---

## VCS Support

TraqrOS works with both GitHub and GitLab out of the box. VCS is auto-detected from your git remote.

```json
{
  "vcs": {
    "provider": "gitlab",
    "projectId": "12345",
    "baseUrl": "https://gitlab.your-company.com",
    "mergeStrategy": "squash"
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
npx traqr render --force      # Overwrite existing files (caution: destructive)
```

## API

### Config Schema

| Export | Description |
|--------|-------------|
| `TraqrConfig` | Main project configuration type |
| `GOLDEN_PATH_DEFAULTS` | Preset configs for github-pro, gitlab-team, gitlab-minimal |
| `STARTER_PACK_DEFAULTS` | Preset configs for solo/smart/production/full tiers |
| `resolveConfig(options?)` | Resolve full config from 5-level hierarchy |
| `buildTemplateVars(config)` | Build all template variables from config |
| `getFeatureFlags(config)` | Derive feature flags for conditionals |
| `renderAllTemplates(config)` | Full pipeline: config to rendered files |
| `calculateAutomationScore(config)` | Score 0-100 based on enabled features |

### Configuration Hierarchy

Priority (highest wins):
1. Environment variables (`TRAQR_*`, `GUARDIAN_*`)
2. Slot-level overrides (runtime)
3. Project config (`.traqr/config.json`)
4. Organization config (`~/.traqr/config.json`)
5. Built-in defaults

### CLAUDE.md Template Variables

When `npx traqr render` runs, the CLAUDE.md template receives these variables (all auto-filled from config):

| Variable | Source | Example |
|----------|--------|---------|
| `PROJECT_DISPLAY_NAME` | `config.project.displayName` | "My App" |
| `PROJECT_DESCRIPTION` | `config.project.description` | "Real-time collab platform" |
| `SLOT_TABLE` | Generated from `config.slots` | Markdown table of all slots |
| `PORT_TABLE` | Generated from `config.ports` | Port assignments per slot |
| `REPO_PATH` | `config.project.repoPath` | `/Users/you/my-app` |
| `TICKET_PREFIX` | `config.issues.ticketPrefix` | "APP" |
| `CO_AUTHOR` | `config.coAuthor` | "Claude Opus 4.6" |
| `SHIP_ENV_VAR` | `config.shipEnvVar` | "MYAPP_SHIP_AUTHORIZED" |
| `AUTOMATION_SCORE` | `calculateAutomationScore()` | "72" |

**Conditionals** (sections appear/disappear based on config):

| Conditional | When True |
|-------------|-----------|
| `IF_MONOREPO` | Project has `apps/` directory or workspaces |
| `IF_TIER_1+` | `tier >= 1` |
| `IF_MEMORY_FULL` | `memory.provider === "supabase"` |
| `IF_ISSUES` | `issues.provider !== "none"` |
| `IF_SLACK` | `notifications.slackLevel !== "none"` |

## Templates

50+ `.tmpl` files bundled covering:
- `commands/` — Claude Code slash commands (skills)
- `scripts/` — Shell scripts (aliases, worktree setup, pre-push guard)
- `agents/` — Agent configuration
- `CLAUDE.md.tmpl` — Project instructions
- `ONBOARDING.md.tmpl` — Team onboarding checklist
- `settings.json.tmpl` — Claude Code settings

## Package Relationships

```
User-facing (you install these):
  @traqr/core ──────── config, templates, VCS, skills
  traqr-memory-mcp ─── MCP server for AI memory (11 tools)

Internal (dependencies, don't install directly):
  @traqr/memory ─────── memory DB client (used by MCP server)
  @traqr/cli ────────── CLI commands (depends on core)
  @traqr/daemon ─────── orchestration + Guardian
  @traqr/server ─────── platform API
  @traqr/kv ─────────── key-value store
  @traqr/mesh ────────── inter-agent communication
```

## License

[Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0)
