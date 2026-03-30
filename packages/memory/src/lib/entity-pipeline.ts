/**
 * Entity Extraction Pipeline
 *
 * Async entity extraction from memory content. Entities earn existence
 * at 3+ mentions. Canonicalized via multi-signal matching:
 * 1. Exact normalized name match (free, instant)
 * 2. ILIKE fuzzy match (free, fast)
 * 3. Embedding similarity >0.85 (requires OPENAI_API_KEY)
 *
 * Graceful degradation: works without OPENAI_API_KEY using name matching only.
 */

import { getVectorDB } from '../vectordb/index.js'
import type { VectorDBProvider } from '../vectordb/types.js'
import { getUserId } from './client.js'
import { extractEntityCandidates, type EntityCandidate } from './auto-derive.js'
import { generateEmbedding, formatEmbeddingForPgVector } from './embeddings.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EntityExtractionResult {
  candidates: number
  created: number
  merged: number
  linked: number
  skipped: number
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MENTION_THRESHOLD = 3
const EMBEDDING_SIMILARITY_THRESHOLD = 0.85

// ---------------------------------------------------------------------------
// Core Pipeline
// ---------------------------------------------------------------------------

/**
 * Process entity extraction for a stored memory.
 * Designed to run fire-and-forget after memory store completes.
 */
export async function processEntitiesForMemory(
  memoryId: string,
  content: string,
  userId: string,
): Promise<EntityExtractionResult> {
  const provider = getVectorDB()
  const result: EntityExtractionResult = { candidates: 0, created: 0, merged: 0, linked: 0, skipped: 0 }

  // 1. Extract entity candidates from content
  const candidates = extractEntityCandidates(content)
  result.candidates = candidates.length

  if (candidates.length === 0) return result

  // 2. Process each candidate
  for (const candidate of candidates) {
    try {
      await processCandidate(provider, candidate, memoryId, userId, result)
    } catch (err) {
      console.warn(`[entity] Failed to process candidate "${candidate.name}":`, err instanceof Error ? err.message : err)
      result.skipped++
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Candidate Processing
// ---------------------------------------------------------------------------

async function processCandidate(
  provider: VectorDBProvider,
  candidate: EntityCandidate,
  memoryId: string,
  userId: string,
  result: EntityExtractionResult,
): Promise<void> {
  const normalizedName = candidate.name.trim()
  const entityType = candidate.type

  // Step 1: Try to find existing entity via multi-signal matching
  let existingEntity = await matchExistingEntity(provider, normalizedName, entityType)

  if (existingEntity) {
    // Entity exists — increment mentions and link
    await provider.incrementEntityMentions(existingEntity.id)
    await provider.linkMemoryToEntity(memoryId, existingEntity.id, 'mentions')
    result.merged++
    result.linked++
    return
  }

  // Step 2: No existing entity — check mention threshold
  const mentionCount = await countMentions(normalizedName)
  if (mentionCount < MENTION_THRESHOLD) {
    result.skipped++
    return
  }

  // Step 3: Create new entity (threshold met, no match found)
  let embeddingStr: string | undefined
  try {
    // Generate embedding with type context: "React (technology)" not just "React"
    const embeddingResult = await generateEmbedding(`${normalizedName} (${entityType})`)
    embeddingStr = formatEmbeddingForPgVector(embeddingResult.embedding)
  } catch {
    // OPENAI_API_KEY missing or embedding failed — create without embedding
  }

  const newEntity = await provider.createEntity({
    name: normalizedName,
    entityType,
    embedding: embeddingStr,
    userId,
  })

  if (newEntity) {
    await provider.linkMemoryToEntity(memoryId, newEntity.id, 'mentions')
    result.created++
    result.linked++
  } else {
    result.skipped++
  }
}

// ---------------------------------------------------------------------------
// Multi-Signal Entity Matching
// ---------------------------------------------------------------------------

/**
 * Try to match a candidate against existing entities using multiple signals:
 * 1. Exact normalized name + type match
 * 2. ILIKE fuzzy match
 * 3. Embedding similarity (if OPENAI_API_KEY available)
 */
async function matchExistingEntity(
  provider: VectorDBProvider,
  name: string,
  entityType: string,
): Promise<any | null> {
  // Signal 1: Exact normalized match (case-insensitive)
  const exactMatch = await provider.findEntityByName(name, entityType)
  if (exactMatch) return exactMatch

  // Signal 2: ILIKE fuzzy match
  const fuzzyMatch = await provider.findEntityByNameFuzzy(name, entityType)
  if (fuzzyMatch) return fuzzyMatch

  // Signal 3: Embedding similarity (only if OPENAI_API_KEY available)
  if (process.env.OPENAI_API_KEY) {
    try {
      const embeddingResult = await generateEmbedding(`${name} (${entityType})`)
      const embeddingStr = formatEmbeddingForPgVector(embeddingResult.embedding)
      const embeddingMatch = await provider.findEntityByEmbedding(
        embeddingStr,
        entityType,
        EMBEDDING_SIMILARITY_THRESHOLD,
      )
      if (embeddingMatch) return embeddingMatch
    } catch {
      // Embedding failed — continue without it
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Mention Counting
// ---------------------------------------------------------------------------

async function countMentions(name: string): Promise<number> {
  try {
    const db = getVectorDB()
    return await db.countEntityMentions(name, getUserId())
  } catch {
    return 0
  }
}
