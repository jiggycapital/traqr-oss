/**
 * TD-791 — the canonical PR-merge ticket-closer must honor the closing-keyword
 * convention identically for every caller (Guardian daemon + NookTraqr webhook
 * routes). Consolidates the two former suites (daemon's TD-792/797 matrix +
 * the webhook's NTQ-1006 cases) onto the single shared `extractClosableTicketIds`.
 *
 * Locks the behavior matrix: title/branch IDs always close; body IDs close ONLY on
 * a leading closing-keyword DIRECTIVE that directly introduces an ID. Includes the
 * verified false-Done regression shapes (TD-784 via #1715, TD-785 via #1709, and
 * the mid-line negation TD-793 via #1722 that motivated the leading-directive gate).
 */

import { describe, it, expect } from 'vitest';
import { extractClosableTicketIds } from '../extract-ticket-ids.js';

const PREFIXES = ['TD', 'PKT', 'NTQ'];

describe('extractClosableTicketIds (TD-791: one shared keyword-gate closer)', () => {
    describe('title — every ID closes', () => {
        it('closes a single title ID', () => {
            expect(extractClosableTicketIds('fix(daemon): TD-792 — false-Done', '', '', PREFIXES))
                .toEqual(['TD-792']);
        });

        it('dedupes case-insensitively', () => {
            expect(extractClosableTicketIds('feat: td-12 and TD-12 plus TD-34', '', '', PREFIXES).sort())
                .toEqual(['TD-12', 'TD-34']);
        });

        it('returns [] when title/branch/body carry no ID', () => {
            expect(extractClosableTicketIds('chore: tidy up', 'devops/slot-1', 'No tickets here.', PREFIXES))
                .toEqual([]);
        });
    });

    describe('branch — every ID closes (auto-generated, high-signal)', () => {
        it('closes an ID embedded in the branch name', () => {
            expect(extractClosableTicketIds('fix: a thing', 'seanfitzsimons/td-792-daemon-false-done', '', PREFIXES))
                .toEqual(['TD-792']);
        });

        it('does not invent an ID from a ticketless branch', () => {
            expect(extractClosableTicketIds('chore: bump', 'feature3/jiggy-nonusd-postexit-currency', '', PREFIXES))
                .toEqual([]);
        });
    });

    describe('body — only IDs on a closing-keyword line close', () => {
        it('closes IDs on a "Closes:" line, comma-separated', () => {
            const body = '## Summary\nDid a thing.\n\nCloses: PKT-543, NTQ-927';
            expect(extractClosableTicketIds('chore: a thing', '', body, PREFIXES).sort())
                .toEqual(['NTQ-927', 'PKT-543']);
        });

        it('honors Fixes / Resolves keywords too', () => {
            expect(extractClosableTicketIds('t', '', 'Fixes TD-1\nResolves TD-2', PREFIXES).sort())
                .toEqual(['TD-1', 'TD-2']);
        });

        it('closes only the Closes-line ID, not Follow-ups mentions', () => {
            const body = '## Summary\nThe real fix.\n\nCloses: TD-100\n\n'
                + '## Follow-ups\n- TD-200 deferred\n- TD-300 needs a debate';
            expect(extractClosableTicketIds('fix: real', '', body, PREFIXES)).toEqual(['TD-100']);
        });

        it('does NOT close anything for a discussion-only body with no keyword', () => {
            const body = 'Related to TD-500 and TD-501 but not closing them.';
            expect(extractClosableTicketIds('chore: noop', '', body, PREFIXES)).toEqual([]);
        });

        it('treats "Closes: none" as closing nothing', () => {
            expect(extractClosableTicketIds('chore: docs only', '', '## Summary\nDocs.\n\nCloses: none', PREFIXES))
                .toEqual([]);
        });

        it('unions a title ID with a Closes-line ID', () => {
            const out = extractClosableTicketIds('fix: TD-792 daemon', '', 'Closes: TD-792, TD-7', PREFIXES).sort();
            expect(out).toEqual(['TD-7', 'TD-792']);
        });
    });

    describe('verified false-Done regressions (TD-792 / TD-797 root causes)', () => {
        it('PR #1715 shape: "complete except for TD-784" does NOT close TD-784', () => {
            // #1715 closed TD-781 (its real target); its body merely DESCRIBED TD-784
            // as not-yet-done. The old prose-matcher closed TD-784 anyway.
            const title = 'feat(core): TD-781 — new-skill authoring template';
            const branch = 'td-781-autonomous-skill-template';
            const body = '## Summary\nShips the TD-781 template.\n\n'
                + 'Closes: TD-781\n\n'
                + 'The project is complete except for TD-784, which a fresh-context '
                + 'builder will pick up (the main-build smoke-detector).';
            const out = extractClosableTicketIds(title, branch, body, PREFIXES).sort();
            expect(out).toEqual(['TD-781']);
            expect(out).not.toContain('TD-784');
        });

        it('PR #1709 shape: "the moment TD-785 wires…" does NOT close TD-785', () => {
            const title = 'fix(coordination): cave-claim CLI reads repo-root .env.local under npm -w';
            const branch = 'feature3/jiggy-nonusd-postexit-currency';
            const body = 'Makes the claim board work via the documented invocation. '
                + 'This is the prerequisite that pays off the moment TD-785 wires claim '
                + 'into the orient loop.';
            const out = extractClosableTicketIds(title, branch, body, PREFIXES);
            expect(out).toEqual([]);
            expect(out).not.toContain('TD-785');
        });

        it('parenthetical example list in prose (no closing keyword) does not close', () => {
            const body = 'Generalizes the matcher so example IDs like (PKT-123, TD-456, NTQ-789) '
                + 'in docs are ignored.';
            expect(extractClosableTicketIds('docs: examples', '', body, PREFIXES)).toEqual([]);
        });

        it('PR #1722 shape: "does NOT close `TD-793`" (negated, mid-line) does NOT close TD-793', () => {
            // The live regression that motivated the leading-directive gate. #1722
            // merged `Closes: none`; its heading negated the close. The prior
            // "keyword anywhere on the line" gate matched "close" and closed TD-793.
            const body = '## ⚠️ Inert until wired — does NOT close `TD-793`\n\n'
                + 'The route is dead until the Vercel webhook is wired.\n\n'
                + '`Closes: none`';
            const out = extractClosableTicketIds('feat(jiggy): smoke-detector route', '', body, PREFIXES);
            expect(out).toEqual([]);
            expect(out).not.toContain('TD-793');
        });

        it('mid-sentence "this closes the gap for TD-784" does NOT close TD-784', () => {
            const body = 'This closes the gap for TD-784 by adding the deploy webhook route.';
            expect(extractClosableTicketIds('feat: route', '', body, PREFIXES)).toEqual([]);
        });

        it('line-leading keyword that introduces WORDS not an ID does not close ("Closes the loop on TD-5")', () => {
            // Keyword is the first word but introduces prose, not an ID directive.
            expect(extractClosableTicketIds('chore: x', '', 'Closes the loop on TD-5 follow-ups.', PREFIXES))
                .toEqual([]);
        });

        it('reference prose "the closed-loop system, see TD-9" does NOT close TD-9', () => {
            expect(extractClosableTicketIds('docs: y', '', 'Built on the closed-loop system, see TD-9.', PREFIXES))
                .toEqual([]);
        });

        it('list-marker directive "- Fixes TD-3" closes TD-3', () => {
            expect(extractClosableTicketIds('fix: z', '', '## Closed\n- Fixes TD-3\n- TD-4 is deferred', PREFIXES))
                .toEqual(['TD-3']);
        });

        it('emphasis-wrapped directive "**Resolves:** TD-6, TD-7" closes both', () => {
            expect(extractClosableTicketIds('fix: w', '', '**Resolves:** TD-6, TD-7', PREFIXES).sort())
                .toEqual(['TD-6', 'TD-7']);
        });

        it('KNOWN/ACCEPTED: IDs in a parenthetical ON a Closes: line still close', () => {
            // Gating is purely by leading closing-keyword directive, with no
            // parenthetical/code stripping. The /ship "Closes: A, B" comma
            // convention avoids this shape; locked here so the tradeoff is explicit,
            // not a silent surprise. If a real PR hits it, tighten the one shared
            // closer (both callers inherit it automatically).
            const body = 'Closes: TD-100 (supersedes TD-200)';
            expect(extractClosableTicketIds('fix: x', '', body, PREFIXES).sort())
                .toEqual(['TD-100', 'TD-200']);
        });
    });

    describe('TD-873 — revert/relational title cites do NOT close', () => {
        it('the live PTQ-97 instance: revert title parenthetically citing an OPEN ticket does not close it', () => {
            // PR #2098 reverted #2097; its title parenthetically noted that #2097 had
            // masked PTQ-97 (a live, Sean-gated prod outage). The title-always-closes
            // rule marked PTQ-97 Done — the bug TD-873 filed.
            const title = '#2098 revert(poketraqr): restore loud 503 on missing Supabase env (#2097 masked PTQ-97)';
            const out = extractClosableTicketIds(title, '', '', ['PTQ', 'TD', 'NTQ']);
            expect(out).toEqual([]);
            expect(out).not.toContain('PTQ-97');
        });

        it('non-revert parenthetical follow-up cite "(TD-870 follow-up)" does not close TD-870', () => {
            const out = extractClosableTicketIds('#2036 fix(daemon): tighten the gate (TD-870 follow-up)', '', '', PREFIXES);
            expect(out).toEqual([]);
            expect(out).not.toContain('TD-870');
        });

        it('parenthetical cite "(TD-836 follow-up B)" does not close TD-836', () => {
            const out = extractClosableTicketIds('#2007 feat(bethesda): menu (TD-836 follow-up B)', '', '', PREFIXES);
            expect(out).toEqual([]);
        });

        it('revert of a closing PR does NOT re-close the ticket it is undoing (ID outside parens)', () => {
            // Auto-generated revert titles carry the original PR's ticket ID outside
            // parens. Re-closing it would mark Done the very ticket the revert undoes.
            const title = 'revert(nooktraqr): NTQ-1028 — merge user_profiles on account-link (#2104)';
            const out = extractClosableTicketIds(title, '', '', PREFIXES);
            expect(out).toEqual([]);
            expect(out).not.toContain('NTQ-1028');
        });

        it('PRESERVES the convention: a non-revert title with an outside-parens ID still closes', () => {
            // The (nooktraqr) scope is stripped; NTQ-1028 sits outside parens → closes.
            expect(extractClosableTicketIds('fix(nooktraqr): NTQ-1028 — merge user_profiles', '', '', PREFIXES))
                .toEqual(['NTQ-1028']);
        });

        it('PRESERVES branch close on a revert PR (branch is auto-generated, high-signal)', () => {
            // Title contributes nothing (revert), but the branch ID still closes —
            // current behavior, locked so the title-only scope of TD-873 is explicit.
            expect(extractClosableTicketIds('revert(x): undo a thing (#10)', 'seanfitzsimons/td-873-fix', '', PREFIXES))
                .toEqual(['TD-873']);
        });

        it('a revert can still close explicitly via a body Closes: directive', () => {
            const out = extractClosableTicketIds('revert(x): undo (#10)', '', 'Closes: TD-5', PREFIXES);
            expect(out).toEqual(['TD-5']);
        });

        it('does not treat a non-leading "revert" as a revert ("Prevent revert loops, TD-9")', () => {
            // The revert gate is anchored at title start, so an ID in a non-revert
            // title that merely contains the word "revert" still closes.
            expect(extractClosableTicketIds('feat: Prevent revert loops TD-9', '', '', PREFIXES))
                .toEqual(['TD-9']);
        });
    });

    describe('prefix handling', () => {
        it('matches only configured prefixes', () => {
            // JGC is not in PREFIXES → ignored even on a Closes line.
            expect(extractClosableTicketIds('fix: thing', '', 'Closes: JGC-99, TD-5', PREFIXES))
                .toEqual(['TD-5']);
        });

        it('returns [] when no prefixes are configured', () => {
            expect(extractClosableTicketIds('fix: TD-1', 'td-1-branch', 'Closes: TD-1', []))
                .toEqual([]);
        });

        it('webhook single-prefix scope (NTQ-1006): a one-prefix array closes only that prefix', () => {
            // The NookTraqr webhook passes [repoPrefix] (e.g. ['PKT']); a directive
            // naming another team's ID on the same line is not collected.
            const body = 'Closes: PKT-543, NTQ-927';
            expect(extractClosableTicketIds('fix(pokotraqr): ship it', 'feature/slot-3', body, ['PKT']))
                .toEqual(['PKT-543']);
        });
    });
});
