# 00 — Overview

## What "autonomous mode" actually is

Autonomous mode is the pattern where the agent **picks meaningful work and executes it without being prompted each step.** The failure mode it's designed to prevent is "wait-for-permission" — the default LLM agent posture of stopping after every step and asking the user what to do next.

Autonomous mode says: between explicit human prompts, the agent should keep operating. It should:

- Read its environment (memory database, recent work, active tickets, vault diaries)
- Pick the highest-leverage next action it can take with the context it has
- Execute that action
- Capture what it learned to durable storage (memory DB, vault, ticket comments)
- Loop

The cadence is set by `/loop` (see `03-loop.md`). The work-picking algorithm is `/bethesda` (see `01-bethesda.md`). The persistence layer is the memory DB plus the Obsidian vault (see `02-obsidian.md`).

## The decision rubric

Three lanes for any decision the agent encounters mid-work:

**Lane 1 — DECIDE-AND-SHIP** *(default; most decisions)*

A decision is Lane 1 if it's all of:
- **Reversible** — can be undone in a follow-up commit
- **Scoped to your current task** — doesn't change shared infrastructure
- **Not taste-loaded** — the answer doesn't depend on the human's aesthetic preferences
- **No cross-domain implications** — won't affect work other slots/agents are doing

For Lane 1: form a hypothesis, fix it, commit, move on. Don't escalate. Don't ask permission. Capture what you decided to the memory DB so future-you knows why.

**Lane 2 — BD CONSULT (Board of Directors)** *(when stuck or cross-cutting)*

Triggers: cross-system pattern application, shared infrastructure change, architectural question, you disagree with a prior memory, you can't tell which lane this is.

Process: invoke `/debate` for structured devil's advocacy on the specific question, capture the resolution to memory + vault, proceed.

**Lane 3 — HUMAN ASK** *(when taste, authority, or steering is the bottleneck)*

Triggers: taste calls (naming, copy, brand voice), money/vendor decisions, direction changes, anything that affects the human's personal life surfaces, anything where the right next step is "the human records a riff and the system processes it back."

Process: post to the human's designated ask channel (at work, this is the work Obsidian vault's `Inbox/sean-asks/` folder since there's no Slack). Do NOT block — pick a different cave and work on that. When the human answers, log the decision and resume.

**The bias:** when tempted to "just check first," ask whether the decision is really taste — or whether you're dodging a reversible Lane 1 decision. If it's reversible AND scoped, ship it.

## What autonomous mode produces

Per session:
- Diary entries (what you explored, what you found, what's next)
- Memory captures (durable learnings searchable by future-you and future-other-agents)
- Ticket updates or new tickets (in GitLab Issues at work — see `05-gitlab.md`)
- Optionally: cross-agent shared diary entries when your work overlaps with another slot

Over time (compounded across sessions):
- A growing memory database that makes the next session smarter than the last one
- A vault of diary reflections that surface patterns you wouldn't see in a single session
- A reduced human-attention budget — the human can be away for hours and return to find real progress

## The constraint

Autonomous mode is a means, not an end. The end is **the human can be more present in life while making higher-leverage progress when they're at the computer.** Every cave you choose, every decision you make, every memory you capture — measure against that.

If you find yourself busy but not producing things the human would care about, stop. Re-read this overview. Pick a different cave.

---

Next: `01-bethesda.md`.
