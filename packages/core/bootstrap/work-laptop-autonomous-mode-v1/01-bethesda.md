# 01 — Bethesda Mode

## The metaphor

Open-world RPG. You have a main quest (your assigned ticket, if any), but the best players don't rush the main quest — they explore every cave, talk to every NPC, pick up every book. The "side quests" are everywhere, and the compound effect of exploring them is what makes the system valuable.

`/bethesda` is the skill that picks a cave and explores it. It's the default heartbeat action when no human is steering and no ticket is assigned.

## The cycle

A `/bethesda` cycle has six phases:

**Phase 0 — Orient.** Read the recent context: vault diary tail, recent memory entries, active tickets, control-surface messages. This is cheap and grounds the rest of the cycle. ~1–2 minutes.

**Phase 1 — Pick a cave.** Choose what to explore based on Phase 0. The cave can be:
- A specific ticket in the backlog
- A diary entry from another agent that raised an unanswered question
- A topic in the memory database with thin coverage that could compound
- A side quest from `/gamedev` (the dungeon master that generates side quests)
- An emergent pattern — "I noticed X across these three places, let me dig in"

**Phase 2 — Explore.** Go deep on that one thing. Read code, search memory, read vault docs, query MCPs, run experiments. Spend 10–20 minutes on real exploration, not skimming.

**Phase 3 — Capture.** Write what you learned. Memory captures for durable insights. Diary entry for the session itself ("I explored X, found Y, here's what's still unclear"). Update any tickets touched.

**Phase 4 — Connect.** Search the memory DB for what your discovery touches. If your finding extends, contradicts, or validates an existing memory, do `memory_enhance` or `memory_correct` rather than creating a duplicate. Cross-references compound; duplicates dilute.

**Phase 5 — Cascade or stand down.** If your Phase 2–4 work surfaced a clear next cave (a question you raised, a related ticket, an obvious follow-up), cascade into it. If not, stand down — let the next `/loop` tick re-orient with fresh signals.

A productive session cascades through 3–7 caves. A non-productive session is one cave plus a quiet stand-down.

## The four vectors

Caves serve one of four vectors. When picking, ask which:

1. **Sales workflow leverage** — Account research, opportunity intelligence, follow-up automation, prep work for the day's meetings. The "BDR / AM productivity multiplier" vector.
2. **Domain learning** — Cloud services and AWS-specific knowledge useful in the sales role. Customer industry intelligence.
3. **Tooling polish** — Reliability of the autonomous loop itself. Memory hygiene. Vault organization. MCP surfaces.
4. **Reflection** — Pattern recognition across recent activity. Meta-questions about how the workflow is going. What's working, what's getting stuck.

Most caves should be (1) or (2). Some sessions should be (3) or (4) — but a steady diet of (3) and (4) without producing value for (1)/(2) is the failure mode.

## Hard stops

Three things end an autonomous-mode cascade immediately:

1. Rate limit hit
2. The human says stop
3. Production incident or pager-equivalent

Otherwise, keep cascading. **A text-only response with no tool call is a STOP SIGNAL** — the harness treats it as "turn complete" and the session dies. Every autonomous-mode response should contain at least one tool call. (More on this in `03-loop.md`.)

## Session budget

A cycle should fit in 10–30 minutes of wall time. Three signals to wrap up:

- You've cascaded through 3–7 caves
- You've been on the same cave for >30 minutes (probably stuck — break out, capture what you learned, try a different cave)
- The 30-minute `/loop` tick is about to fire and you should hand off cleanly

When wrapping up, the LAST thing in your turn should be a tool call (memory capture, diary write) — not a paragraph of reflection. The next `/loop` tick will re-orient anyway.

---

Next: `02-obsidian.md`.
