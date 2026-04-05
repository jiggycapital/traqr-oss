/**
 * Memory Pulse Route (Portable)
 *
 * POST /pulse — Batched capture + search + update in one HTTP call.
 * Designed for mid-conversation memory operations by agents.
 */

import { Hono } from 'hono'
import { storeWithDedup, searchMemories, updateMemory } from '../lib/memory.js'
// Auth removed — pulse is called by MCP tools and /ship, same trust level as /store
import { getSourceProject } from '../lib/learning-extractor.js'
import { passesIngestionGate } from '../lib/quality-gate.js'
import { deriveAll } from '../lib/auto-derive.js'
import type { MemoryInput, MemoryCategory } from '../vectordb/types.js'

const MAX_CAPTURES = 5
const MAX_SEARCH_RESULTS = 5
const MAX_UPDATES = 3
const MIN_CAPTURE_LENGTH = 20
const SNIPPET_LENGTH = 150
const DEDUP_THRESHOLD = 0.75

const VALID_CATEGORIES: MemoryCategory[] = [
  'gotcha', 'pattern', 'fix', 'insight', 'question', 'preference', 'convention',
]

interface CaptureInput {
  content: string
  tags?: string[]
  category?: MemoryCategory
}

interface UpdateInput {
  memoryId: string
  content?: string
  changeReason?: string
}

interface PulseRequest {
  slot: string
  captures?: CaptureInput[]
  search?: string
  searchLimit?: number
  updates?: UpdateInput[]
  sourceProject?: string
}

const app = new Hono()

app.post('/', async (c) => {
  try {
    const body = (await c.req.json()) as PulseRequest

    if (!body.slot || typeof body.slot !== 'string') {
      return c.json({ error: 'slot is required' }, 400)
    }

    const slot = body.slot.trim()

    const allCaptures = body.captures || []
    const droppedCount = Math.max(0, allCaptures.length - MAX_CAPTURES)
    const captures = allCaptures.slice(0, MAX_CAPTURES)
    const validCaptures = captures.filter(
      (cap) =>
        cap.content &&
        typeof cap.content === 'string' &&
        cap.content.trim().length >= MIN_CAPTURE_LENGTH &&
        passesIngestionGate(cap.content.trim()).passes
    )
    const filteredCount = captures.length - validCaptures.length

    const searchQuery = typeof body.search === 'string' ? body.search.trim() : null
    const searchLimit = Math.min(
      Math.max(body.searchLimit || 3, 1),
      MAX_SEARCH_RESULTS
    )

    const updates = (body.updates || []).slice(0, MAX_UPDATES)
    const validUpdates = updates.filter(
      (u) => u.memoryId && typeof u.memoryId === 'string'
    )

    const sourceProject = body.sourceProject?.trim() || getSourceProject()

    const [captureResults, searchResults, updateResults] = await Promise.all([
      validCaptures.length > 0
        ? Promise.all(
            validCaptures.map((capture) => {
              const content = capture.content.trim()
              const capAny = capture as any

              // Auto-derive all fields, respecting explicit overrides
              const derived = deriveAll(content, {
                category: capture.category && VALID_CATEGORIES.includes(capture.category) ? capture.category : undefined,
                tags: Array.isArray(capture.tags) && capture.tags.length > 0 ? capture.tags : undefined,
                summary: capAny.summary || undefined,
                domain: capAny.domain || undefined,
                topic: capAny.topic || undefined,
                sourceTool: 'mcp-pulse',
              })

              const input: MemoryInput = {
                content,
                summary: derived.summary,
                category: derived.category as MemoryCategory,
                tags: [...derived.tags, 'pulse', `slot:${slot}`],
                contextTags: ['pulse', `slot:${slot}`],
                sourceType: 'session',
                sourceRef: capAny.sourceRef || `pulse:${slot}`,
                sourceProject,
                confidence: 0.8,
                relatedTo: [],
                isContradiction: false,
                domain: derived.domain,
                topic: derived.topic,
                memoryType: derived.memoryType,
                sourceTool: derived.sourceTool,
              }

              return storeWithDedup(input, DEDUP_THRESHOLD).catch((err) => {
                console.warn('[pulse] Capture failed:', err)
                return null
              })
            })
          )
        : Promise.resolve([]),

      searchQuery
        ? searchMemories(searchQuery, {
            limit: searchLimit,
            similarityThreshold: 0.35,
          }).catch((err) => {
            console.warn('[pulse] Search failed:', err)
            return []
          })
        : Promise.resolve([]),

      validUpdates.length > 0
        ? Promise.all(
            validUpdates.map((update) =>
              updateMemory(update.memoryId, {
                ...(update.content ? { content: update.content } : {}),
                ...(update.changeReason
                  ? { changeReason: update.changeReason }
                  : {}),
              }).catch((err) => {
                console.warn('[pulse] Update failed:', err)
                return null
              })
            )
          )
        : Promise.resolve([]),
    ])

    const successfulCaptures = captureResults.filter(Boolean)
    const captured = successfulCaptures.filter(
      (r) => r && !r.deduplicated
    ).length
    const merged = successfulCaptures.filter(
      (r) => r && r.merged
    ).length
    const deduplicated = successfulCaptures.filter(
      (r) => r && r.deduplicated && !r.merged
    ).length

    const formattedSearch = searchQuery
      ? searchResults.map((r) => ({
          shortCode: `MEM-${r.id.slice(0, 6)}`,
          snippet:
            r.content.length > SNIPPET_LENGTH
              ? r.content.slice(0, SNIPPET_LENGTH - 3) + '...'
              : r.content,
          score: Math.round(r.relevanceScore * 100) / 100,
        }))
      : undefined

    const updated = updateResults.filter(Boolean).length

    // v2: zone breakdown for observability
    const zones = {
      noop: successfulCaptures.filter((r: any) => r?.zone === 'noop').length,
      add: successfulCaptures.filter((r: any) => r?.zone === 'add').length,
      borderline: successfulCaptures.filter((r: any) => r?.zone === 'borderline').length,
    }

    return c.json({
      captured,
      merged,
      deduplicated,
      updated,
      zones,
      ...(droppedCount > 0 ? { dropped: droppedCount, batchLimit: MAX_CAPTURES } : {}),
      ...(filteredCount > 0 ? { filtered: filteredCount } : {}),
      ...(formattedSearch ? { searchResults: formattedSearch } : {}),
    })
  } catch (error) {
    console.error('[pulse] Error:', error)
    return c.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      500
    )
  }
})

export default app
