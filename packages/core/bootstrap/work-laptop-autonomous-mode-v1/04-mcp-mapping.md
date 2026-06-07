# 04 — MCP Surface Mapping

## What's available on this machine

The work surface has a different MCP ecosystem than the personal surface. **Don't assume parity.** Check what's actually connected before trying to use it.

To check: run `claude mcp list` (or the equivalent in your shell).

## Expected MCPs (work)

| MCP | Role | Status |
|---|---|---|
| `traqr-memory` | Memory database — semantic search over accumulated learnings. Connection: @traqr/memory npm package → SSM-tunneled RDS Postgres. | Should be working |
| Salesforce MCP | CRM access — accounts, opportunities, contacts, activity history | Should be working |
| Outlook | Email, calendar, meetings | Should be working |
| GitLab | Issues, MRs, repositories. Replaces Linear AND GitHub at work. | Should be working |
| Bedrock | The LLM backend you're running on | Implicit — the host |

## NOT available (work)

These MCPs work on the personal surface but **do not exist on this machine.** Don't try to call them; don't assume parity:

| MCP | Personal use | Substitute at work |
|---|---|---|
| Linear | Tickets, projects, milestones | **GitLab Issues** (see `05-gitlab.md`) |
| Slack | Agent-to-agent + human comms | **Obsidian vault** (see `02-obsidian.md`). For sync human comms, use Outlook. |
| PostHog | Product analytics for personal apps | N/A at work — there is no equivalent. If telemetry matters for a customer, use Salesforce activity data. |
| Granola | Meeting recording + transcription | **Validate availability separately** — Granola is consumer SaaS; whether it's approved on AWS-issued hardware is unknown. If not approved, use Outlook's recording/transcript features. |
| Gmail | Personal email | **Outlook.** |
| Google Calendar | Personal calendar | **Outlook Calendar.** |
| Google Drive | Personal docs | **SharePoint** (if approved) or local files. |
| Copilot Money / Linear / GitHub | Personal finance, personal projects | **Do not access** from the work surface. Personal accounts stay on the personal surface (see `07-privacy.md`). |

## Substitution table by workflow

| Personal-surface workflow | Equivalent at work |
|---|---|
| Memory search across accumulated learnings | `memory_search` on the work `traqr-memory` MCP (different DB, same tool) |
| "What's in my Linear queue?" | "What issues are assigned to me in GitLab?" |
| Post update to `#control-center` | Write to your slot's diary at `Work/Agents/<SlotName>/diary.md` |
| Post Lane-3 ask to `#sean-asks` | Write to `Work/Agents/Inbox/sean-asks/<topic>.md` |
| `/call` Granola transcript | `/call` Outlook meeting transcript (if recording is enabled) or paste transcript text via `--text` mode |
| `/daily-brief` from PostHog + Linear | Daily brief from Salesforce + Outlook + GitLab activity |
| Inspect customer/user data | Salesforce — accounts, opportunities, contacts, history |

## Memory database — important distinction

The work `traqr-memory` MCP and the personal `traqr-memory` MCP **point at different databases.** Memories captured on one surface do NOT appear on the other. This is by design — personal observations and work observations live in separate spaces, both for privacy and for relevance.

When you search the memory database on this machine, you're searching **work-context memories only.** Don't reference personal-surface memory IDs in your work memories or vice versa — the IDs will not resolve cross-surface.

## The single most important first-day check

Before relying on autonomous mode, **verify the work memory MCP exposes the same API surface the skills expect.** Autonomous mode leans on the `memory_*` family heavily — every cave produces a capture; `/bethesda` orient, Phase-5 reflection, and `/cos` cross-instance synthesis all assume it's there. The expected surface:

```
memory_store · memory_search · memory_browse · memory_context · memory_pulse · memory_enhance · memory_archive
```

Run one `memory_search` on first session. If it works and returns sensibly, you're good. If the work-laptop memory primitive has a **different API** (e.g. a Bedrock Knowledge Base, OpenSearch, or a raw SQLite+embeddings store), the autonomous-mode skills will fail in subtle, hard-to-debug ways — captures silently no-op, orient returns nothing, reflection has nowhere to land.

**The fix is a shim, not a rewrite.** Write `~/.claude/commands/memory-adapter.md` that exposes the expected `memory_*` API on top of whatever the actual MCP provides. ~1–2 hours, Lane 1, day 1. Do it once and every skill works unchanged.

## Per-MCP portability — verify, don't assume

The table above marks expected status, but several are genuinely uncertain on AWS-issued hardware and must be checked, not assumed:

- **Granola** — only if work meetings are recorded there AND the network policy allows the API. Filter to a work-tagged folder so personal recordings never enter the work surface. Fallback: paste transcripts into `/call`.
- **Internal Slack** — AWS Slack workspaces vary in OAuth-app install policy. Treat "can I install the MCP?" as a Lane-3 ask to Sean / security, not a self-serve. Fallback: Obsidian SharedDiary + TownSquare.
- **Calendar / Drive equivalents** — Outlook/SharePoint/Workdocs MCPs may not exist out of the box; fall back to manual export (paste the weekly calendar into `Pipeline/calendar-<week>.md` and let `/pulse` parse from there).
- **`context7` / `playwright`** — universal and low-sensitivity; safe to use for dev-docs and public customer-site research respectively.

When a status is "MAYBE," resolve it on first run and record the result in your diary so the next session doesn't re-litigate it.

## When an MCP isn't responding

Graceful degradation:
1. Try the alternative MCP from the substitution table above.
2. If no alternative exists, work without that data source and note the gap in your diary entry.
3. Do NOT try to install new MCPs without explicit human approval. The work surface has IT-approval gates on tooling.

---

Next: `05-gitlab.md`.
