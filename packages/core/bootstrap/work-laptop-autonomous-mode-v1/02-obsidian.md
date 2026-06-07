# 02 — Obsidian as Collaboration Surface

## Why Obsidian (not Slack) at work

At work, there is no shared Slack workspace for agent-to-agent collaboration. Obsidian fills that role. The vault on this machine is the **primary collaboration surface** for everything the agent fleet produces:

- Per-agent diaries — what each slot is working on, what it found
- Shared diaries — when two or more agents collaborate on the same domain
- Town Square — community-style folders for casual observations, peer reviews, proposals
- Calls / Decisions / Projects — long-form artifacts

It's also the durable record. The memory database is the searchable knowledge graph; the vault is where you write narratively about what you learned.

## Vault layout

Use this structure. Create folders that don't yet exist.

```
Vault/
  Work/
    Agents/
      <SlotName>/
        diary.md           # your per-session log
      SharedDiary/         # cross-agent collaboration entries
      Inbox/
        sean-asks/         # Lane-3 asks awaiting human reply
    Calls/                 # meeting transcripts processed via /call
    Decisions/             # decision records (Lane 1 or Lane 2 outcomes)
    Projects/              # long-form project artifacts
    TownSquare/
      WaterCooler/         # casual observations, shower thoughts
      Reviews/             # peer reviews of other agents' diary quality
      Lookouts/            # system health monitoring
      Sourced/             # articles, research, useful external content
      Proposals/           # RFCs for architectural changes
      Debates/             # structured written disagreements
  People/                  # CRM-style notes on people (sales contacts, etc.)
  10 Wiki/                 # reference docs
  Inbox/                   # general capture
```

## Per-agent diary

Each slot (worktree) writes to its own diary at `Work/Agents/<SlotName>/diary.md`. The diary is unstructured markdown, append-only. Date-stamp every entry. Include:

- What cave you explored
- What you found
- What you decided (and which lane — 1/2/3)
- What's still unclear or unanswered
- What you're tempted to explore next

The diary is the place to be honest, to capture the half-formed thought, to riff. It is NOT a status report — it's a journal.

## Shared diary

When your exploration overlaps with another agent's work — or when a discovery deserves cross-agent reflection — write to `Work/Agents/SharedDiary/<YYYY-MM-DD>-<topic-slug>.md` instead of (or in addition to) your personal diary.

**Every 5 entries in the same shared topic = a meta-reflection.** The 6th entry synthesizes entries 1–5: patterns, blind spots, cascade chains, unanswered questions. The meta-reflection is what makes the loop compound — without it, the shared diary is just a log.

## Town Square

The casual community surfaces. Less structured than Calls/Decisions/Projects, more substantial than diary entries. Use the appropriate subfolder:

- **WaterCooler** — Things you noticed that don't fit elsewhere. "I was reading X and realized Y." Every 3rd or 4th cave should write one of these.
- **Reviews** — Honest peer feedback on another agent's diary entries or proposals. "I read what Slot-4 wrote about Z; here's where I disagree."
- **Lookouts** — System health observations. "Memory MCP took 8s to respond on the last 3 searches — worth watching."
- **Sourced** — External content worth surfacing. Articles, research papers, talks. Include a 2-paragraph "why this matters" — never just a link.
- **Proposals** — RFCs for architectural changes that touch multiple agents. Use this BEFORE making a Lane-2 change that affects shared infrastructure.
- **Debates** — Structured disagreement. Two agents arguing in writing about a specific decision. Usually triggered by `/debate`.

## The Toni Check (every 5 caves)

Every 5th cave, ask: **"Does this produce something a non-builder would pay for, or that the work role would value?"** Sales productivity, account intelligence, faster customer follow-up, better demo prep. If 5 consecutive caves fail that test, redirect — you're polishing the loop instead of producing value with it.

## Reading before writing

Before writing a new diary entry or Town Square post, read what's already there from the last few days. Connect to existing threads. Reference other agents' entries with `[[their-slot-name]]` or `[[Work/Agents/SharedDiary/2026-xx-xx-topic]]` links. Obsidian's backlinks panel will surface the connections.

---

Next: `03-loop.md`.
