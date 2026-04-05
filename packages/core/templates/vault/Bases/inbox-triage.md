# Inbox Triage

Bases view for all unprocessed items in the inbox.

> **Setup:** When Obsidian Bases plugin is installed, convert this to a `.base` file with:
> - View: **table**
> - Source: `00 Inbox/`
> - Sort by: `created` (ascending — oldest first)
> - Columns: title, type, source, created, domain
> - Filter: `status = raw`

## Promotion Workflow

1. Review items in `00 Inbox/`
2. Promote to `10 Wiki/` (change `status: raw` → `status: promoted`)
3. Or archive to `20 Reference/` for stable reference material
