/**
 * High-Level Memory Operations
 *
 * Application-level interface for the memory system.
 * Wraps the vectordb abstraction with convenience functions.
 */

import { getVectorDB } from '../vectordb/index.js'
import { CATEGORY_EMOJI } from './formatting.js'
import { generateEmbedding, formatEmbeddingForPgVector, checkEmbeddingHealth, type EmbeddingHealthStatus } from './embeddings.js'
import { borderlineDecision, type MaskedMemory } from './borderline.js'
import { processEntitiesForMemory } from './entity-pipeline.js'
import { getUserId } from './client.js'
import type {
  Memory,
  MemoryInput,
  MemorySearchResult,
  MemoryUpdate,
  MemoryExport,
  MemoryStatsRow,
  SearchOptions,
  MemoryCategory,
  MemoryAccessLevel,
  MemoryClassification,
} from '../vectordb/types.js'

// Re-export types
export type {
  Memory,
  MemoryInput,
  MemorySearchResult,
  MemoryUpdate,
  MemoryExport,
  SearchOptions,
  MemoryCategory,
}

// ============================================================
// CORE OPERATIONS
// ============================================================

export async function storeMemory(input: MemoryInput): Promise<Memory> {
  const db = getVectorDB()
  return db.store(input)
}

// ============================================================
// COSINE TRIAGE PIPELINE (v2)
// ============================================================

export type TriageZone = 'noop' | 'add' | 'borderline'
export type TriageAction = 'skipped' | 'stored' | 'extended' | 'related' | 'metadata_updated'

export interface TriageOptions {
  noopThreshold?: number  // default 0.90
  addThreshold?: number   // default 0.60
  retireThreshold?: number // default DEFAULT_RETIRE_THRESHOLD (0.80)
  /** Test seam: replaces the LLM borderline call. Production never passes it. */
  decide?: typeof borderlineDecision
}

/**
 * TD-1334 — the similarity a borderline match must reach before triage may RETIRE it.
 *
 * Three paths retire the existing row: the LLM's UPDATE (invalidate/supersede), its CORRECT
 * (archive + supersede), and the length heuristic's "new is longer" branch. Below this floor
 * each one now stores the new row beside the old with a `related` edge instead.
 *
 * Measured on traqr-db 2026-09-23 over 30 days of `mcp-pulse` writes: 666 rows retired, 620 of
 * them (93%) by a match under 0.80, 461 under 0.75. A hand-graded sample of 15 across three
 * bands: under 0.70, 0 of 5 were the same claim (a sell-application population note retired by
 * a decimal-precision note; a JGC-518 fix ARCHIVED as "corrected" by an unrelated lesson);
 * 0.70–0.80, at most 1 of 5; 0.80+, 4 of 5 were genuine re-statements (an IBKR sleeve refresh
 * 8/24 → 8/26, ma_50 re-described). Two notes about one subject in one vocabulary land in
 * 0.60–0.80 without being one claim, and the LLM verdict alone does not separate them.
 *
 * The asymmetry sets the direction: a wrongly kept row is still found, dated, next to its
 * successor; a wrongly retired row drops out of search with nothing to say it went.
 * Deliberate corrections have their own path (`memory_correct`), which this does not touch.
 */
export const DEFAULT_RETIRE_THRESHOLD = 0.80

export function mayRetire(similarity: number, opts: TriageOptions = {}): boolean {
  return similarity >= (opts.retireThreshold ?? DEFAULT_RETIRE_THRESHOLD)
}

export interface TriageResult {
  memory: Memory
  zone: TriageZone
  action: TriageAction
  similarity: number
  matchedMemoryId?: string
  relationshipId?: string
  // Backward-compat fields
  deduplicated: boolean
  merged: boolean
  existingId?: string
}

export type StoreWithDedupResult = TriageResult

export async function createRelationship(
  sourceId: string,
  targetId: string,
  edgeType: 'updates' | 'extends' | 'derives' | 'related',
  confidence: number = 1.0,
  metadata: Record<string, unknown> = {},
): Promise<string | null> {
  const db = getVectorDB()
  return db.createRelationship(sourceId, targetId, edgeType, { ...metadata, confidence })
}

/** Invalidate a fact — sets invalid_at, is_latest=false */
export async function invalidateMemory(id: string): Promise<void> {
  const db = getVectorDB()
  await db.invalidate(id)
}

/** Supersede a preference — sets is_latest=false (keeps valid_at) */
export async function supersedeMemory(id: string): Promise<void> {
  const db = getVectorDB()
  await db.supersede(id)
}

function classifyZone(similarity: number, opts: TriageOptions = {}): TriageZone {
  const noopThreshold = opts.noopThreshold ?? 0.90
  const addThreshold = opts.addThreshold ?? 0.60
  if (similarity >= noopThreshold) return 'noop'
  if (similarity < addThreshold) return 'add'
  return 'borderline'
}

/**
 * 3-zone cosine triage — replaces storeWithDedup.
 *
 * Zone 1 (>=0.90): NOOP — memory exists, optionally update metadata
 * Zone 2 (<0.60):  ADD  — genuinely new, store it
 * Zone 3 (0.60-0.90): BORDERLINE — heuristic (LLM in I-M8)
 */
export async function triageAndStore(
  input: MemoryInput,
  options: TriageOptions = {},
): Promise<TriageResult> {
  // Generate embedding ONCE — reuse for search and store
  let embeddingStr: string | undefined
  try {
    const embeddingResult = await generateEmbedding(input.content)
    embeddingStr = formatEmbeddingForPgVector(embeddingResult.embedding)
  } catch (err) {
    console.warn('[triage] Embedding generation failed, storing without triage:', err)
    const memory = await storeMemory(input)
    return { memory, zone: 'add', action: 'stored', similarity: 0, deduplicated: false, merged: false }
  }

  // Search with low threshold to catch borderline matches
  let existing: MemorySearchResult[] = []
  try {
    existing = await searchMemories(input.content, {
      limit: 3,
      category: input.category,
      similarityThreshold: 0.30,
      precomputedEmbedding: embeddingStr,
    } as SearchOptions & { precomputedEmbedding?: string })
  } catch (err) {
    console.warn('[triage] Search failed, storing without triage:', err)
    const memory = await storeMemory({ ...input, precomputedEmbedding: embeddingStr })
    return { memory, zone: 'add', action: 'stored', similarity: 0, deduplicated: false, merged: false }
  }

  // No matches — Zone 2: ADD
  if (existing.length === 0) {
    const memory = await storeMemory({ ...input, precomputedEmbedding: embeddingStr })
    return { memory, zone: 'add', action: 'stored', similarity: 0, deduplicated: false, merged: false }
  }

  const best = existing[0]
  const similarity = best.similarity
  const zone = classifyZone(similarity, options)

  // Zone 1: NOOP — near-duplicate
  if (zone === 'noop') {
    // Merge metadata if different (additive tags)
    const newTags = (input.tags || []).filter(t => !best.tags.includes(t))
    if (newTags.length > 0) {
      const updated = await updateMemory(best.id, {
        tags: [...best.tags, ...newTags],
        changeReason: 'Triage zone 1: metadata merge from near-duplicate',
      })
      return {
        memory: updated, zone: 'noop', action: 'metadata_updated', similarity,
        matchedMemoryId: best.id, deduplicated: true, merged: false, existingId: best.id,
      }
    }
    const validated = await validateMemory(best.id)
    return {
      memory: validated, zone: 'noop', action: 'skipped', similarity,
      matchedMemoryId: best.id, deduplicated: true, merged: false, existingId: best.id,
    }
  }

  // Zone 2: ADD — genuinely new
  if (zone === 'add') {
    const memory = await storeMemory({ ...input, precomputedEmbedding: embeddingStr })
    return { memory, zone: 'add', action: 'stored', similarity, deduplicated: false, merged: false }
  }

  // Zone 3: BORDERLINE — LLM decision with heuristic fallback
  const memType = input.memoryType || best.memoryType || 'pattern'

  // Build UUID-masked memory list for LLM
  const LABELS = ['MEMORY_A', 'MEMORY_B', 'MEMORY_C']
  const maskedMemories: MaskedMemory[] = existing.slice(0, 3).map((m, i) => ({
    label: LABELS[i],
    content: m.content,
    memoryType: m.memoryType,
  }))
  const labelToId = new Map(existing.slice(0, 3).map((m, i) => [LABELS[i], m.id]))

  // Try LLM decision, fall back to heuristic on any failure
  const decide = options.decide ?? borderlineDecision
  const decision = await decide(input.content, maskedMemories, memType)
  // The floor grades the row a verdict would RETIRE, never the top match: the LLM may name
  // MEMORY_B/C, and `existing` is ranked by relevance_score, so a target's own similarity can sit
  // on either side of best's. The heuristic fallback below only ever retires `best`.
  const targetId = decision?.target ? labelToId.get(decision.target) || best.id : best.id
  const targetSimilarity = existing.find(m => m.id === targetId)?.similarity ?? similarity

  if (decision && (decision.action === 'update' || decision.action === 'correct') && !mayRetire(targetSimilarity, options)) {
    // TD-1334: a destructive verdict below the retire floor keeps both rows (see mayRetire).
    const memory = await storeMemory({ ...input, precomputedEmbedding: embeddingStr })
    const relId = await createRelationship(memory.id, targetId, 'related', targetSimilarity, {
      retireDeclined: decision.action,
      retireThreshold: options.retireThreshold ?? DEFAULT_RETIRE_THRESHOLD,
    })
    return {
      memory, zone: 'borderline', action: 'related', similarity,
      matchedMemoryId: targetId, relationshipId: relId ?? undefined,
      deduplicated: false, merged: false, existingId: targetId,
    }
  }

  if (decision) {
    // LLM decided — execute the action

    if (decision.action === 'update') {
      // Store new + type-aware invalidation of target
      const memory = await storeMemory({ ...input, precomputedEmbedding: embeddingStr })
      if (memType === 'fact') {
        await invalidateMemory(targetId)
      } else if (memType === 'preference') {
        await supersedeMemory(targetId)
      }
      const relId = await createRelationship(memory.id, targetId, 'updates', targetSimilarity)
      return {
        memory, zone: 'borderline', action: 'extended', similarity,
        matchedMemoryId: targetId, relationshipId: relId ?? undefined,
        deduplicated: false, merged: true, existingId: targetId,
      }
    }

    if (decision.action === 'correct') {
      // New memory CORRECTS an old wrong one — store new, archive old as incorrect
      const memory = await storeMemory({ ...input, precomputedEmbedding: embeddingStr })
      await archiveMemory(targetId, `corrected: ${decision.reasoning}`.slice(0, 500))
      await supersedeMemory(targetId)
      const relId = await createRelationship(memory.id, targetId, 'updates', targetSimilarity, {
        correctionReason: decision.reasoning,
        correctedAt: new Date().toISOString(),
      })
      return {
        memory, zone: 'borderline', action: 'extended', similarity,
        matchedMemoryId: targetId, relationshipId: relId ?? undefined,
        deduplicated: false, merged: true, existingId: targetId,
      }
    }

    if (decision.action === 'noop') {
      // Existing covers it — merge metadata, validate
      const newTags = (input.tags || []).filter(t => !best.tags.includes(t))
      if (newTags.length > 0) {
        await updateMemory(best.id, {
          tags: [...best.tags, ...newTags],
          changeReason: `Triage zone 3 (LLM): ${decision.reasoning}`,
        })
      }
      const validated = await validateMemory(best.id)
      return {
        memory: validated, zone: 'borderline', action: 'metadata_updated', similarity,
        matchedMemoryId: best.id, deduplicated: true, merged: false, existingId: best.id,
      }
    }

    // decision.action === 'add' — store alongside with 'related' edge
    const memory = await storeMemory({ ...input, precomputedEmbedding: embeddingStr })
    const relId = await createRelationship(memory.id, best.id, 'related', similarity)
    return {
      memory, zone: 'borderline', action: 'related', similarity,
      matchedMemoryId: best.id, relationshipId: relId ?? undefined,
      deduplicated: false, merged: false, existingId: best.id,
    }
  }

  // Fallback: I-M6 length heuristic (LLM failed or unavailable)
  const newLen = input.content.length
  const oldLen = best.content.length

  if (newLen > oldLen * 1.2 && mayRetire(similarity, options)) {
    const memory = await storeMemory({ ...input, precomputedEmbedding: embeddingStr })
    if (memType === 'fact') await invalidateMemory(best.id)
    else if (memType === 'preference') await supersedeMemory(best.id)
    const edgeType = memType === 'pattern' ? 'extends' as const : 'updates' as const
    const relId = await createRelationship(memory.id, best.id, edgeType, similarity)
    return {
      memory, zone: 'borderline', action: 'extended', similarity,
      matchedMemoryId: best.id, relationshipId: relId ?? undefined,
      deduplicated: false, merged: true, existingId: best.id,
    }
  }

  if (oldLen > newLen * 1.2) {
    // TD-1334: deliberately NO `validateMemory` here.
    //
    // Reaching this branch means the LLM did not answer, so nothing has read the
    // two texts against each other — the only signal is that the existing content
    // is longer. That is not evidence the existing memory is still true, and
    // `db.validate()` writes `last_validated = NOW()`, which is the store's record
    // that it IS. Stamping it here is how a correction refreshed the very claim it
    // was disproving, and a shorter correction is the common shape.
    //
    // The tag merge stays: `db.update()` touches `updated_at` only, never
    // `last_validated`, so it records the write without asserting the truth.
    const newTags = (input.tags || []).filter(t => !best.tags.includes(t))
    const memory = newTags.length > 0
      ? await updateMemory(best.id, {
          tags: [...best.tags, ...newTags],
          changeReason: 'Triage zone 3 (heuristic fallback): metadata merge',
        })
      : best
    return {
      memory, zone: 'borderline', action: 'metadata_updated', similarity,
      matchedMemoryId: best.id, deduplicated: true, merged: false, existingId: best.id,
    }
  }

  const memory = await storeMemory({ ...input, precomputedEmbedding: embeddingStr })
  const relId = await createRelationship(memory.id, best.id, 'related', similarity)
  return {
    memory, zone: 'borderline', action: 'related', similarity,
    matchedMemoryId: best.id, relationshipId: relId ?? undefined,
    deduplicated: false, merged: false, existingId: best.id,
  }
}

/** Backward-compatible alias for triageAndStore */
export async function storeWithDedup(
  input: MemoryInput,
  _dedupThreshold = 0.75,
): Promise<TriageResult> {
  const result = await triageAndStore(input)

  // Fire-and-forget: async entity extraction on stored memories (not NOOP)
  if (result.zone !== 'noop') {
    processEntitiesForMemory(result.memory.id, input.content, getUserId())
      .then((r) => {
        if (r.created > 0 || r.linked > 0) {
          console.error(`[entity] ${result.memory.id.slice(0, 6)}: ${r.candidates} candidates, ${r.created} created, ${r.merged} merged, ${r.linked} linked`)
        }
      })
      .catch((err) => console.warn('[entity] Extraction failed:', err instanceof Error ? err.message : err))
  }

  return result
}

export async function searchMemories(
  query: string,
  options: SearchOptions = {}
): Promise<MemorySearchResult[]> {
  const db = getVectorDB()
  return db.search(query, options)
}

export async function getMemory(
  id: string,
  opts?: { accessLevel?: MemoryAccessLevel; maxClassification?: MemoryClassification },
): Promise<Memory | null> {
  const db = getVectorDB()
  // TD-883: thread the optional classification ceiling. No opts → unchanged.
  return db.getById(id, opts)
}

/**
 * Record a citation (TD-817): increments times_cited, sets last_cited_at,
 * and resets the decay timer (last_validated). Call when an agent explicitly
 * expands or acts on a memory — the "actually useful" signal the decay and
 * ranking functions key on.
 */
export async function citeMemory(id: string): Promise<void> {
  const db = getVectorDB()
  return db.citeMemory(id)
}

export async function updateMemory(id: string, updates: MemoryUpdate): Promise<Memory> {
  const db = getVectorDB()
  return db.update(id, updates)
}

export async function deleteMemory(id: string): Promise<void> {
  const db = getVectorDB()
  return db.delete(id)
}

export async function validateMemory(id: string): Promise<Memory> {
  const db = getVectorDB()
  return db.validate(id)
}

export async function archiveMemory(id: string, reason?: string): Promise<Memory> {
  const db = getVectorDB()
  return db.archive(id, reason)
}

// ============================================================
// BULK OPERATIONS
// ============================================================

export async function exportAllMemories(domainId?: string): Promise<MemoryExport[]> {
  const db = getVectorDB()
  return db.exportAll(domainId)
}

// ============================================================
// CONVENIENCE FUNCTIONS
// ============================================================

export async function remember(
  content: string,
  category: MemoryCategory = 'insight',
  tags: string[] = []
): Promise<Memory> {
  return storeMemory({
    content,
    category,
    tags,
    sourceType: 'manual',
    confidence: 1.0,
  })
}

export async function recall(query: string, limit = 5): Promise<MemorySearchResult[]> {
  return searchMemories(query, { limit })
}

// ============================================================
// HEALTH & STATUS
// ============================================================

export async function isMemoryHealthy(): Promise<boolean> {
  try {
    const db = getVectorDB()
    return await db.ping()
  } catch {
    return false
  }
}

export async function getMemoryStats(): Promise<{
  total: number
  byCategory: Record<string, number>
  archived: number
}> {
  const db = getVectorDB()
  // TD-1018: statsRows(), not exportAll() — this function returns three counts
  // and used to download every row's 1536-dim embedding to produce them.
  const all = await db.statsRows()

  const stats = {
    total: all.length,
    byCategory: {} as Record<string, number>,
    archived: 0,
  }

  for (const memory of all) {
    const cat = memory.category || 'uncategorized'
    stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1
    if (memory.isArchived) {
      stats.archived++
    }
  }

  return stats
}

// ============================================================
// VERIFICATION & DIAGNOSTICS
// ============================================================

export interface RoundTripResult {
  success: boolean
  steps: {
    store: { success: boolean; memoryId?: string; latencyMs: number; error?: string }
    search: { success: boolean; found: boolean; relevanceScore?: number; latencyMs: number; error?: string }
    retrieve: { success: boolean; contentMatches: boolean; latencyMs: number; error?: string }
    cleanup: { success: boolean; latencyMs: number; error?: string }
  }
  totalLatencyMs: number
  error?: string
}

export async function verifyRoundTrip(): Promise<RoundTripResult> {
  const testContent = `Verification test at ${new Date().toISOString()}`
  const result: RoundTripResult = {
    success: false,
    steps: {
      store: { success: false, latencyMs: 0 },
      search: { success: false, found: false, latencyMs: 0 },
      retrieve: { success: false, contentMatches: false, latencyMs: 0 },
      cleanup: { success: false, latencyMs: 0 },
    },
    totalLatencyMs: 0,
  }

  const totalStart = Date.now()
  let storedMemory: Memory | null = null

  try {
    const storeStart = Date.now()
    try {
      storedMemory = await storeMemory({
        content: testContent,
        category: 'insight',
        tags: ['test', 'verification', 'round-trip'],
        sourceType: 'manual',
        sourceRef: 'verifyRoundTrip()',
        confidence: 1.0,
      })
      result.steps.store = {
        success: true,
        memoryId: storedMemory.id,
        latencyMs: Date.now() - storeStart,
      }
    } catch (error) {
      result.steps.store = {
        success: false,
        latencyMs: Date.now() - storeStart,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
      result.totalLatencyMs = Date.now() - totalStart
      result.error = 'Failed at STORE step'
      return result
    }

    const searchStart = Date.now()
    try {
      const searchResults = await searchMemories('verification test round-trip', { limit: 5 })
      const found = searchResults.some(r => r.id === storedMemory!.id)
      const matchingResult = searchResults.find(r => r.id === storedMemory!.id)
      result.steps.search = {
        success: true,
        found,
        relevanceScore: matchingResult?.relevanceScore,
        latencyMs: Date.now() - searchStart,
      }
      if (!found) {
        result.steps.search.error = 'Memory stored but not found via search'
      }
    } catch (error) {
      result.steps.search = {
        success: false,
        found: false,
        latencyMs: Date.now() - searchStart,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }

    const retrieveStart = Date.now()
    try {
      const retrieved = await getMemory(storedMemory.id)
      const contentMatches = retrieved?.content === testContent
      result.steps.retrieve = {
        success: !!retrieved,
        contentMatches,
        latencyMs: Date.now() - retrieveStart,
      }
      if (!contentMatches) {
        result.steps.retrieve.error = 'Content mismatch on retrieval'
      }
    } catch (error) {
      result.steps.retrieve = {
        success: false,
        contentMatches: false,
        latencyMs: Date.now() - retrieveStart,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }

    const cleanupStart = Date.now()
    try {
      await archiveMemory(storedMemory.id, 'Test memory - verifyRoundTrip cleanup')
      result.steps.cleanup = {
        success: true,
        latencyMs: Date.now() - cleanupStart,
      }
    } catch (error) {
      result.steps.cleanup = {
        success: false,
        latencyMs: Date.now() - cleanupStart,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }

    result.totalLatencyMs = Date.now() - totalStart
    result.success =
      result.steps.store.success &&
      result.steps.search.success &&
      result.steps.search.found &&
      result.steps.retrieve.success &&
      result.steps.retrieve.contentMatches &&
      result.steps.cleanup.success

    if (!result.success) {
      const failedSteps = Object.entries(result.steps)
        .filter(([, step]) => !step.success)
        .map(([name]) => name)
      result.error = `Failed steps: ${failedSteps.join(', ')}`
    }

    return result
  } catch (error) {
    result.totalLatencyMs = Date.now() - totalStart
    result.error = error instanceof Error ? error.message : 'Unknown error'
    return result
  }
}

export interface DetailedStats {
  total: number
  active: number
  archived: number
  byCategory: Record<string, number>
  bySource: Record<string, number>
  byTag: Record<string, number>
  recentCount: { last24h: number; last7d: number; last30d: number }
  oldestMemory?: { id: string; createdAt: string }
  newestMemory?: { id: string; createdAt: string }
}

export async function getDetailedStats(): Promise<DetailedStats> {
  const db = getVectorDB()
  // TD-1018: statsRows(), not exportAll(). The loop below reads exactly six
  // fields; exportAll() fetched ~40 columns including the embedding.
  const all = await db.statsRows()

  const now = Date.now()
  const day = 24 * 60 * 60 * 1000

  const stats: DetailedStats = {
    total: all.length,
    active: 0,
    archived: 0,
    byCategory: {},
    bySource: {},
    byTag: {},
    recentCount: { last24h: 0, last7d: 0, last30d: 0 },
  }

  let oldest: MemoryStatsRow | null = null
  let newest: MemoryStatsRow | null = null

  for (const memory of all) {
    if (memory.isArchived) {
      stats.archived++
    } else {
      stats.active++
    }

    const cat = memory.category || 'uncategorized'
    stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1

    const source = memory.sourceType || 'unknown'
    stats.bySource[source] = (stats.bySource[source] || 0) + 1

    for (const tag of memory.tags || []) {
      stats.byTag[tag] = (stats.byTag[tag] || 0) + 1
    }

    const createdAt = new Date(memory.createdAt).getTime()
    if (now - createdAt < day) stats.recentCount.last24h++
    if (now - createdAt < 7 * day) stats.recentCount.last7d++
    if (now - createdAt < 30 * day) stats.recentCount.last30d++

    if (!oldest || new Date(memory.createdAt) < new Date(oldest.createdAt)) {
      oldest = memory
    }
    if (!newest || new Date(memory.createdAt) > new Date(newest.createdAt)) {
      newest = memory
    }
  }

  if (oldest) {
    stats.oldestMemory = { id: oldest.id, createdAt: oldest.createdAt }
  }
  if (newest) {
    stats.newestMemory = { id: newest.id, createdAt: newest.createdAt }
  }

  return stats
}

export interface SystemHealth {
  overall: 'healthy' | 'degraded' | 'failed'
  database: { status: 'healthy' | 'failed'; latencyMs?: number; error?: string }
  embeddings: EmbeddingHealthStatus
  memoryCount: number
  degradedReasons: string[]
}

export async function getSystemHealth(): Promise<SystemHealth> {
  const result: SystemHealth = {
    overall: 'healthy',
    database: { status: 'healthy' },
    embeddings: { status: 'healthy', canStore: true, canSearch: true },
    memoryCount: 0,
    degradedReasons: [],
  }

  const dbStart = Date.now()
  try {
    const healthy = await isMemoryHealthy()
    result.database = {
      status: healthy ? 'healthy' : 'failed',
      latencyMs: Date.now() - dbStart,
    }
    if (!healthy) {
      result.degradedReasons.push('Database connection failed')
    }
  } catch (error) {
    result.database = {
      status: 'failed',
      latencyMs: Date.now() - dbStart,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
    result.degradedReasons.push('Database error')
  }

  try {
    result.embeddings = await checkEmbeddingHealth()
    if (result.embeddings.status !== 'healthy') {
      result.degradedReasons.push(result.embeddings.reason || 'Embedding service issue')
    }
  } catch (error) {
    result.embeddings = {
      status: 'failed',
      canStore: false,
      canSearch: false,
      reason: error instanceof Error ? error.message : 'Unknown error',
    }
    result.degradedReasons.push('Embedding service error')
  }

  try {
    const stats = await getMemoryStats()
    result.memoryCount = stats.total
  } catch {
    // Non-critical
  }

  if (result.database.status === 'failed' || result.embeddings.status === 'failed') {
    result.overall = 'failed'
  } else if (result.embeddings.status === 'degraded' || result.degradedReasons.length > 0) {
    result.overall = 'degraded'
  }

  return result
}

// ============================================================
// FORMATTING HELPERS
// ============================================================

export function formatMemory(memory: Memory | MemorySearchResult): string {
  const lines: string[] = []
  const emoji = CATEGORY_EMOJI[memory.category || ''] || '\ud83d\udcdd'
  lines.push(`${emoji} **${memory.category || 'Memory'}**`)
  lines.push(memory.content)
  if (memory.tags.length > 0) {
    lines.push(`Tags: ${memory.tags.map(t => `\`${t}\``).join(' ')}`)
  }
  if (memory.sourceRef) {
    lines.push(`Source: ${memory.sourceRef}`)
  }
  if ('relevanceScore' in memory) {
    const pct = Math.round(memory.relevanceScore * 100)
    lines.push(`Relevance: ${pct}%`)
  }
  return lines.join('\n')
}

export function formatSearchResults(results: MemorySearchResult[]): string {
  if (results.length === 0) {
    return 'No matching memories found.'
  }

  const formatted = results.map((r, i) => {
    const pct = Math.round(r.relevanceScore * 100)
    return `**${i + 1}.** [${pct}%] ${r.content.slice(0, 100)}${r.content.length > 100 ? '...' : ''}`
  })

  return formatted.join('\n\n')
}
