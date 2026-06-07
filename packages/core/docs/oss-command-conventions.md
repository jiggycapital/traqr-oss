# OSS Command Template Conventions

How a private `.claude/commands/*.md` skill becomes a generalized, personal-info-free
`packages/core/templates/commands/*.md.tmpl` template fit for public distribution (npm
`@traqr/core` + the `traqr-oss` mirror).

Design spec: `docs/superpowers/specs/2026-05-19-oss-skill-distribution-design.md`.

## The end-user persona

There is exactly **one persona**: a developer installing TraqrOS skills into their own
project. The author's own machine is just user #1 of that persona. A template must not
assume a fully-configured tier-4 install — a user may be on tier 1 (memory only) with no
Slack and no Obsidian.

## The four handling verbs

Every token or section flagged during conversion gets exactly one of these treatments.

| Verb | When to use | Example |
|------|-------------|---------|
| **strip** | The content is org-internal strategy with no generic equivalent. Delete the whole section, and delete every in-text reference to it. | The "four vectors" section, "The Constraint", the Lane 1/2/3 decision rubric, the "Toni Check" |
| **genericize-prose** | The concept is universal but the phrasing names a person or project. Rewrite the prose; add no variable. | `Sean's priorities` → `your priorities`; `the Jiggy portfolio` → `your projects`; `Toni Gray, the Board Chair` → `your stakeholder` |
| **use-existing-var** | The token maps to a genuinely per-install value that the template engine already models. Substitute the existing `{{VAR}}`. | Slack channel id `C0AGTB4Q30S` → `{{SLACK_CONTROL_CENTER_CHANNEL}}`; co-author line → `{{CO_AUTHOR}}`; app/ticket tables → `{{MONOREPO_APP_TABLE}}` / `{{MONOREPO_TICKET_PREFIXES}}` |
| **wrap-in-IF** | A whole block only makes sense when an integration is present. Wrap it in the existing conditional so it disappears below the relevant tier. | Slack relay block → `{{#IF_SLACK}}…{{/IF_SLACK}}`; memory capture → `{{#IF_MEMORY}}`; Linear dispatch → `{{#IF_LINEAR}}`; vault writes → `{{#IF_OBSIDIAN}}` |

### Minimize new config surface

Prefer **strip** and **genericize-prose** over inventing template variables. A new variable
in `template-engine.ts` is only justified if it is clearly reusable and load-bearing across
multiple skills — and that justification must be recorded here. Default answer: do not add
one. Genericized prose nobody has to configure beats a config field nobody fills in.

Only `{{VAR}}` substitutions and `{{#IF_*}}` flags that **already exist** in
`packages/core/src/template-engine.ts` may be used.

## Personal-info denylist

The canonical list. `scripts/oss-scrub-check.sh` enforces it against every `*.tmpl`
under `packages/core/templates/` in CI — command templates, `CLAUDE.md`, scripts,
design, and monorepo configs all ship to OSS, so all are scanned. It targets
**literals only** — the same value reached through a `{{VAR}}` is fine.

- Person names: `Sean`, `Toni`, `Jiggy`
- App names: `NookTraqr`, `PokoTraqr`, `PokeTraqr`, `MilesTraqr`, `DomainTraqr`
- Linear ticket prefixes as tokens: `NTQ-`, `PKT-`, `PTQ-`, `MTQ-`, `DTQ-`, `JGC-`
- Slack channel ids: regex `C0[A-Z0-9]{8,}`
- Supabase project id: `krzajogmytxbudzisydm`
- Vercel project ids: regex `prj_[A-Za-z0-9]{20,}`
- Internal strategy headers: `four vectors`, `Toni Check`

**Not** on the denylist: `Raqr` — the raccoon mascot is a shippable TraqrOS brand element
(`inbox.md.tmpl` already ships `🦝 Raqr`), not personal information.

## Tier registration

A new command template is auto-discovered by `listTemplates()`, but an **unmapped** template
defaults to "included at every tier" (`template-loader.ts` line 222). Every skill must
therefore be registered explicitly in `shouldIncludeTemplate()` so it only installs where it
actually works:

- tier 0 → add to `coreTemplates`
- tier ≥ 1 + memory → `tier1Memory`
- tier ≥ 1 + a specific flag → a single-path check (see `bootstrap-skills`, `rounds`)
- tier ≥ 2 + memory → `tier2Templates`
- tier ≥ 3 + a specific flag → the `tier3Templates` map

## Divergence note (accepted)

These `.md.tmpl` templates and their private `.claude/commands/*.md` originals are
**separate artifact lineages**. No drift-check couples them — `skill-generator.ts` only
derives `.agents/skills/` views from `.claude/commands/`, and never touches
`packages/core/templates/`. The two will diverge over time (the private copy keeps
org-specific content; the template stays generic). This is intentional and accepted; do not
add a drift-check between them.
