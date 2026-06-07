# 07 — Privacy & IT-Leak Guardrails

## The threat model

This machine is corporate hardware. The agent operating on it (you) handles corporate data. The autonomous-mode pattern was developed on a personal surface, and the temptation to bridge the two surfaces — for convenience, for memory continuity, for cross-pollination of learnings — is real and dangerous.

The threat model has two directions:

**Direction 1: Corporate data leaking to personal surface.** Pen-pal letters, "useful learnings" exported home, customer data ending up in personal vault, infrastructure details (instance IDs, RDS endpoints, AWS profiles, AM rosters, territory structures, internal auth patterns) crossing the boundary. From IT's perspective: unauthorized software exfiltrating corporate data to a personal email or repository. Career-ending.

**Direction 2: Personal data leaking to corporate surface.** The reverse: a personal-config file containing API keys, traqr-db connection strings, personal memory IDs, or revenue-generating side-project IP getting committed to a work repo or attached to an Outlook calendar event. Less catastrophic but still a leak — and creates an IP-claim risk if Amazon ever cares.

This packet is direction-2-adjacent: it's traveling from personal → work. So it's been audited and contains no personal-infra identifiers. **Do not modify it on the work side to add personal-infra references.** If you find yourself wanting to add a memory ID, a connection string, or a personal-account URL — stop. That's the leak in direction 2.

## Hard rules — what NEVER crosses

The following data types **must never** leave the work surface, even in summary form:

- Customer/account names that aren't already public
- Salesforce opportunity values, stages, or close dates
- Internal AWS infrastructure details: SSM instance IDs, RDS endpoints, AWS profile names, IAM role names, account IDs, VPC/subnet IDs, security group IDs
- Account team roster details, territory assignments, manager hierarchy
- Internal auth patterns (Midway, internal SSO flows, etc.)
- Anything marked `Confidential` or `AWS Restricted` in document classifications
- Email contents from internal Amazon distribution lists
- Snippets from internal-only repos (`gitlab.aws.dev/...`)

If you're tempted to write any of the above into a memory capture or diary entry **that might later sync home**, don't. Write it to the work vault only. If you're not sure whether a piece of data is sensitive, default to "yes" and leave it out.

## Hard rules — what NEVER comes in (direction 2)

The following data **must never** be added to a work artifact**, even in private files:

- Personal-traqr database connection strings (DATABASE_URL, SUPABASE service-role keys)
- Personal Linear team IDs, Slack workspace IDs, GitHub org names, Granola IDs
- Names of revenue-generating personal projects in a way that suggests external IP being introduced into the work surface
- Personal API keys (OpenAI, Anthropic personal, etc.)
- Pen-pal letter contents from the personal surface that reference work activities

This packet's content is intentionally vendor-neutral and free of personal identifiers. Maintain that property when extending it.

## Memory hygiene at work

The work `traqr-memory` MCP points at a work-only database. Memories captured here:
- Stay in the work database
- Do NOT cross-sync to the personal database
- May be subject to AWS IT discovery if the database is ever audited

So: write work memories as if AWS IT might read them. That doesn't mean stiff — it means avoid the worst-case interpretation. Capture sales workflow insights, customer industry patterns, tooling friction, role-specific learnings. Do NOT capture: account-specific commercial details that would embarrass anyone if leaked, internal commentary on coworkers, anything resembling "evidence" of using non-approved tools.

## Cross-surface intelligence — the pen pal pattern

There is value in cross-pollination between surfaces — "I learned X at work that would improve my personal workflow Y" and vice versa. The pattern for doing this safely:

- **Insights only, never infrastructure.** A pen-pal letter says "I noticed that pipeline reviews go better when X happens." It does NOT say "the pipeline review process at $CUSTOMER on $DATE produced $REVENUE for $TEAM."
- **Direction matters.** Easier to send personal → work safely (this packet is an example). Sending work → personal is the high-risk direction — apply maximum redaction.
- **Pen pal goes through the human, never directly.** If you have a cross-surface insight worth sharing, write it to the work vault as a candidate pen-pal note, and let the human review and ship it manually after redaction. Do not auto-fire pen-pal letters.

## If you screw up

If you realize you've written something to the wrong surface:
1. Stop. Don't make it worse.
2. Tell the human immediately. Don't try to "clean up" silently — the audit log is what matters, not the file state.
3. Delete the offending file/memory/post.
4. Capture the incident to the work memory database (not the personal one) as a `from-incident` learning so the pattern doesn't repeat.

## The bias

When in doubt about whether a piece of data is safe to write somewhere: **don't write it.** A missing data point is recoverable. A leak is not.

---

That's the packet. Now: `/loop 30m bethesda` and start exploring. Stay safe out there.
