# Traqr — AI That Remembers You

Open-source CLI for [Claude Code](https://claude.com/claude-code) that makes you 10x more productive.

**One dev. Two apps. 1,660 users. Built in weeks, not months.**

## What Traqr Does

- **Worktree slots** — parallel development branches with isolated ports
- **Guardian** — autonomous CI/CD that rebases, merges, and deploys your PRs
- **Memory system** — persistent AI memory that survives across sessions (pgvector + MCP)
- **Skill templates** — `/ship`, `/sync`, `/resync`, `/doctor` and more
- **Raqr mascot** — your raccoon sidekick with mood-based ASCII art

## Quick Start

```bash
npx @traqr/cli init
```

This runs an interactive wizard that:
1. Detects your project type and framework
2. Lets you choose a starter pack (solo → full)
3. Sets up worktree slots for parallel development
4. Configures Claude Code with skills, hooks, and memory
5. Generates CLAUDE.md with project-specific intelligence

## Packages

| Package | Description |
|---------|-------------|
| [@traqr/core](packages/core) | Config schema, template engine, 50+ skill templates |
| [@traqr/cli](packages/cli) | CLI entry point with init wizard, status, render commands |

## Starter Packs

| Pack | Tier | What You Get |
|------|------|--------------|
| Solo | 0 | Parallel workspaces, clean git workflow |
| Smart | 2 | + Project memory, issue tracking |
| Production | 3 | + Team notifications, error tracking, analytics |
| Full | 4 | + Autonomous agents, full ops, everything on |

## Traqr Cloud (Coming Soon)

Hosted memory + webhook hub + feedback pipeline at [traqr.dev](https://traqr.dev).

- **Free**: CLI + local memory (1,000 memories)
- **Indie ($19/mo)**: Hosted memory, Slack bot, feedback pipeline
- **Builder ($49/mo)**: Multiple projects, email automation, dashboard
- **Team ($29/seat/mo)**: Shared memory, multi-user slots

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and contribution guidelines.

## License

MIT — see [LICENSE](LICENSE)

---

Built by [Traqr Enterprises LLC](https://traqr.dev) with Claude Code.
