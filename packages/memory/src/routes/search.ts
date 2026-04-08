/**
 * Memory Search Route
 *
 * GET /search?q=<query>&limit=10&category=gotcha&threshold=0.3
 */

import { Hono } from 'hono'
import { searchMemories } from '../lib/memory.js'
import { searchMemoriesV2 } from '../lib/retrieval.js'
import type { MemoryCategory, MemoryClassification, MemoryAccessLevel, MemoryDurability, SearchOptions } from '../vectordb/types.js'

const VALID_CLASSIFICATIONS: MemoryClassification[] = ['public', 'internal', 'confidential', 'restricted']
const VALID_ACCESS_LEVELS: MemoryAccessLevel[] = ['exploration', 'standard', 'privileged', 'admin']

const VALID_CATEGORIES: MemoryCategory[] = ['gotcha', 'pattern', 'fix', 'insight', 'question', 'preference', 'convention']
const MAX_LIMIT = 50
const DEFAULT_LIMIT = 10
const DEFAULT_THRESHOLD = 0.35

const app = new Hono()

app.get('/', async (c) => {
  try {
    const query = c.req.query('q')
    if (!query || query.trim().length === 0) {
      return c.json({ success: false, error: 'Query parameter "q" is required' }, 400)
    }

    let limit = DEFAULT_LIMIT
    const limitParam = c.req.query('limit')
    if (limitParam) {
      const parsed = parseInt(limitParam, 10)
      if (isNaN(parsed) || parsed < 1) {
        return c.json({ success: false, error: 'limit must be a positive integer' }, 400)
      }
      limit = Math.min(parsed, MAX_LIMIT)
    }

    let category: MemoryCategory | undefined
    const categoryParam = c.req.query('category')
    if (categoryParam) {
      // Accept any category string — the system learns the user's taxonomy
      category = categoryParam as MemoryCategory
    }

    let tags: string[] | undefined
    const tagsParam = c.req.query('tags')
    if (tagsParam) {
      tags = tagsParam.split(',').map(t => t.trim()).filter(Boolean)
    }

    const includeArchived = c.req.query('includeArchived') === 'true'

    let threshold = DEFAULT_THRESHOLD
    const thresholdParam = c.req.query('threshold')
    if (thresholdParam) {
      const parsed = parseFloat(thresholdParam)
      if (isNaN(parsed) || parsed < 0 || parsed > 1) {
        return c.json({ success: false, error: 'threshold must be a number between 0 and 1' }, 400)
      }
      threshold = parsed
    }

    let durability: MemoryDurability | undefined
    const durabilityParam = c.req.query('durability')
    if (durabilityParam) {
      if (!['permanent', 'temporary', 'session'].includes(durabilityParam)) {
        return c.json({ success: false, error: 'durability must be one of: permanent, temporary, session' }, 400)
      }
      durability = durabilityParam as MemoryDurability
    }

    // Cross-project search: project=<slug> filters, crossProject=true includes all
    const projectParam = c.req.query('project')
    const crossProject = c.req.query('crossProject') === 'true'

    // v2: lifecycle filters
    const latestOnly = c.req.query('latestOnly') !== 'false'
    const memoryType = c.req.query('memoryType') as 'fact' | 'preference' | 'pattern' | undefined

    // v3: security filters (Glasswing Red Alert)
    const maxClassificationParam = c.req.query('maxClassification')
    let maxClassification: MemoryClassification | undefined
    if (maxClassificationParam) {
      if (!VALID_CLASSIFICATIONS.includes(maxClassificationParam as MemoryClassification)) {
        return c.json({ success: false, error: `maxClassification must be one of: ${VALID_CLASSIFICATIONS.join(', ')}` }, 400)
      }
      maxClassification = maxClassificationParam as MemoryClassification
    }

    const accessLevelParam = c.req.query('accessLevel')
    let accessLevel: MemoryAccessLevel | undefined
    if (accessLevelParam) {
      if (!VALID_ACCESS_LEVELS.includes(accessLevelParam as MemoryAccessLevel)) {
        return c.json({ success: false, error: `accessLevel must be one of: ${VALID_ACCESS_LEVELS.join(', ')}` }, 400)
      }
      accessLevel = accessLevelParam as MemoryAccessLevel
    }

    const clientNamespace = c.req.query('clientNamespace') || undefined

    const options: SearchOptions = {
      limit,
      category,
      tags,
      includeArchived,
      similarityThreshold: threshold,
      durability,
      excludeExpired: true,
      sourceProject: projectParam || undefined,
      includeUniversal: crossProject || !!projectParam,
      latestOnly,
      memoryType: memoryType || undefined,
      // Security
      maxClassification,
      accessLevel,
      clientNamespace,
    }

    // Fetch more results than requested if domain filter is active (post-filter)
    const domainParam = c.req.query('domain')
    if (domainParam) {
      options.limit = Math.min(limit * 3, MAX_LIMIT) // over-fetch for post-filter
    }

    // v2: multi-strategy fusion (semantic + BM25 + temporal + graph via RRF)
    const useFusion = c.req.query('fusion') !== 'false'
    const entityIds = c.req.query('entityIds')?.split(',').filter(Boolean)

    let results = useFusion
      ? await searchMemoriesV2(query.trim(), { ...options, entityIds })
      : await searchMemories(query.trim(), options)

    // Post-filter by domain (column not in RPC)
    if (domainParam) {
      results = results.filter((r: any) => r.domain === domainParam).slice(0, limit)
    }

    return c.json({
      success: true,
      query: query.trim(),
      count: results.length,
      results,
    })
  } catch (error) {
    console.error('[Memory Search] Error:', error)
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error searching memories' },
      500
    )
  }
})

export default app
