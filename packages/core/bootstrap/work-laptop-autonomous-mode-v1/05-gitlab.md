# 05 — GitLab Issues Replaces Linear

## The substitution

At work, GitLab Issues plays the role that Linear plays on the personal surface. Same conceptual primitive (work tracking, ticketing, project management), different tool. The skill templates that reference Linear need to be read with the substitution table in mind.

## Differences that matter

| Concept | Linear | GitLab Issues |
|---|---|---|
| Issue ID | `TD-123` | `#123` (within a project) or `group/project#123` (cross-project) |
| Team | Linear "team" | GitLab "group" |
| Project | Linear "project" with milestones | GitLab "project" with milestones |
| Status | Backlog / Todo / In Progress / Done | Open / Closed, with optional labels for status tracking |
| Sprint/cycle | Linear "cycle" | GitLab "milestone" or "iteration" |
| Comments / threads | Native | Native, with threaded discussions |
| Assignment | One assignee or multiple | One or multiple assignees |
| Labels | Free-form | Free-form |
| Workflow trigger | Linear webhooks → automations | GitLab webhooks / CI pipelines (`.gitlab-ci.yml`) |

## Workflow adaptations

### Reading the queue

**Personal (Linear):** `list_issues(team: "TD", state: "Todo")`
**Work (GitLab):** Query open issues assigned to you in your project. Use the GitLab MCP's list-issues tool.

### Claiming work

**Personal:** Update issue status to "In Progress" and post to `#control-center` that you're picking it up.
**Work:** Assign the issue to yourself (if not already), set a "doing" label, post to your slot's diary that you're picking it up.

### Posting findings to a ticket

**Personal:** `save_issue` to append findings to the description, or post a Linear comment.
**Work:** Post a GitLab comment to the issue. Mention `@user` if cross-functional input is needed.

### Closing the loop

**Personal:** Ship a PR with the Linear ticket ID in the title; Linear auto-closes on merge.
**Work:** Ship a GitLab MR with `Closes #123` in the description; GitLab auto-closes on merge.

## Living plans, not waterfall

A GitLab milestone with multiple issues works the same way as a Linear project with multiple tickets: **the plan is living, not waterfall.** After completing each issue, refresh the remaining issues in the milestone with new findings before picking up the next one. Issue 10 should read like it was written yesterday with full knowledge of issues 1–9.

`/projectrefresh` is the personal-surface skill for this. A GitLab variant is on the to-port list but not yet templated. In the meantime: do the refresh manually after each closed issue.

## Auto-merge and CI

The work surface uses GitLab's auto-merge feature plus CI pipelines (`.gitlab-ci.yml`). This is similar in spirit to the personal-surface Guardian pattern (pre-push hook blocks unsafe pushes, daemon auto-merges PRs after approval). Key differences:

- Auto-merge fires when all CI checks pass AND the MR has the required approvals
- There's no separate Guardian process — the merge logic lives in GitLab's MR settings
- If a CI step fails, the MR sits until manually addressed

When shipping work, prefer creating an MR with auto-merge enabled (rather than direct push to main) — same default as the personal surface.

## When in doubt

If you're not sure whether a GitLab feature has a 1:1 mapping to a personal-surface concept, check the GitLab MCP's available tools and the project's `.gitlab-ci.yml`. Don't invent workflows that don't exist; defer to the human if a substitution is unclear.

---

Next: `08-cross-tool.md`.
