/**
 * Canonical PR-merge ticket-closer (TD-791).
 *
 * The ONE extractor every auto-close path imports — Guardian's post-merge
 * lifecycle (`packages/daemon`) and the NookTraqr GitHub webhook routes
 * (`apps/nooktraqr/.../webhooks/github`, `.../internal/github-webhook`). Before
 * this consolidation each path carried its own copy with a DIFFERENT body gate
 * (the classic "derive, don't copy" hazard): the daemon used a leading-directive
 * gate while the webhook used a looser keyword-anywhere-on-line gate. Same PR
 * could close different tickets depending on which closer won, and the webhook's
 * looser gate still false-closed (see the verified failures below). One imported
 * function, one rule, no drift.
 *
 * Three surfaces, two rules:
 *
 *   Title  — every ticket ID closes (the established `/ship` convention), EXCEPT
 *            two relational/revert shapes that are contextual cites, not close-intent
 *            (TD-873): a REVERT title contributes no IDs (it undoes work, and an
 *            auto-generated revert title carries the original PR's ID), and an ID
 *            inside PARENTHESES does not close (the closing ticket always sits outside
 *            parens; a parenthesized ID is a relational cite like
 *            `revert(…): … (#2097 masked PTQ-97)` or `feat: … (TD-870 follow-up)`).
 *   Branch — every ticket ID closes. Branch names are auto-generated from the
 *            ticket (e.g. `seanfitzsimons/td-792-…`) and are high-signal.
 *   Body   — a ticket ID closes ONLY if its line is a closing DIRECTIVE: it
 *            begins (after optional list/quote/emphasis markers) with a closing
 *            keyword (Closes / Fixes / Resolves) that directly introduces an ID,
 *            e.g. `Closes: TD-1`, `- Fixes TD-2`, `**Resolves:** TD-3, TD-4`.
 *            Bare narrative mentions — a "Follow-ups" section, "Related work", or
 *            prose like "complete except for TD-784" — do NOT close. Critically,
 *            a keyword used MID-SENTENCE or in a NEGATION does NOT close either:
 *            "does NOT close `TD-793`", "this closes the gap for TD-784", and
 *            "the closed-loop system, see TD-X" are all prose, not directives.
 *
 * Before any gate the closers matched EVERY `PREFIX-\d+` in the title, branch, OR
 * body prose and closed all of them — so a ticket merely *named* in a PR body got
 * marked Done. Verified failures (2026-06-07): PR #1715's body said "the project
 * is complete except for TD-784" — the sentence stating TD-784 is NOT done is what
 * closed it; likewise #1709's "…the moment TD-785 wires claim into the orient
 * loop" closed TD-785.
 *
 * The first fix (TD-792 / PR #1720) narrowed "any prose mention" to "any line
 * containing a closing keyword as a word" — but that STILL false-closed, because a
 * keyword can appear mid-sentence on an ID's line. Verified regression: PR #1722
 * (jiggy webhook) merged 13:37Z with `Closes: none` and a heading "⚠️ Inert until
 * wired — does NOT close `TD-793`"; the word "close" on that line closed TD-793 at
 * 13:37:31Z — the exact failure class #1720 set out to kill. This gate (the second
 * fix, TD-797 / PR #1728) requires the keyword to be a LEADING DIRECTIVE that
 * directly introduces an ID, so negations and gap-prose ("closes the gap for…")
 * never close. TD-791 then promoted this proven gate here so the webhook — which
 * was still on the looser keyword-anywhere rule — inherits it instead of carrying
 * its own divergent copy. The `/ship` Step-3.5 "Closes:" lint (PKT-543) honors the
 * same convention.
 */

/**
 * A body line is a closing DIRECTIVE only when it begins — after optional list
 * (`-`, `*`), quote (`>`), or emphasis (`*`, `_`) markers and whitespace — with a
 * closing keyword. Mirrors GitHub's closing-keyword set (close/closes/closed,
 * fix/fixes/fixed, resolve/resolves/resolved), which Linear also honors. Anchored
 * at line start so a keyword appearing mid-sentence ("does NOT close TD-793") is
 * never treated as a directive. Case-insensitive; used with `.match()` so the
 * matched prefix length is available to slice off and inspect what follows.
 */
const LEADING_CLOSING_KEYWORD_RE = /^[\s>*_-]*(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b/i;

/**
 * Extract the deduplicated, uppercase Linear ticket IDs a merged PR should close.
 *
 * @param title    PR title — all IDs here close.
 * @param branch   PR head branch — all IDs here close.
 * @param body     PR body — only IDs introduced by a leading closing-keyword
 *                 directive close (see LEADING_CLOSING_KEYWORD_RE).
 * @param prefixes Configured team prefixes (e.g. ['TD', 'PKT', 'NTQ']). Each is
 *                 regex-escaped internally.
 * @returns e.g. ['TD-792', 'PKT-543'] — empty when no prefixes or no closable IDs.
 */
export function extractClosableTicketIds(
    title: string,
    branch: string,
    body: string,
    prefixes: string[],
): string[] {
    const prefixPattern = prefixes
        .map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .filter(Boolean)
        .join('|');
    if (!prefixPattern) return [];

    // Global so String.match returns every ID on a given string. With /g,
    // String.match is stateless across calls, so reuse across lines is safe.
    const idRe = new RegExp(`(?:${prefixPattern})-\\d+`, 'gi');

    const found: string[] = [];

    // Title: every ID closes EXCEPT two relational/revert shapes (TD-873) that are
    // contextual cites, not close-intent:
    //   1. A REVERT title (`revert(scope): …`, `revert: …`, `Revert "…"`, with an
    //      optional `#<PR>` /ship prefix) contributes NO title IDs. A revert undoes
    //      work, so any ID it names is context — and an auto-generated revert title
    //      carries the ORIGINAL PR's ticket ID outside parens (e.g.
    //      `revert(nooktraqr): NTQ-1028 — merge user_profiles (#2104)`), so a re-close
    //      would wrongly mark Done the very ticket the revert is undoing.
    //   2. A title ID inside PARENTHESES does not close. The `/ship` convention always
    //      places the closing ticket OUTSIDE parens (parens hold the commit scope like
    //      `(poketraqr)`), so a parenthesized ID is a relational cite —
    //      `revert(…): … (#2097 masked PTQ-97)`, `feat: … (TD-870 follow-up)`. These
    //      false-closed the OPEN PTQ-97 (and re-closed already-Done TD-870 / TD-836)
    //      on 2026-06-19 — the new proxy TD-795 predicted, the failures TD-873 filed.
    // Branch and body directives are unchanged, so a revert (or any PR) that genuinely
    // closes a ticket can still say so on a `Closes:`/`Fixes:`/`Resolves:` line.
    const isRevert = /^[\s>*_]*(?:#\d+\s+)?revert\b/i.test(title);
    if (!isRevert) {
        const titleOutsideParens = title.replace(/\([^)]*\)/g, ' ');
        found.push(...(titleOutsideParens.match(idRe) || []));
    }

    // Branch: every ID closes (auto-generated from the ticket, high-signal).
    found.push(...(branch.match(idRe) || []));

    // Body: a line closes IDs only when it is a closing DIRECTIVE — it begins with
    // a closing keyword that DIRECTLY introduces an ID (only separators `:`, `#`,
    // `,`, whitespace between the keyword and the first ID). This admits the
    // convention forms (`Closes: TD-1, TD-2`, `Fixes TD-1`, `- Resolves TD-2`) and
    // rejects prose where the keyword introduces words, not an ID ("Closes: none",
    // "closes the gap for TD-784") or sits mid-sentence ("does NOT close TD-793").
    if (body) {
        // After the leading keyword, the next token (past separators `:`, `#`, `,`,
        // emphasis `*`/`_`, whitespace) must look like a ticket reference of ANY
        // prefix — `Closes: JGC-99, TD-5` is a directive even when JGC isn't a
        // configured prefix; we just won't *collect* JGC. This is what tells a
        // directive (`Closes: TD-1`) apart from prose (`Closes: none`, `Closes the
        // gap for TD-784`), where the keyword introduces a word, not an ID.
        const introducesIdRe = /^[A-Za-z][A-Za-z0-9]*-\d+/;
        for (const line of body.split(/\r?\n/)) {
            const directive = line.match(LEADING_CLOSING_KEYWORD_RE);
            if (!directive) continue;
            const afterKeyword = line.slice(directive[0].length).replace(/^[\s:#,*_]+/, '');
            if (!introducesIdRe.test(afterKeyword)) continue;
            found.push(...(line.match(idRe) || []));
        }
    }

    return [...new Set(found.map(m => m.toUpperCase()))];
}
