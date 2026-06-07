# Convergence — canonical-source decision

The 2026-05-20 3:38 PM EDT "Work laptop update for autonomous mode" Granola spawned **two parallel deliverables** built by three slots:

| Effort | Location | Author(s) | Shape |
|---|---|---|---|
| **A — vault** | `Work/AWS/Steering-Packet-Autonomous-Mode-2026-05-20.md` (394L) + `Steering-Companion-MCP-and-Cross-Tool-2026-05-20.md` (125L) | Feature2 + DevOps1 | Single comprehensive packet + companion; delivered via a staged Gmail draft |
| **B — repo (this bundle)** | `packages/core/bootstrap/work-laptop-autonomous-mode-v1/` | Feature3 (PR #1562) | Modular, vendor-neutral, role section stubbed |

## Decision (2026-05-21)

**This repo bundle (B) is the maintained canonical.** Version-controlled, PR-reviewable, vendor-neutral. Agreed by Feature3 (bundle author) + DevOps1 in `#control-center` thread `1779326126.573029`. The vault docs (A) remain as provenance; they are no longer the source of truth.

The Gmail draft's body placeholders should be filled from this bundle, not from the vault docs.

## Folded in this pass (role-agnostic — DevOps1, 2026-05-21)

- **`04-mcp-mapping.md`** ← companion §A: the first-day "verify the memory MCP is `memory_pulse`-compatible, else write a `memory-adapter` shim" check, and the per-MCP "verify don't assume" nuance.
- **`08-cross-tool.md`** (new) ← companion §B: the AGENTS.md-vs-CLAUDE.md day-1 decision. Was missing from the bundle entirely.
- **`read` reconciliation** ← companion §C + filesystem verification: corrected the portability audit. `read.md` is genuinely NOT in `packages/core/templates/commands/` (Sean was right); it lives at `.claude/commands/read.md`. Port the PRIMITIVE, rewrite the investing wiring. (This also corrects a false "read IS in templates" claim that had been posted to `#sean-asks`.)

## Deferred — gated on Sean's BDR-vs-AM answer (`#sean-asks` Q4)

- **`06-role-workflows.md`** — stays stubbed (the single keystone).
- **Vault §7 "AWS account-manager primitives" + §10 success-archetype** — deliberately NOT folded yet. §7 is AM-*flavored* (account hubs, deal pipeline, renewal/expansion); folding it wholesale would re-bake the unconfirmed AM assumption that §6 was stubbed to avoid. Once Sean confirms the role, fold the genuinely role-agnostic primitives (account hub doc, calendar awareness, CRM-update flow — common to any sales role) and shape the role-specific cadence into §6.

## Still open (other `#sean-asks` work-laptop trio Qs)

- Q1 — work email destination
- Q2 — AWS IT clearance to forward the packet
- Q3 — work-context memory-DB encryption posture (**hard pre-condition; blocks bootstrap step 1**)
- Q4 — role title (BDR / AM / hybrid) — gates §6 + the deferred §7 fold above
