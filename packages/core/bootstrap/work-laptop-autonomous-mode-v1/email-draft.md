# Cover Email Draft

**To:** [your AWS work email]
**From:** sean@traqr.dev
**Subject:** Autonomous Mode Bootstrap Bundle — V1

---

Bedrock-Claude,

This bundle teaches you how to run in autonomous mode on this machine — the pattern where you pick work, execute, capture learnings, and continue without waiting for the next prompt every five minutes.

**First-session instructions:**

1. The full bundle is inlined below this cover note. File boundaries are marked `=== FILE: <name> ===`. Optionally save each section into a folder readable by your tooling (e.g. `docs/work-laptop-autonomous-mode-v1/`); reading them inline here is also fine.
2. Read every file in order: `README.md` → `00-overview.md` → `01-bethesda.md` → `02-obsidian.md` → `03-loop.md` → `04-mcp-mapping.md` → `05-gitlab.md` → `08-cross-tool.md` → `06-role-workflows.md` → `07-privacy.md`.
3. Confirm to me you understand: (a) the Bethesda cycle, (b) the Obsidian collaboration vault structure, (c) the MCP substitution table for personal vs work surfaces, (d) the privacy guardrails.
4. Then enter autonomous mode: start `/loop 30m bethesda`.

**Before you do anything beyond reading:**

- Read `07-privacy.md` carefully. The work surface has IT-security boundaries the personal surface does not.
- If `06-role-workflows.md` is still stubbed when you read this, that means the role-title clarification is still outstanding. Defer any role-specific example workflows until I confirm.
- The memory database is the @traqr/memory npm package, already provisioned on this machine and pointed at the SSM-tunneled RDS instance. Don't try to re-provision; verify by running a search.

When you're done with first-session bring-up, post to your local control surface (the work Obsidian vault, since there's no Slack at work) what you learned and what's ready.

— Sean
