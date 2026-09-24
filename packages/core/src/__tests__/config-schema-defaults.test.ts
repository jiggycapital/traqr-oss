/**
 * Every `(default: …)` in the config interfaces must equal the value that actually ships.
 *
 * WHY THIS EXISTS. `config-schema.ts` states each default TWICE — once as prose in the
 * interface's JSDoc, once as the value in the exported defaults ~150 lines below — and
 * nothing tied them together. Two had drifted, in opposite ways:
 *
 *   intervals.guardian   JSDoc "30s"  ·  actual 60_000   (2x)
 *   intervals.syncCheck  JSDoc "30s"  ·  actual 300_000  (10x)
 *
 * The `guardian` one was not merely untidy — it was actively misleading. PR #4334 (TD-1338)
 * set Guardian's force-push ceiling to 45s under a stated invariant
 * `guard+network < ceiling < cycle interval`, and pinned the upper bound with a literal
 * `60_000` commented `// packages/core/src/config-schema.ts`. A reviewer verifying that
 * literal against its cited source lands on the JSDoc first, reads 30s, and concludes a
 * CORRECT PR violates its own invariant. That happened on 2026-08-31 and cost a
 * near-rejection.
 *
 * A comment cannot be kept in sync by remembering to. This is the cheap instrument that
 * replaces the remembering — a future drift fails here rather than in someone's review.
 *
 * HOW IT READS THE SHIPPED VALUE (#4337 follow-up, 2026-08-31). The first version of this
 * test regex-scraped the values out of the source text: `^\s{6}(\w+): (\d[\d_]*),$`. That
 * pattern only sees a BARE numeric literal at one indent, so every default written as an
 * expression — `trafficCheck: 15 * 60_000` — never entered the map, and the
 * `.filter(literals.has)` below dropped it without a sound. It compared 16 of 29
 * unit-shaped defaults and reported green, and the pinned count could not notice because
 * it counted the DOCUMENTED population, not the COMPARED one. Rewriting
 * `guardian: 60_000` as `guardian: 60 * 1_000` would have silently removed the very field
 * this test was written for.
 *
 * So the values now come from the exported objects themselves — the substrate — which is
 * immune to indentation, formatting and expressions alike. The JSDoc half still parses the
 * source, because prose exists nowhere else.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDefaultDaemonConfig, DEFAULT_GUARDIAN_CONFIG } from '../config-schema.js';

const UNIT_MS: Record<string, number> = { ms: 1, s: 1_000, min: 60_000, h: 3_600_000 };

/**
 * Documented numeric defaults in config-schema.ts, and how many of them are unit-shaped
 * (`30s`, `5min`) and therefore comparable. Bump deliberately when you add one.
 *
 * COMPARED is the load-bearing half: it is the only number that notices a default
 * silently leaving coverage, which is exactly how the expression-literal hole above went
 * unseen. DOCUMENTED catches the other direction — a JSDoc mangled out of the population.
 */
const EXPECTED_DOCUMENTED_DEFAULTS = 39;
const EXPECTED_COMPARED_DEFAULTS = 29;

/** Every numeric leaf in the shipped defaults, by field name. */
function collectShippedValues(
    sources: readonly unknown[] = [getDefaultDaemonConfig('traqr'), DEFAULT_GUARDIAN_CONFIG],
) {
    const byKey = new Map<string, number>();
    const ambiguous = new Set<string>();

    const walk = (node: unknown) => {
        if (!node || typeof node !== 'object' || Array.isArray(node)) return;
        for (const [key, value] of Object.entries(node)) {
            if (typeof value === 'number') {
                // The same field name appears under several parents with DIFFERENT values
                // (`retryStrategies.*.retries`, `.escalateAfterMs` — both live today). None
                // is documented, but resolving one by silently picking a winner is the
                // failure this whole file is about.
                //
                // So an ambiguous key is DROPPED from the map, not merely noted beside it.
                // The first version recorded the ambiguity and still left the
                // first-walked value readable through `byKey`, so the per-key comparison
                // below would have graded a documented field against an arbitrary parent's
                // number — the exact "pick a winner" this comment forbids, one layer down.
                // Now `byKey.get()` returns undefined for such a key and the comparison
                // fails loudly instead. (Caught in cross-review of #4338 by feature1.)
                if (ambiguous.has(key)) continue;
                const seen = byKey.get(key);
                if (seen !== undefined && seen !== value) {
                    byKey.delete(key);
                    ambiguous.add(key);
                } else {
                    byKey.set(key, value);
                }
            } else {
                walk(value);
            }
        }
    };

    for (const source of sources) walk(source);
    return { byKey, ambiguous };
}

describe('config-schema — JSDoc defaults match the shipped values', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'config-schema.ts'),
        'utf8',
    );

    const { byKey, ambiguous } = collectShippedValues();

    /** `/** … (default: 30s) *​/` immediately above `key: number;`. */
    const documented = [...src.matchAll(
        /\/\*\* ([^*]+?) \(default: ([^)]+)\) \*\/\s*\n\s*(\w+)\??: number;/g,
    )].map(([, desc, dflt, key]) => ({ key, desc: desc.trim(), dflt: dflt.trim() }));

    const unitShaped = documented.filter(({ dflt }) => /^\d+(ms|s|min|h)$/.test(dflt));

    it('parses a PINNED number of defaults — a dropped one fails here, loudly', () => {
        // These are magic numbers ON PURPOSE. Two attempts at a self-deriving guard both
        // failed, and the failures are worth recording rather than hiding behind a third.
        // A `> 10` floor let a mangled JSDoc take the suite 17 -> 13 and still pass.
        // Cross-checking two regexes did no better: both key off the `(default: ` literal,
        // so mangling one drops it from BOTH populations symmetrically and they still agree.
        //
        // The cost is real but small: adding a documented numeric default fails these lines
        // until you bump them. That is the correct direction to fail — loudly, at the moment
        // of change, in the file you are already editing.
        expect(documented.length).toBe(EXPECTED_DOCUMENTED_DEFAULTS);
        expect(unitShaped.length).toBe(EXPECTED_COMPARED_DEFAULTS);
    });

    it('resolves every unit-shaped documented default to a shipped value', () => {
        // The assertion the regex version could not make. A documented field that no longer
        // appears in the shipped objects — renamed, moved, or dropped — fails HERE instead
        // of quietly leaving the comparison set.
        // Ambiguous keys are excluded so the two checks name DIFFERENT causes — a field
        // that is absent and one that is contradictory need different fixes.
        const unresolved = unitShaped
            .filter(({ key }) => !byKey.has(key) && !ambiguous.has(key))
            .map(({ key }) => key);
        expect(unresolved).toEqual([]);

        // And one that resolves to two different values is refused rather than guessed.
        const undecidable = unitShaped.filter(({ key }) => ambiguous.has(key)).map(({ key }) => key);
        expect(undecidable).toEqual([]);
    });

    it('never holds a value for a key it called ambiguous', () => {
        // The invariant behind the refusal, asserted on the REAL config: `retryStrategies.*`
        // collides today, so this is a live spot-check rather than a hypothetical. Stated as
        // disjointness rather than a pinned key list, so legitimately making those parents
        // consistent cannot false-fail it.
        //
        // ⚠️ This one CAN go vacuous — reconcile those parents and `ambiguous` empties and it
        // asserts nothing. That is deliberate and safe ONLY because the synthetic case below
        // tests the same mechanism on input that always collides. Do not delete that one.
        const held = [...ambiguous].filter((key) => byKey.has(key));
        expect(held).toEqual([]);
    });

    it('refuses a colliding key on input that always collides, whatever the config does', () => {
        // Raised by feature1 in cross-review of #4342: the live check above stops testing
        // anything the moment `retryStrategies.*` is reconciled — the exact silent-narrowing
        // hazard `EXPECTED_COMPARED_DEFAULTS` guards one function up, reintroduced one function
        // down. Pinning `ambiguous.size` would catch it and false-fail the day someone
        // legitimately fixes the config, which is why that was rejected.
        //
        // Feeding the walk its own fixture resolves the tension instead of trading one failure
        // mode for the other: this can never go vacuous AND can never false-fail, because it
        // does not read the config at all. The live check stays as the real-world spot-check.
        const { byKey: k, ambiguous: a } = collectShippedValues([
            { alpha: { shared: 100, only_a: 1 } },
            { beta: { shared: 200 } },
            { gamma: { shared: 100 } }, // re-visit: must NOT resurrect a winner
        ]);
        expect([...a]).toEqual(['shared']);
        expect(k.has('shared')).toBe(false);
        expect(k.get('only_a')).toBe(1); // unambiguous siblings still resolve
    });

    it('gives the same answer whatever order the sources are walked in', () => {
        // Asked by feature1 in review of #4345: a default-parameter refactor is exactly where
        // walk ORDER could slip silently, since `byKey` is first-writer-wins for keys that do
        // not collide. Checked on the real configs (old hardcoded path vs new default: byKey
        // identical, 40 entries) — but the general property is what makes that safe rather
        // than lucky, so it is asserted here instead of left as a one-off measurement.
        //
        // Order cannot matter by construction: parents that agree write the same value, and
        // parents that disagree DELETE the key and mark it ambiguous, which the `continue`
        // guard then makes permanent. So the outcome is "the value if unanimous, absent if
        // not" — a property of the set of sources, not of their sequence.
        // ⚠️ The two walks must differ AS INPUT TO THE WALK, which is stricter than "the two
        // arrays are reversed". `byKey` is keyed on the LEAF name and a parent is only a
        // container to recurse through, so sources differing solely in their parent key are
        // the SAME write sequence — [X, Y, X] reversed is still [X, Y, X]. A palindromic
        // fixture makes the first assertion compare a computation to itself: it then holds
        // under a walk with NO order-independence whatsoever, and only the pinned outcome on
        // the second assertion does any work. Measured, not argued (feature1, cross-review of
        // #4345): with the previous fixture, deleting `byKey.delete(key)` — which makes the
        // walk first-writer-wins and plainly order-dependent — left this comparison GREEN and
        // failed only the literal below. With the fixture here it fails on the comparison,
        // clash 100 vs 200.
        //
        // Hence: ONE array, mechanically reversed (so the halves cannot drift apart), and an
        // asymmetric leaf (`only_b`) so the two orders are genuinely different inputs.
        const sources = [{ a: { agreed: 7, clash: 100 } }, { b: { clash: 200, only_b: 9 } }];
        const forward = collectShippedValues(sources);
        const reversed = collectShippedValues([...sources].reverse());
        const norm = (r: ReturnType<typeof collectShippedValues>) => ({
            byKey: [...r.byKey.entries()].sort(),
            ambiguous: [...r.ambiguous].sort(),
        });
        expect(norm(forward)).toEqual(norm(reversed));
        expect(norm(forward)).toEqual({
            byKey: [
                ['agreed', 7],
                ['only_b', 9],
            ],
            ambiguous: ['clash'],
        });
    });

    it('treats a legitimate 0 default as seen, not as absent', () => {
        // Why the walk tests `seen !== undefined` rather than truthiness (feature1, #4342):
        // under a truthy check a shipped `0` reads as never-seen, so the next parent's value
        // overwrites it silently and the collision is never recorded.
        const { byKey: k, ambiguous: a } = collectShippedValues([
            { alpha: { zeroed: 0 } },
            { beta: { zeroed: 5 } },
        ]);
        expect([...a]).toEqual(['zeroed']);
        expect(k.has('zeroed')).toBe(false);
    });

    it.each(unitShaped)('$key — JSDoc says $dflt', ({ key, dflt }) => {
        const [, n, unit] = /^(\d+)(ms|s|min|h)$/.exec(dflt)!;
        expect(byKey.get(key)).toBe(Number(n) * UNIT_MS[unit]);
    });
});
