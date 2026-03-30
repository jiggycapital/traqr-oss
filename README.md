# Traqr Monorepo

Multi-app monorepo for companion apps and internal tooling, managed via npm workspaces.

## Apps

| App | Directory | Description |
|-----|-----------|-------------|
| NookTraqr | `apps/nooktraqr` | Animal Crossing: New Horizons island management |
| PokoTraqr | `apps/pokotraqr` | Pokopia companion app |
| PokeTraqr | `apps/poketraqr` | Pokemon tracking app |
| MilesTraqr | `apps/milestraqr` | Nook Miles tracking app |
| Traqr Platform | `apps/platform` | Internal platform APIs and admin tooling |
| Traqr Site | `apps/traqr-site` | Marketing site at traqr.dev |
| Jiggy Capital | `apps/jiggy-capital` | Jiggy Capital app |

## Packages

| Package | Language | Description |
|---------|----------|-------------|
| `@traqr/core` | TypeScript | Config schema, types, template engine |
| `@traqr/daemon` | TypeScript | Orchestrator, slot management, Guardian |
| `@traqr/guardian` | TypeScript | PR merge lifecycle plugin |
| `@traqr/memory` | TypeScript | Vector DB client, memory HTTP server |
| `@traqr/cli` | TypeScript | CLI entry point (`traqr` binary) |
| `@traqr/server` | TypeScript | Unified HTTP server |
| `@pokotraqr/data` | TypeScript | Pokopia game data (scrapers + typed JSON) |
| `@poketraqr/data` | TypeScript | Pokemon game data |
| `traqr-mesh` (Go) | Go | Agent mesh TUI |
| `traqr-mesh` (Rust) | Rust | Agent mesh TUI (Rust rewrite) |

## Quick Start

```bash
npm install                                  # install all workspace deps
npm run build --workspace=@traqr/core        # build a specific package
npm run dev --workspace=apps/nooktraqr       # run a specific app
```

See `CLAUDE.md` for full development workflow, slot system, and conventions.
