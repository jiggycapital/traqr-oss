/**
 * Retrieval — semantic search + classification ceiling + exact-ID recall.
 *
 * SearchOrchestrator for Memory Engine v2. Semantic is the ONLY strategy:
 * the bm25/temporal/graph fusion legs (TD-158/159/160) were dead in prod for
 * months (42P01 — see TD-894) and were torn down in TD-906 Slice C. The one
 * proven BM25 upside — exact-ID/acronym recall — was reclaimed semantically
 * in TD-906 Slice B (step 6.7 below). RRF scoring is retained as the ranking
 * contract (rank-monotonic over the single strategy).
 */

import { getVectorDB } from '../vectordb/index.js'
import { generateEmbedding, formatEmbeddingForPgVector } from './embeddings.js'
import { cohereRerank } from './rerank.js'
import { CLASSIFICATION_RANK, ACCESS_LEVEL_MAX_CLASSIFICATION, allowedClassifications } from '../vectordb/types.js'
import type {
  MemorySearchResult,
  SearchOptions,
  MemoryClassification,
  MemoryAccessLevel,
} from '../vectordb/types.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Narrowed to 'semantic' in TD-906 Slice C (bm25/temporal/graph torn down).
export type SearchStrategy = 'semantic'

export interface StrategyResult {
  strategy: string
  items: { id: string; rank: number }[] // 1-based rank
}

export interface FusedItem {
  id: string
  rrfScore: number        // raw sum of 1/(k+rank) per strategy
  normalizedScore: number // 0-1 (divided by max score in set)
  strategies: string[]    // which strategies contributed this result
}

export interface SearchV2Options extends SearchOptions {
  rrfK?: number                  // RRF constant, default 60
}

// ---------------------------------------------------------------------------
// Reciprocal Rank Fusion (TD-158)
// ---------------------------------------------------------------------------

/**
 * Fuse ranked results from multiple search strategies via RRF.
 *
 * For each item across all strategies: score += 1/(k + rank)
 * Items appearing in multiple strategies accumulate higher scores.
 *
 * @param strategyResults - Ranked results from each strategy
 * @param k - RRF constant (default 60, standard in literature)
 * @param topN - Max results to return
 */
export function reciprocalRankFusion(
  strategyResults: StrategyResult[],
  k: number = 60,
  topN: number = 20,
): FusedItem[] {
  const scoreMap = new Map<string, { rrfScore: number; strategies: string[] }>()

  for (const sr of strategyResults) {
    for (const item of sr.items) {
      const existing = scoreMap.get(item.id) || { rrfScore: 0, strategies: [] }
      existing.rrfScore += 1 / (k + item.rank)
      existing.strategies.push(sr.strategy)
      scoreMap.set(item.id, existing)
    }
  }

  const sorted = [...scoreMap.entries()]
    .map(([id, { rrfScore, strategies }]) => ({
      id,
      rrfScore,
      normalizedScore: 0,
      strategies,
    }))
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, topN)

  // Normalize to 0-1 range
  const maxScore = sorted.length > 0 ? sorted[0].rrfScore : 1
  for (const item of sorted) {
    item.normalizedScore = maxScore > 0 ? item.rrfScore / maxScore : 0
  }

  return sorted
}

// ---------------------------------------------------------------------------
// Classification Ceiling — defense-in-depth choke point (TD-810)
// ---------------------------------------------------------------------------

/**
 * Drop any result whose classification exceeds the ceiling for the caller.
 *
 * TD-810 origin: the (since torn-down, TD-906 Slice C) bm25/temporal/graph
 * legs and their getById hydration were classification-BLIND, so this
 * post-filter closed that leak at the result boundary. It is RETAINED as the
 * defense-in-depth backstop on the live path: the semantic RPC already
 * DB-filters on p_max_classification, but step 6.5 re-enforces the ceiling at
 * the boundary and step 6.7 (exact-ID augmentation) depends on it to never
 * widen the caller's tier (integration-test Sections 1 + 1b pin both).
 *
 * FAIL-SAFE: when neither maxClassification nor accessLevel is provided there is
 * no ceiling, so the input is returned UNCHANGED (byte-identical to pre-TD-810).
 * FAIL-CLOSED: an unknown classification string (not in CLASSIFICATION_RANK) is
 * dropped; a missing/undefined classification is treated as 'public' (kept).
 *
 * @param results        - hydrated, sorted results to filter
 * @param accessLevel    - caller's access level → resolves a max classification
 * @param maxClassification - explicit ceiling; overrides accessLevel when set
 */
export function applyClassificationCeiling<T extends { classification?: MemoryClassification }>(
  results: T[],
  accessLevel?: MemoryAccessLevel,
  maxClassification?: MemoryClassification,
): T[] {
  // Resolve the ceiling. Explicit maxClassification wins; else derive from
  // accessLevel; else no ceiling → fail-safe pass-through.
  const ceiling = resolveClassificationCeiling(accessLevel, maxClassification)

  if (!ceiling) return results

  const ceilingRank = CLASSIFICATION_RANK[ceiling]

  return results.filter((row) => {
    const cls = row.classification ?? 'public'
    const rank = CLASSIFICATION_RANK[cls as MemoryClassification]
    // Unknown classification string → not in the rank table → fail closed.
    if (rank === undefined) return false
    return rank <= ceilingRank
  })
}

/**
 * Resolve the effective classification ceiling for a caller.
 *
 * Explicit maxClassification wins; else derive from accessLevel; else undefined
 * (= no ceiling, fail-safe). Shared by every surface that filters on the
 * accessLevel/maxClassification pair (search, browse, getById) so the mapping
 * lives in exactly one place (TD-883).
 */
export function resolveClassificationCeiling(
  accessLevel?: MemoryAccessLevel,
  maxClassification?: MemoryClassification,
): MemoryClassification | undefined {
  return (
    maxClassification ??
    (accessLevel ? ACCESS_LEVEL_MAX_CLASSIFICATION[accessLevel] : undefined)
  )
}

/**
 * The list of classification values at or below a ceiling, for DB-level
 * `.in('classification', ...)` filtering (TD-883 browse surface).
 *
 * No ceiling → undefined (caller must skip filtering → unchanged behavior).
 * NOTE: a NULL classification column hydrates to 'internal' (rowToMemory's
 * `?? 'internal'`), so callers filtering at the DB must additionally admit NULL
 * rows whenever 'internal' is in this list — `.in()` alone never matches NULL.
 */
export function allowedClassificationsForCeiling(
  accessLevel?: MemoryAccessLevel,
  maxClassification?: MemoryClassification,
): MemoryClassification[] | undefined {
  // Delegates to the copy in vectordb/types.ts. That module is the one BOTH the
  // providers and this layer can import without a cycle (retrieval → vectordb/index
  // → postgres), so the providers cannot import this function — which is how the
  // second copy got written in the first place. One implementation, imported twice.
  return allowedClassifications(accessLevel, maxClassification)
}

// ---------------------------------------------------------------------------
// Exact-ID / acronym recall augmentation (TD-906 Slice B)
// ---------------------------------------------------------------------------

/**
 * How deep to scan the semantic candidate pool for an exact-ID rescue. Only
 * applied when the query carries an exact-ID/acronym token (otherwise the
 * over-fetch is unchanged), so conceptual queries pay nothing.
 */
export const EXACT_ID_RECALL_POOL = 100

/**
 * The confidence below which a memory cannot retrieve ITSELF.
 *
 * `search_memories` orders by `relevance_score = similarity * current_confidence
 * * citationBoost`, not by similarity — and for a fresh row `current_confidence`
 * IS `original_confidence` (calculate_current_confidence decays from it, and
 * decay is ~0 at age 0). So confidence is a flat multiplier on rank, unbounded
 * below: a 0.5-confidence row must clear 1.8x the similarity of a 0.9-confidence
 * row to outrank it, which is impossible above similarity ~0.55.
 *
 * Measured 2026-09-14 against the live corpus (11,654 candidate rows) by querying
 * rows with their OWN embedding — a perfect self-match, similarity 1.0000, rank 1
 * of 11,654 on similarity alone. Rank by relevance_score:
 *
 *     confidence 0.50 -> rank 340, 477     confidence 0.70 -> rank 1
 *     confidence 0.60 -> rank 109          confidence 0.85 -> rank 1
 *                                          confidence 0.90 -> rank 1
 *                                          confidence 1.00 -> rank 1
 *
 * The candidate pool is `limit * 2`, capped by EXACT_ID_RECALL_POOL above at 100.
 * So 0.60 (rank 109) is already outside the DEEPEST pool the system can request:
 * a row written at 0.60 is unreachable on its own verbatim text, at any limit.
 *
 * This is a FLOOR, not a quality bar. Express low trust in the CONTENT — it is
 * the embedded text, so it is the one place a caveat actually reaches the agent
 * that retrieves the row. Never express it by lowering confidence, which does not
 * caveat a memory, it deletes it from retrieval.
 *
 * NOT via `sourceReliability`: that field is declared on MemoryInput and accepted
 * by the memory-MCP tool schemas, but no provider writes it and traqr_memories has
 * no column for it (verified 2026-09-14 — zero references in postgres.ts,
 * supabase.ts and converters.ts, and it is absent from the INSERT column list).
 * It is silently discarded on every write. Tracked as TD-1456.
 *
 * NOTE: the cliff is a property of THIS corpus's confidence distribution, so it
 * drifts. The durable fix (bounding the multiplier's influence) is TD-1455.
 */
export const RETRIEVAL_CONFIDENCE_FLOOR = 0.7

/** All-caps function words a caps-typing user might use — never a ticker/acronym. */
const ACRONYM_STOPWORDS = new Set([
  'AND', 'THE', 'FOR', 'NOT', 'ALL', 'ANY', 'WITH', 'FROM', 'THIS', 'THAT',
  'WHAT', 'WHEN', 'WHERE', 'WHY', 'HOW', 'YOU', 'ARE', 'WAS', 'WERE', 'HAS',
  'HAD', 'CAN', 'WHO', 'WILL', 'OUR',
])

/** Escape a string for literal use inside a RegExp (tokens may carry `.`, e.g. BRK.B). */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Extract high-precision exact-match tokens from a query: structured IDs
 * (ticket keys like TD-865, JGC-294, MTQ-129) and upper-case acronyms/tickers
 * (HNSW, RRF, AVGO). These are exactly the queries where semantic embeddings
 * under-retrieve (TD-894 recall A/B) — a short ID/acronym carries little
 * distributional signal, so the literal-matching memory ranks low or off the
 * page. Lower-case prose yields NOTHING here, which is what keeps the
 * augmentation a no-op on conceptual queries (no steering-memory eviction).
 *
 * A bare acronym that is merely the prefix of a captured ID (the `MTQ` in
 * `MTQ-129`) is dropped — it would match every ticket in that team and is noise.
 */
export function extractExactIdTokens(query: string): string[] {
  const idTokens: string[] = []
  for (const m of query.matchAll(/\b[A-Z]{2,}-\d+\b/g)) idTokens.push(m[0])
  const idPrefixes = new Set(idTokens.map((t) => t.split('-')[0]))

  const tokens = new Set<string>(idTokens)
  for (const m of query.matchAll(/\b[A-Z][A-Z0-9]{2,}\b/g)) {
    const t = m[0]
    if (idPrefixes.has(t) || ACRONYM_STOPWORDS.has(t)) continue
    tokens.add(t)
  }
  return [...tokens]
}

/**
 * From a candidate pool (already classification-filtered semantic results), the
 * entries whose content/summary/tags name ANY of `tokens` as a whole token,
 * excluding ids already in `excludeIds`. Pool order is preserved (the rows were
 * semantically ranked) so the caller appends them BELOW the curated head without
 * re-ranking.
 *
 * Matched case-SENSITIVELY at WORD BOUNDARIES — IDs/acronyms are upper-case
 * canonical, so a short token (`SE`, `MA`) never fires on lower-case prose or
 * inside a larger token (`SE` ⊄ `SEC`, `TD-916` ⊄ `TD-9161`). Same guard shape
 * as the coordination prior-work matcher (TD-917).
 */
export function findExactIdMatches<
  T extends { id: string; content: string; summary?: string; tags?: string[] },
>(pool: readonly T[], tokens: readonly string[], excludeIds: ReadonlySet<string>): T[] {
  if (tokens.length === 0) return []
  const re = new RegExp(`\\b(?:${tokens.map(escapeRegExp).join('|')})\\b`)
  const out: T[] = []
  for (const row of pool) {
    if (excludeIds.has(row.id)) continue
    const haystack = `${row.content}\n${row.summary ?? ''}\n${(row.tags ?? []).join(' ')}`
    if (re.test(haystack)) out.push(row)
  }
  return out
}

/**
 * Append exact-ID recall `matches` BELOW the curated `head`, capped at `topN`.
 * Augment-not-rerank (mem 03618ca7): the head keeps its order; only the weakest
 * head rows are displaced when matches need the room — and only ever on a query
 * that carried an exact-ID token, so conceptual recall is untouched.
 */
export function appendExactIdMatches<T extends { id: string }>(
  head: readonly T[],
  matches: readonly T[],
  topN: number,
): T[] {
  if (matches.length === 0) return [...head]
  const capped = matches.slice(0, topN)
  const keepHead = Math.max(0, topN - capped.length)
  return [...head.slice(0, keepHead), ...capped]
}

// ---------------------------------------------------------------------------
// Search Orchestrator (TD-160)
// ---------------------------------------------------------------------------

/**
 * Semantic search with RRF-shaped scoring.
 *
 * SEMANTIC-ONLY: TD-894 Path B stopped auto-invoking the dead bm25/temporal/
 * graph legs (42P01 in prod for months; re-enabling regressed curated-memory
 * recall); TD-906 Slice C then removed the legs, their `options.strategies`
 * override, and the getById hydration of non-semantic hits entirely. The one
 * proven BM25 upside — exact-ID/acronym recall — lives on semantically at
 * step 6.7 (TD-906 Slice B). Returns MemorySearchResult[] for backward
 * compatibility.
 */
export async function searchMemoriesV2(
  query: string,
  options: SearchV2Options = {},
): Promise<MemorySearchResult[]> {
  const db = getVectorDB()

  const provider = db
  const topN = options.limit || 10
  const k = options.rrfK || 60
  const overFetchLimit = topN * 2

  // TD-906 Slice B: when the query names an exact identifier (ticket ID like
  // TD-865, acronym like HNSW), the literal-matching memory ranks low or off the
  // page semantically. Scan deeper so the augmentation step (6.7) can rescue it.
  // Empty for ordinary prose → the semantic fetch is unchanged.
  const exactIdTokens = extractExactIdTokens(query)
  const semanticOverFetch =
    exactIdTokens.length > 0 ? Math.max(overFetchLimit, EXACT_ID_RECALL_POOL) : overFetchLimit

  // 2. Generate embedding ONCE
  const embeddingResult = await generateEmbedding(query)
  const embeddingStr = formatEmbeddingForPgVector(embeddingResult.embedding)

  // 3. Run the semantic strategy (keep the full results for hydration).
  //
  // TD-885 regression-guard fidelity: the classification post-filter (step 6.5)
  // is exercised end-to-end by classification-enforcement.integration.test.ts via
  // a fake provider that emits over-tier rows from EACH strategy below. If you add
  // a NEW retrieval strategy here, add a fake over-tier row for it in that test's
  // fakeProvider — otherwise its "0 over-tier rows across every path" assertion
  // passes blind to the new path, and a classification leak ships green.
  let semanticFullResults: MemorySearchResult[] = []
  // TD-796 (the design half, unshipped since #1744): a strategy that ERRORED is
  // recorded, not just logged. A per-strategy catch is still right — one dead leg
  // must not kill a search the others can answer (TD-894) — but it must not be the
  // whole story, because with one strategy "it failed" and "it found nothing" then
  // render identically. See the total-failure check below.
  const strategyErrors: unknown[] = []
  const strategyResults: StrategyResult[] = [
    await provider
      .search(query, {
        ...options,
        limit: semanticOverFetch,
        precomputedEmbedding: embeddingStr,
      })
      .then((results) => {
        semanticFullResults = results
        return {
          strategy: 'semantic',
          items: results.map((r, i) => ({ id: r.id, rank: i + 1 })),
        }
      })
      .catch((err) => {
        console.warn('[retrieval] Semantic search failed:', err)
        strategyErrors.push(err)
        return { strategy: 'semantic', items: [] }
      }),
  ]

  // 3.5 TD-796: EVERY strategy errored → the DB never answered the question. The
  // old code returned [] here, which is byte-identical to "no memory matches" —
  // that is how a fleet-wide traqr-db outage renders in every agent's Phase 0 as a
  // calm `total: 0` (2026-09-04: 5+ hours, six slots, orient reduced to warning
  // humans to distrust the number). `console.warn` goes to the MCP server's stderr,
  // which no agent reads.
  //
  // Throwing is safe because it defeats no handler — it REACHES the ones already
  // written: memory_search + memory_pulse catch it into errorResult (memory-mcp
  // tools.ts), routes/search.ts returns HTTP 500 with the message, and cli/verify.ts
  // wants the throw. All four previously received a silent empty array instead.
  // Same shape DevOps1 shipped for @traqr/kv the same night in #4517: re-raise the
  // timeout rather than let it fold into a "key absent" answer.
  if (strategyErrors.length > 0 && strategyErrors.length === strategyResults.length) {
    const first = strategyErrors[0]
    const detail = first instanceof Error ? first.message : String(first)
    const unavailable = new Error(
      `Memory search unavailable: all ${strategyResults.length} retrieval strategy(ies) failed. ` +
        `This is a FAILURE, not an empty result set — do not read it as "no memories match". ` +
        `Cause: ${detail}`,
    )
    // Assigned rather than passed as `new Error(msg, { cause })` — that overload
    // needs lib ES2022 and this package targets lower; tsc rejects the 2-arg form.
    ;(unavailable as Error & { cause?: unknown }).cause = first
    throw unavailable
  }

  // 4. Score via RRF — with a single strategy this is a rank-monotonic
  // pass-through of the semantic order; kept as the scoring contract.
  //
  // TD-810: when a classification ceiling will apply, over-fetch the fused pool
  // so the post-filter can drop over-tier rows and still return up to topN.
  // No accessLevel/maxClassification → fuseLimit === topN → behavior unchanged.
  const fuseLimit = options.accessLevel || options.maxClassification ? overFetchLimit : topN
  const fused = reciprocalRankFusion(strategyResults, k, fuseLimit)

  if (fused.length === 0) {
    return []
  }

  // 4.5 Optional: Cohere rerank (graceful — skips if no API key)
  const rerankDocs = fused.map((f) => ({
    id: f.id,
    content: semanticFullResults.find((r) => r.id === f.id)?.content || '',
  })).filter((d) => d.content.length > 0)

  if (rerankDocs.length > 0) {
    const reranked = await cohereRerank(query, rerankDocs, topN)
    if (reranked) {
      const rerankMap = new Map(reranked.map((r) => [r.id, r.relevanceScore]))
      for (const item of fused) {
        const cohereScore = rerankMap.get(item.id)
        if (cohereScore !== undefined) {
          item.normalizedScore = cohereScore
        }
      }
      fused.sort((a, b) => b.normalizedScore - a.normalizedScore)
    }
  }

  // 5. Hydrate: map fused items to full MemorySearchResult. Every fused id
  // comes from the semantic pool by construction (semantic is the only
  // strategy), so no secondary getById hydration exists anymore (TD-906
  // Slice C removed the classification-blind hydration of non-semantic hits).
  const semanticMap = new Map(semanticFullResults.map((r) => [r.id, r]))
  const hydratedResults: MemorySearchResult[] = []

  for (const item of fused) {
    const semantic = semanticMap.get(item.id)
    if (semantic) {
      hydratedResults.push({
        ...semantic,
        relevanceScore: item.normalizedScore,
      })
    }
  }

  // 6. Final sort by RRF score
  hydratedResults.sort((a, b) => b.relevanceScore - a.relevanceScore)

  // 6.5 TD-810: defense-in-depth classification choke point. Drops any row above
  // the caller's ceiling at the result boundary — the semantic RPC already
  // DB-filters, so this is the fail-safe backstop (see applyClassificationCeiling
  // docstring). Fail-safe: no ceiling → unchanged.
  const filtered = applyClassificationCeiling(hydratedResults, options.accessLevel, options.maxClassification)

  const finalResults = filtered.slice(0, topN)

  // 6.7 TD-906 Slice B — exact-ID/acronym recall augmentation (augment-not-rerank).
  // Semantic embeddings under-retrieve literal identifiers (ticket IDs like TD-865,
  // acronyms like HNSW) — the one proven BM25 upside (TD-894 recall A/B). Reclaim
  // ONLY that: rescue any deeper-pool semantic candidate that names the query's
  // exact-ID token and APPEND it below the curated head. No exact-ID token → the
  // block is skipped, so conceptual recall (and Sean's steering memories) stays
  // byte-identical to pre-TD-906. The pool is already classification-filtered by the
  // semantic RPC; applyClassificationCeiling re-runs as a defense-in-depth backstop
  // so the augmentation can never widen the caller's tier.
  let returnedResults = finalResults
  if (exactIdTokens.length > 0 && finalResults.length > 0) {
    const headIds = new Set(finalResults.map((r) => r.id))
    const matches = applyClassificationCeiling(
      findExactIdMatches(semanticFullResults, exactIdTokens, headIds),
      options.accessLevel,
      options.maxClassification,
    )
    if (matches.length > 0) {
      // Keep the tail strictly below the head's weakest score so the array stays
      // monotonic non-increasing (and clearly reads as augmentation, not a re-rank).
      const tailCeil = Math.max(0, finalResults[finalResults.length - 1].relevanceScore)
      const tail = matches.map((m, i) => ({ ...m, relevanceScore: tailCeil - (i + 1) * 1e-6 }))
      returnedResults = appendExactIdMatches(finalResults, tail, topN)
    }
  }

  // 7. TD-817: feedback write path — bump times_returned on what was ACTUALLY
  // returned to the caller (not the 2x over-fetched strategy candidates).
  // Awaited but guarded: a counter failure must never fail the search, and
  // fire-and-forget is the TD-830 unwatched-write class.
  if (returnedResults.length > 0) {
    try {
      await provider.bumpReturned(returnedResults.map((r) => r.id))
    } catch (err) {
      console.warn('[retrieval] Failed to bump times_returned:', err)
    }
  }

  return returnedResults
}
