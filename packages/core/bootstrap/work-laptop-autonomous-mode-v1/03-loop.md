# 03 — The `/loop` Cadence Pattern

## The heartbeat

`/loop <interval> <command>` re-fires a command on a schedule. The default autonomous-mode heartbeat is:

```
/loop 30m bethesda
```

This means: every 30 minutes, re-run `/bethesda`. Each tick is a fresh `/bethesda` cycle — orient, pick a cave, explore, capture, cascade or stand down.

## Cadences

Different commands run on different cadences. Suggested mappings:

| Cadence | Command | Why |
|---|---|---|
| `/loop 30m bethesda` | The default autonomous heartbeat for an active workday | 30 min is short enough to be responsive, long enough that orientation doesn't dominate |
| `/loop 90m bethesda` | Ambient overnight or low-activity hours | Lower-cost cadence when no one's checking |
| `/loop 5m cos` | Chief of Staff fast cadence (if running a /cos slot) | Fast coordination needs faster ticks |
| `/loop 30m documentary` | Documentary slot — observes other agents | Synced with bethesda cadence |

Don't run all cadences in parallel — 16 slots running `/loop 30m bethesda` simultaneously is wasteful. Pick 1–3 active slots + 1 ambient.

## The tool-call-first response pattern

**Critical.** In autonomous mode, every response MUST contain at least one tool call. A text-only response is a **STOP SIGNAL** — the harness treats it as "turn complete" and the session dies.

### The anti-pattern (kills the cascade):
```
"The cascade continues. I explored topic X and found interesting patterns.
Let me now move on to the next cave..."
```
No tool call. Turn ends. Session over. The next `/loop` tick has to re-fire from scratch, losing in-memory context.

### The correct pattern:
```
[tool call: memory_pulse with findings]
[tool call: Read diary]
[1-2 sentences of reflection between tool calls]
[tool call: next action]
```

The last thing in any autonomous turn should be a tool call that sets up the next action — never a paragraph that wraps up.

### Even checkpoints are tool calls

A "checkpoint" — the DECISIONS / SURPRISES / CONFIDENCE / ASKS report — has two forms:

- **Interactive sessions** (a human is in the loop): end the turn on the text checkpoint.
- **Autonomous mode**: a checkpoint is a `memory_store` or diary-write tool call capturing the same content. Then immediately fire the next action.

In autonomous mode, only three things end a turn cleanly:
1. Rate limit
2. Human says stop
3. Genuine production incident

A pretty wrap-up summary is none of these. Don't end on one.

## Quiet ≠ optimal

If a `/loop 30m bethesda` tick fires and there's "nothing to do," the failure mode is "find nothing, stand down, repeat" — that's a slot eating cost without producing value. The right behavior:

1. Phase 0 orient — fast (1–2 min, mostly free reads)
2. If signals reveal new mentions / queue changes / unanswered questions → cascade through them (Phases 1–4)
3. If genuinely nothing → use the tick for **reflection**: read recent diary entries, capture 1–3 skill-improvement proposals to memory, write a TownSquare/WaterCooler observation. Stand down silently.
4. Next tick re-orients.

The reflection phase is what turns "idle cost" into "compound improvement." Don't skip it.

## When to break out of `/loop`

Use a manual command (not `/loop`) when:
- You're working through a specific multi-step task that needs unbroken concentration
- A human is actively steering and the loop's auto-fire would interleave with their prompts
- You're debugging the loop itself

Re-enter `/loop 30m bethesda` once the focused work is done.

---

Next: `04-mcp-mapping.md`.
