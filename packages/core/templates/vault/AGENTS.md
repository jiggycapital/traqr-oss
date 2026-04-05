# Agent Instructions

Standing instructions for Claude agents working in this vault.

## Write Conventions

- **Always add frontmatter** to new files:
  ```yaml
  ---
  type: brief | research | clip | decision | canvas | call-log | client | contact
  source: agent | clipper | human
  created: YYYY-MM-DD
  domain: pokotraqr | nooktraqr | platform | life | jiggy
  status: raw | reviewed | promoted
  tags: [relevant, tags]
  ---
  ```

- **Write to `00 Inbox/`** — never directly to `10 Wiki/` or `20 Reference/`
- **Use `[[wikilinks]]`** for cross-references between notes
- **Use filesystem for reads** (ripgrep for search, direct file reads) — faster than CLI
- **Use Obsidian CLI for writes** that need backlink resolution

## Folder Structure

| Folder | Purpose | Who Writes |
|--------|---------|-----------|
| `00 Inbox/` | Landing zone for all new content | Agents + Web Clipper |
| `10 Wiki/` | Curated, promoted knowledge | Human only |
| `20 Reference/` | Stable reference material | Human only |
| `80 Canvas/` | Visual maps and diagrams | Agents |
| `90 Bases/` | Database views over vault | Setup once |
| `CRM/` | Client and consulting records | Agents (/call skill) |
| `Projects/` | Research project folders | Agents (/einstein) |
