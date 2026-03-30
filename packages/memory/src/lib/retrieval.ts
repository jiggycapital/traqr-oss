/**
 * Multi-Strategy Retrieval + RRF Fusion
 *
 * SearchOrchestrator for Memory Engine v2.
 * Combines semantic, BM25, temporal, and graph search via
 * Reciprocal Rank Fusion. Replaces single-strategy semantic search.
 */

import { getVectorDB } from '../vectordb/index.js'
import { SupabaseVectorProvider } from '../vectordb/supabase.js'
import { generateEmbedding, formatEmbeddingForPgVector } from './embeddings.js'
import { cohereRerank } from './rerank.js'
import type { MemorySearchResult, SearchOptions, Memory } from '../vectordb/types.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SearchStrategy = 'semantic' | 'bm25' | 'temporal' | 'graph'

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

export interface DetectedStrategies {
  strategies: SearchStrategy[]
  temporalRange?: { start: Date; end: Date }
  graphSeedIds?: string[]
}

export interface SearchV2Options extends SearchOptions {
  entityIds?: string[]           // seed IDs for graph search
  strategies?: SearchStrategy[]  // override auto-detection
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
// Strategy Detection (TD-159)
// ---------------------------------------------------------------------------

const DATE_PATTERNS = [
  /\b(yesterday|today|last\s+(week|month|day|year))\b/i,
  /\b(this\s+(week|month|year))\b/i,
  /\b\d{4}-\d{2}(-\d{2})?\b/,                        // 2026-03-15 or 2026-03
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/i,
  /\b(in\s+\d{4})\b/i,                                // "in 2020"
  /\b(\d+\s+(days?|weeks?|months?|years?)\s+ago)\b/i,  // "3 months ago"
  /\b(recent(ly)?|lately|earlier)\b/i,
]

/**
 * Detect which search strategies should be activated for a query.
 * Semantic + BM25 always run. Temporal activates on date patterns.
 * Graph activates when entity seed IDs are provided.
 */
export function detectStrategies(
  query: string,
  entityIds?: string[],
): DetectedStrategies {
  const strategies: SearchStrategy[] = ['semantic', 'bm25']

  const hasDatePattern = DATE_PATTERNS.some((p) => p.test(query))
  let temporalRange: { start: Date; end: Date } | undefined

  if (hasDatePattern) {
    strategies.push('temporal')
    temporalRange = parseTemporalRange(query)
  }

  if (entityIds && entityIds.length > 0) {
    strategies.push('graph')
  }

  return {
    strategies,
    temporalRange,
    graphSeedIds: entityIds,
  }
}

/**
 * Parse temporal references in a query to a date range.
 * Falls back to 30-day lookback for ambiguous patterns.
 */
export function parseTemporalRange(query: string): { start: Date; end: Date } {
  const now = new Date()
  const end = now

  // "yesterday"
  if (/\byesterday\b/i.test(query)) {
    const start = new Date(now)
    start.setDate(start.getDate() - 1)
    start.setHours(0, 0, 0, 0)
    return { start, end }
  }

  // "last week/month/year"
  const lastMatch = query.match(/\blast\s+(week|month|year|day)\b/i)
  if (lastMatch) {
    const start = new Date(now)
    switch (lastMatch[1].toLowerCase()) {
      case 'day': start.setDate(start.getDate() - 1); break
      case 'week': start.setDate(start.getDate() - 7); break
      case 'month': start.setMonth(start.getMonth() - 1); break
      case 'year': start.setFullYear(start.getFullYear() - 1); break
    }
    return { start, end }
  }

  // "N days/weeks/months/years ago"
  const agoMatch = query.match(/\b(\d+)\s+(days?|weeks?|months?|years?)\s+ago\b/i)
  if (agoMatch) {
    const n = parseInt(agoMatch[1], 10)
    const unit = agoMatch[2].toLowerCase().replace(/s$/, '')
    const start = new Date(now)
    switch (unit) {
      case 'day': start.setDate(start.getDate() - n); break
      case 'week': start.setDate(start.getDate() - n * 7); break
      case 'month': start.setMonth(start.getMonth() - n); break
      case 'year': start.setFullYear(start.getFullYear() - n); break
    }
    return { start, end }
  }

  // "March 2026" or "in 2026"
  const monthYearMatch = query.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/i,
  )
  if (monthYearMatch) {
    const months: Record<string, number> = {
      january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
      july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    }
    const month = months[monthYearMatch[1].toLowerCase()]
    const year = parseInt(monthYearMatch[2], 10)
    const start = new Date(year, month, 1)
    const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999)
    return { start, end: monthEnd }
  }

  // "2026-03-15" or "2026-03"
  const isoMatch = query.match(/\b(\d{4})-(\d{2})(?:-(\d{2}))?\b/)
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10)
    const month = parseInt(isoMatch[2], 10) - 1
    if (isoMatch[3]) {
      const day = parseInt(isoMatch[3], 10)
      const start = new Date(year, month, day, 0, 0, 0, 0)
      const dayEnd = new Date(year, month, day, 23, 59, 59, 999)
      return { start, end: dayEnd }
    }
    const start = new Date(year, month, 1)
    const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999)
    return { start, end: monthEnd }
  }

  // "in 2020"
  const yearMatch = query.match(/\bin\s+(\d{4})\b/i)
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10)
    return { start: new Date(year, 0, 1), end: new Date(year, 11, 31, 23, 59, 59, 999) }
  }

  // Default: 30-day lookback
  const start = new Date(now)
  start.setDate(start.getDate() - 30)
  return { start, end }
}

// ---------------------------------------------------------------------------
// Entity Resolution from Query (TD-180)
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'must',
  'how', 'what', 'when', 'where', 'why', 'who', 'which', 'that', 'this',
  'about', 'with', 'from', 'into', 'for', 'and', 'or', 'but', 'not',
  'of', 'in', 'on', 'at', 'to', 'by', 'up', 'if', 'so', 'no', 'my',
  'i', 'me', 'we', 'you', 'he', 'she', 'it', 'they', 'them', 'our',
  'your', 'his', 'her', 'its', 'their', 'all', 'each', 'any', 'some',
  'say', 'said', 'tell', 'think', 'know', 'use', 'work', 'like',
])

/**
 * Find known entities mentioned in a search query.
 * Tokenizes the query, filters stopwords, looks up against memory_entities.
 * Returns entity IDs for graph search activation.
 */
export async function findEntitiesInQuery(
  query: string,
  provider: SupabaseVectorProvider,
): Promise<string[]> {
  // Tokenize: split on spaces + punctuation, filter stopwords
  const words = query
    .split(/[\s,.!?;:'"()\[\]{}]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !STOPWORDS.has(w.toLowerCase()))

  // Also extract bigrams for multi-word entity names
  const rawWords = query.split(/\s+/)
  const bigrams: string[] = []
  for (let i = 0; i < rawWords.length - 1; i++) {
    bigrams.push(`${rawWords[i]} ${rawWords[i + 1]}`)
  }

  const allTokens = [...new Set([...words, ...bigrams])]
  if (allTokens.length === 0) return []

  try {
    const entities = await provider.findEntitiesByNames(allTokens)
    return entities.map((e) => e.id)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Search Orchestrator (TD-160)
// ---------------------------------------------------------------------------

/**
 * Multi-strategy search with RRF fusion.
 *
 * Runs semantic + BM25 in parallel (always), plus temporal and graph
 * when detected. Fuses results via Reciprocal Rank Fusion.
 * Returns MemorySearchResult[] for backward compatibility.
 */
export async function searchMemoriesV2(
  query: string,
  options: SearchV2Options = {},
): Promise<MemorySearchResult[]> {
  const db = getVectorDB()

  // Gate: provider must support v2 methods
  if (!(db instanceof SupabaseVectorProvider)) {
    return db.search(query, options)
  }

  const provider = db as SupabaseVectorProvider
  const topN = options.limit || 10
  const k = options.rrfK || 60
  const overFetchLimit = topN * 2

  // 0.5 Auto-resolve entities from query (if no explicit entityIds)
  let resolvedEntityIds = options.entityIds || []
  if (resolvedEntityIds.length === 0) {
    resolvedEntityIds = await findEntitiesInQuery(query, provider)
  }

  // 1. Detect strategies (with resolved entity IDs)
  const detected = options.strategies
    ? { strategies: options.strategies, temporalRange: undefined, graphSeedIds: resolvedEntityIds }
    : detectStrategies(query, resolvedEntityIds)

  // 2. Generate embedding ONCE
  const embeddingResult = await generateEmbedding(query)
  const embeddingStr = formatEmbeddingForPgVector(embeddingResult.embedding)

  // 3. Run active strategies in parallel
  // Keep full semantic results for hydration + BM25 content for reranking
  let semanticFullResults: MemorySearchResult[] = []
  let bm25ContentMap = new Map<string, string>()

  const strategyPromises: Promise<StrategyResult>[] = []

  if (detected.strategies.includes('semantic')) {
    strategyPromises.push(
      provider
        .search(query, {
          ...options,
          limit: overFetchLimit,
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
          return { strategy: 'semantic', items: [] }
        }),
    )
  }

  if (detected.strategies.includes('bm25')) {
    strategyPromises.push(
      provider
        .bm25Search(query, {
          category: options.category,
          limit: overFetchLimit,
        })
        .then((results) => {
          bm25ContentMap = new Map(results.map((r) => [r.id, r.content]))
          return {
            strategy: 'bm25',
            items: results.map((r, i) => ({ id: r.id, rank: i + 1 })),
          }
        })
        .catch(() => ({ strategy: 'bm25', items: [] })),
    )
  }

  if (detected.strategies.includes('temporal') && detected.temporalRange) {
    strategyPromises.push(
      provider
        .temporalSearch(query, detected.temporalRange.start, detected.temporalRange.end, {
          limit: overFetchLimit,
          precomputedEmbedding: embeddingStr,
        })
        .then((results) => ({
          strategy: 'temporal',
          items: results.map((r, i) => ({ id: r.id, rank: i + 1 })),
        }))
        .catch(() => ({ strategy: 'temporal', items: [] })),
    )
  }

  if (detected.strategies.includes('graph') && detected.graphSeedIds?.length) {
    strategyPromises.push(
      provider
        .graphSearch(detected.graphSeedIds, {
          limit: overFetchLimit,
        })
        .then((results) => ({
          strategy: 'graph',
          items: results.map((r, i) => ({ id: r.id, rank: i + 1 })),
        }))
        .catch(() => ({ strategy: 'graph', items: [] })),
    )
  }

  // 4. Fuse via RRF
  const strategyResults = await Promise.all(strategyPromises)

  // Observability: log when entities activate graph search
  if (resolvedEntityIds.length > 0) {
    const strategyLog = strategyResults.map((sr) => `${sr.strategy}:${sr.items.length}`).join(', ')
    console.log(`[retrieval] q="${query.slice(0, 50)}" strategies=[${strategyLog}] entities=${resolvedEntityIds.length}`)
  }

  const fused = reciprocalRankFusion(strategyResults, k, topN)

  if (fused.length === 0) {
    return []
  }

  // 4.5 Optional: Cohere rerank (graceful — skips if no API key)
  const rerankDocs = fused.map((f) => ({
    id: f.id,
    content: semanticFullResults.find((r) => r.id === f.id)?.content || bm25ContentMap.get(f.id) || '',
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

  // 5. Hydrate: map fused items to full MemorySearchResult
  const semanticMap = new Map(semanticFullResults.map((r) => [r.id, r]))
  const hydratedResults: MemorySearchResult[] = []
  const idsToFetch: { id: string; normalizedScore: number }[] = []

  for (const item of fused) {
    const semantic = semanticMap.get(item.id)
    if (semantic) {
      hydratedResults.push({
        ...semantic,
        relevanceScore: item.normalizedScore,
      })
    } else {
      idsToFetch.push({ id: item.id, normalizedScore: item.normalizedScore })
    }
  }

  // Fetch non-semantic results by ID (BM25/graph-only hits)
  if (idsToFetch.length > 0) {
    const fetched = await Promise.all(
      idsToFetch.map(({ id }) => provider.getById(id).catch(() => null)),
    )
    for (let i = 0; i < fetched.length; i++) {
      const memory = fetched[i]
      if (!memory) continue
      hydratedResults.push({
        ...memory,
        currentConfidence: memory.originalConfidence,
        similarity: 0,
        relevanceScore: idsToFetch[i].normalizedScore,
      })
    }
  }

  // 6. Final sort by RRF score
  hydratedResults.sort((a, b) => b.relevanceScore - a.relevanceScore)

  return hydratedResults.slice(0, topN)
}
