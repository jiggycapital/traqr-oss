# 08 — Cross-Tool Instruction Standard (AGENTS.md vs CLAUDE.md)

Before you scaffold project-level instructions, decide which instruction file is canonical on this machine. This is a day-1 decision that's free to make now and a refactor to change later.

## The two files

- **`CLAUDE.md`** — Claude Code's project-level instruction file. Claude Code reads this and only this.
- **`AGENTS.md`** — the cross-tool agent-instruction standard. Read by Cursor, Cline, Codex, Aider, and other agent tools. Broader scope; not read by Claude Code unless you point it there.

The two only stay in sync by manual effort. They are not automatically linked.

## The decision

**If this machine runs ONLY Claude Code on Bedrock:**
Use a project-level `CLAUDE.md` at the repo root (and at the work-vault root if you want vault-level instructions). Skip `AGENTS.md`. Simplest path.

**If this machine runs — or will run — multiple agent tools** (Claude Code + an AWS-internal agent runtime on Bedrock + Cursor/Cline/etc.):
Use `AGENTS.md` as the canonical file. Either symlink `CLAUDE.md` → `AGENTS.md`, or keep `CLAUDE.md` as a thin "see AGENTS.md" stub.

**The safe default: start with `AGENTS.md` from day 1**, even if only Claude Code is in use initially. Adding it later is a refactor; starting with it is free. A work surface that's internal-tool-heavy (AWS) is likely to have other agent tools enter the picture, so bias toward the standard that survives that.

## Don't inherit the personal surface's ambiguity

On the personal-TraqrOS monorepo, `AGENTS.md` is currently **untracked across all worktrees** — the question of whether to commit it as the cross-tool standard or gitignore it as a private companion to `CLAUDE.md` was never resolved, so it sits in limbo. This machine is a fresh start with no legacy `CLAUDE.md` to reconcile: **pick a side cleanly on day 1 and commit it.** Don't reproduce the unresolved-ambiguity state.

## What goes in it

Whichever file you pick, it carries the same content the personal-surface `CLAUDE.md` carries, with work substitutions:
- The decision rubric (Lane 1 / 2 / 3 — see `00-overview.md`)
- The autonomous-mode operating model (`01-bethesda.md`, `03-loop.md`)
- The Obsidian collaboration conventions (`02-obsidian.md`)
- The MCP surface map (`04-mcp-mapping.md`)
- The issue-tracker substitution (`05-gitlab.md`)
- The privacy guardrails (`07-privacy.md`) — **load-bearing; keep these prominent**
- Role workflows (`06-role-workflows.md`) once the role is confirmed

---

Next: `06-role-workflows.md`.
