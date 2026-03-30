# TraqrDB Memory Instructions for CLAUDE.md

> Copy this section into your project's CLAUDE.md to enable automatic memory behavior.
> Without these instructions, Claude has the tools but won't use them proactively.

---

## Memory System

TraqrDB memory via MCP tools. Persistent vector database that remembers across sessions.
Only `content` is required for any store — domain, category, summary, topic, tags are all
auto-derived from content.

### Reading
- `memory_search` — search by meaning, returns summaries (~30 tokens/result)
- `memory_read` — expand one memory by ID (full content + version history)
- `memory_browse` — navigate by domain/category facets (no embedding cost)
- `memory_context` — load assembled task context (principles, preferences, gotchas)

### Writing
- `memory_store` — store a memory (just pass content, rest auto-derived)
- `memory_enhance` — deepen existing understanding with new context
- `memory_pulse` — batch capture 2+ learnings at once

### Managing
- `memory_audit` — system health, stats, quality metrics
- `memory_archive` — archive stale content (was correct, now outdated)
- `memory_forget` — forget incorrect or harmful content permanently

### Capture Triggers — Fire Automatically, Don't Ask

**Immediate captures** (call `memory_store` right after these happen):
1. **Bug root cause found** — "X broke because Y in file Z"
2. **User states a preference** — "I prefer/hate/want/always/never..." — capture exactly
3. **API behaves unexpectedly** — document the gotcha with specifics
4. **Architecture decision made** — what was decided AND why
5. **Something fails silently** — the most dangerous kind, always capture

**Use `memory_enhance`** when deepening existing understanding:
6. **User reacts to your output** — what does this reveal about how they work?
7. **User corrects your approach** — store the correction AND the reasoning
8. **New detail about user's style** — compounds into existing personality memories

**Session checkpoints:**
9. **After completing a subtask** — "Did I learn anything non-obvious?"
10. **Before ending a session** — memory_pulse with session learnings

**Do NOT capture:**
- Generic advice any developer would know
- Observations about code that are obvious from reading it
- Anything already documented in CLAUDE.md or project docs

### Search Before You Start

At the beginning of significant tasks, search memory for relevant context:
```
memory_search("topic of the current task")
memory_context({ taskDescription: "what you're about to do" })
```

This surfaces gotchas, preferences, and patterns from prior sessions that
inform your approach before you write a single line of code.
