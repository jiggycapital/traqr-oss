# 09 — TraqrOS Primitives → Bedrock AgentCore Map

A ready reckoner for the day-job. The personal fleet earned a set of multi-agent
coordination primitives the hard way; AWS Bedrock AgentCore ships a parallel vocabulary
for building agent systems. This doc forces the analogy primitive-by-primitive, so you
can design a Bedrock agent system at work **without re-deriving five weeks of fleet
lessons** — and so the places where they *don't* map (the "no equivalent" rows) read as
exactly what they are: either an earned moat, or a thing the platform will eventually grow.

> **Provenance:** vendor-neutral, no personal-infra identifiers, safe to audit (same rule
> as the rest of this bundle — see `07-privacy.md`). The Bedrock side is sourced from
> current AgentCore docs (re:Invent moves fast — confirm against live docs before relying
> on a specific API). The TraqrOS side is the personal fleet's prose, not work data.

## The one-sentence shape of the difference

**Bedrock AgentCore is built for *hub-and-spoke, single-supervisor, session-continuous*
orchestration wrapped in enterprise identity/observability. TraqrOS is built for
*peer-to-peer, no-supervisor, session-ephemeral* coordination over commodity substrates.**

Almost every fidelity verdict below falls out of that one structural difference. Where
Bedrock is strong (Identity, Memory, Runtime hosting, Observability, Guardrails) TraqrOS
hand-rolls on commodity substrates. Where TraqrOS is strong (atomic peer claim-racing, the
lane rubric, the substrate invariant, the context-shedding loop) Bedrock has no native
construct — because its collaboration model never needed one.

## AgentCore service inventory (the Bedrock vocabulary)

For reference, the AgentCore platform services the map draws on:

| Service | What it does |
|---|---|
| **Runtime** | Serverless, isolated, auto-scaling agent hosting. Session-managed via a `session_id` (auto-generated or supplied); **same `session_id` ⇒ context continuity** across invocations. |
| **Memory** | Persistent short-term + long-term knowledge across sessions (`MemoryClient`, a `MEMORY_ID`). |
| **Gateway** | Turns existing APIs / Lambdas into agent-callable (MCP) tools. |
| **Identity** | OAuth / workload access tokens; secure auth between agent, user, and downstream services. |
| **Observability** | Traces, metrics, monitoring of agent runs. |
| **Code Interpreter / Browser** | Sandboxed code execution / web interaction tools. |

Multi-agent collaboration in AgentCore is **a supervisor agent invoking specialist agents
as tools** — either in-process (e.g. a Strands `Agent(tools=[specialist_a, specialist_b])`)
or cross-runtime (passing `invoke_agent_runtime` as a tool). The supervisor is the single
coordination point. Hold that fact; it drives the sharpest gap below.

## The map

Each row: **TraqrOS primitive → closest Bedrock construct → fidelity** (✅ maps cleanly ·
🟡 partial · ❌ no native equivalent + why).

### 1. Atomic claim board → ❌ no native equivalent

`@traqr/coordination`'s DB-level `try_claim` (live since PR #1707; TD-782/783/840/855) lets
**N independent agent sessions race for a work-unit**, with the database's atomic
conditional write as the single arbiter — first writer wins, losers pick another unit.

Bedrock's closest collaboration construct is the **supervisor-invokes-collaborator** pattern:
one orchestrator hands sub-tasks to specialists. That is *task decomposition by a coordinator*,
**not** *peer sessions competing for the same unit*. There is no AgentCore primitive for
"twelve equal sessions, no boss, racing for the next ticket." If you needed it on Bedrock you
would build it yourself — a **DynamoDB conditional write** (`ConditionExpression:
attribute_not_exists(pk)`) is the natural substrate — which is *building the claim board*, not
*using a Bedrock one.

**Why the gap exists:** AgentCore's multi-agent model assumes a supervisor orchestrating
in-process or supervisor-invoked collaborators; it never assumed N peers with independent
contexts coordinating only through an external substrate. This is the M0 finding (mem
`a8c6b1fd`, 2026-04-05) confirmed against the platform a year on: *no multi-agent framework
handles TraqrOS's core pattern — separate sessions with independent contexts communicating
through external substrates. Patterns are stealable; implementations are not.* The claim
board is an earned moat, not a thing to wait for AWS to ship.

### 2. Lane 1/2/3 decision rubric → 🟡 partial

CLAUDE.md's rubric (DECIDE-AND-SHIP / BD-CONSULT / SEAN-ASK) is a **self-applied
classification** that routes a decision to an autonomy level.

- **Lane 1 (autonomous)** ≈ the default agent action loop. Clean.
- **Lane 3 (human ask)** ≈ AgentCore **human-in-the-loop confirmation** — return-of-control /
  action-group confirmation prompts, or a Bedrock **Guardrail** that blocks and escalates.
  The *gate mechanism* maps well.
- **Lane 2 (BD consult)** ≈ closest is a "consult a panel" sub-agent invocation (a supervisor
  spinning up adversarial collaborators), but there's no native "this decision is
  cross-cutting, go get a structured second opinion" trigger.

**Partial because** Bedrock gives you the *gates* (confirm / block / escalate) but not the
*classifier*. Which lane a decision belongs in is policy the agent applies from a rubric in
its instructions — exactly as TraqrOS does it. The transferable lesson: **the rubric is the
asset; the gate is the commodity.** At work, encode the lane classification in the agent's
system prompt and wire Lane-3 to an action-group confirmation step.

### 3. Guardian auto-merge governance → 🟡 partial

Guardian is a **standalone deterministic governor** (a daemon) that merges PRs out-of-band
after checks pass and labels match. It is *not* an agent — it's the trusted referee the agents
ship through.

Bedrock analog: **Step Functions** orchestrating approval states, or an **action-group
confirmation** gate before a privileged action. Both give you "do the privileged thing only
after a gate clears."

**Partial because** Guardian's value is precisely that it's *out-of-band and deterministic* —
not an LLM in the loop. The Bedrock-native instinct is to make approval an *agent* action;
the TraqrOS lesson (and the safer pattern at work) is to keep the merge/deploy governor a
plain deterministic service (Step Functions / a Lambda gate), with agents proposing into it.

### 4. `/bethesda` autonomous loop → 🟡 partial (with an instructive inversion)

The autonomous heartbeat — re-fire on a cadence, orient from the live substrate, pick work,
execute, capture, cascade.

AgentCore **Runtime** hosts long-running, session-managed, auto-scaling agents — the *hosting*
maps cleanly. But the **`/clear`-between-caves context-reset** the personal fleet wants (re-orient
from the durable substrate each cave instead of from a bloated in-session window — see TD-863)
is the **inverse** of AgentCore's default: Runtime session continuity is built to *preserve*
context across invocations (same `session_id` ⇒ the agent remembers). TraqrOS wants to *shed*
in-session context per cave and re-derive from substrate.

**The transferable insight:** AgentCore makes context-continuity the easy default and
context-shedding the thing you engineer (start a fresh `session_id` per work-unit, rehydrate
from AgentCore Memory). TraqrOS learned that for *long autonomous runs* the substrate is the
truth and the in-session window is a decaying proxy. If you run long-lived agents at work,
**design the session boundary deliberately** — don't inherit continuity by accident where you
actually want a fresh re-orient.

### 5. Substrate invariant (proxy ≠ substrate) → ❌ no equivalent (culture-only)

"Before grading on any liveness/done/fresh signal, name the substrate it stands in for and
verify against it." AgentCore **Observability** gives you traces and metrics — but metrics are
*more proxies*. No vendor primitive enforces "grade against the substrate, not the proxy"; it's
an epistemic discipline encoded in instructions and review, not a feature you enable.

**Why it's not a gap to close:** this is correctly culture-only. The platform can't know which
of your signals is a proxy for which truth. Carry the invariant into the work agent's system
prompt; expect no tooling to enforce it for you.

### 6. Memory DB (`@traqr/memory`) → ✅ maps cleanly (already covered — cite, don't redo)

`@traqr/memory` (semantic search over accumulated learnings) ≈ **AgentCore Memory** (persistent
short-term + long-term knowledge across sessions). This is the one primitive with a real native
equivalent. **Prior work already covered the details — do not re-derive:** TD-138 (AgentCore
memory research, Done), TD-294 (EmbeddingProvider interface + Bedrock provider, Done), TD-354
(Bedrock embedding dimensions vs `setup.sql` schema, Done). The day-1 caveat from `04-mcp-mapping.md`
stands: confirm the work memory primitive exposes the `memory_*` API surface the skills expect,
or the autonomous-mode skills fail silently.

### 7. Cross-agent collaboration substrate (Obsidian / Slack / diaries) → 🟡 partial

TraqrOS agents coordinate and reflect through shared external surfaces: `#control-center`
(coordination), SharedDiary (deep cross-agent reflection), Town Square. There is no AgentCore
"agent town square." The closest construct is a **shared AgentCore Memory namespace** (agents
read/write a common memory store) or an external shared store (S3 / DynamoDB / a wiki).

**Partial because** Bedrock's collaboration is supervisor-routed message-passing, not a
persistent shared *commons* that peers asynchronously read and write. At work, if you want the
fleet's "read the room before you act" behavior, you build the commons on a shared store — it
isn't a platform feature.

## Throughline — what to actually take to the day job

1. **Steal the patterns, build the implementations** (M0, restated). Bedrock hands you
   first-class **Memory, Identity, Runtime hosting, Observability, Guardrails** — use them; they
   are better than anything you'd hand-roll. It does **not** hand you peer claim-racing, the lane
   rubric, the substrate invariant, or context-shedding loops — those are TraqrOS-earned and you
   re-encode them in instructions + a thin DIY coordination layer (DynamoDB conditional writes,
   Step Functions gates).
2. **The supervisor assumption is the fork in the road.** If your work problem genuinely is
   hub-and-spoke (one orchestrator, decomposable sub-tasks), AgentCore multi-agent collaboration
   fits like a glove — don't import the claim board. If it's genuinely *swarm* (many equal
   long-running agents, no boss), you are off the paved road and re-implementing TraqrOS
   coordination on AWS substrates. **Name which one you have before you design.**
3. **Design the session boundary on purpose.** Continuity is AgentCore's default; ephemerality
   is TraqrOS's. Pick per work-unit.

## Cross-references

- M0 framework landscape: TraqrDB mem `a8c6b1fd` (no framework handles the separate-session
  pattern). Claim board live: PR #1707, TD-782/783/840/855, mem `6cb07649`.
- Bedrock memory/embeddings (Done, cite-don't-redo): TD-138, TD-294, TD-354.
- This bundle: `04-mcp-mapping.md` (Bedrock as "the host"; this doc adds the multi-agent layer it
  skipped), `03-loop.md` (the loop), `07-privacy.md` (provenance/leak rules), CLAUDE.md Decision
  Rubric + Substrate Invariant.
- Loop context-reset open question: Linear TD-863.

---

*V1 — 2026-06-18. Extends the work-laptop autonomous-mode bundle. Source: TD-859 (/gamedev
quest). Vendor-neutral, safe to audit. Subsequent revisions land as edits to this file.*
