# Work Laptop Autonomous Mode — Bootstrap Bundle V1

A self-contained markdown packet that brings up **autonomous mode** on a fresh Claude-Code-on-Bedrock instance.

## What this is

This bundle teaches a Claude instance how to operate without constant human steering — the "autonomous mode" pattern where the agent picks meaningful work, executes, captures learnings, and continues — instead of waiting for the next human prompt.

Nine short docs. Read them in order on first session. Re-reference them later as needed.

## How to use it

**On the work laptop, first session:**
1. Save this folder somewhere readable by your agent shell (e.g. into your project's `docs/` or your Obsidian vault).
2. In your first Claude session, ask: *"Read every file in `<path-to-this-folder>/` and tell me what autonomous mode is, then enter it."*
3. The agent will load the eight docs, understand the operating model, and begin running on the autonomous-mode pattern.

**Per session:**
- `/loop 30m bethesda` — the autonomous heartbeat. The agent will re-fire every 30 minutes, find work, do it, and continue.
- Read `02-obsidian.md` to set up the collaboration vault structure before the first cascade.
- Read `07-privacy.md` BEFORE doing any work that might involve sensitive data.

## Contents

| File | Purpose |
|---|---|
| `00-overview.md` | The mental model. Why autonomous mode exists and what it produces. |
| `01-bethesda.md` | The Bethesda Mode cycle — the core compound-exploration pattern. |
| `02-obsidian.md` | Obsidian as collaboration surface. Vault layout. Diaries. Town Square. |
| `03-loop.md` | The `/loop` cadence pattern. The tool-call-first response rule. |
| `04-mcp-mapping.md` | MCP surface inventory. Substitution table for personal vs work surfaces. |
| `05-gitlab.md` | GitLab Issues replaces Linear at work. Workflow adaptations. |
| `08-cross-tool.md` | AGENTS.md vs CLAUDE.md — which instruction file is canonical. Day-1 decision. |
| `06-role-workflows.md` | Sales role example workflows. *(STUBBED — confirm role title first.)* |
| `07-privacy.md` | IT-leak guardrails. What never leaves the work surface. |

Read order: `00` → `01` → `02` → `03` → `04` → `05` → `08` → `06` → `07`. (`08` was added in the convergence pass; it reads with the tooling-setup docs, so the file number trails the read position.)

## Provenance

Built from the personal-Traqr operating model (Sean's home setup) and adapted for the work-laptop constraints (Bedrock, GitLab, Salesforce + Outlook MCPs, no Linear, no Slack). Intentionally vendor-neutral and free of personal-infra identifiers — safe to share, safe to audit.

## Version

V1 — 2026-05-20. Maintained in `packages/core/bootstrap/work-laptop-autonomous-mode-v1/` of the personal TraqrOS repo. Subsequent versions land as `v2`, `v3`, etc.
