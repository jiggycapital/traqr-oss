/**
 * Memory Browse Route
 *
 * GET /browse — Faceted navigation without vector search.
 *   No params:              domain counts
 *   ?domain=sean:           category counts within domain
 *   ?domain=sean&category=insight: memory summaries within domain+category
 *
 * Classification ceiling (TD-883): like /search, an optional accessLevel /
 * maxClassification pair caps which classification tiers are visible. When
 * NEITHER is provided there is NO ceiling and behavior is byte-identical to
 * before (fail-safe / compatible-by-default). The ceiling is applied at ALL
 * three levels — domain counts, category counts, and the summaries list — so
 * over-tier rows neither leak nor inflate counts.
 */

import { Hono } from 'hono'
import { getMemoryClient, getTableName } from '../lib/client.js'
import { allowedClassificationsForCeiling } from '../lib/retrieval.js'
import type { MemoryClassification, MemoryAccessLevel } from '../vectordb/types.js'

const VALID_CLASSIFICATIONS: MemoryClassification[] = ['public', 'internal', 'confidential', 'restricted']
const VALID_ACCESS_LEVELS: MemoryAccessLevel[] = ['exploration', 'standard', 'privileged', 'admin']

const app = new Hono()

app.get('/', async (c) => {
  try {
    const client = getMemoryClient()
    const table = getTableName()
    const domain = c.req.query('domain')
    const category = c.req.query('category')

    // Classification ceiling (TD-883) — parsed exactly like search.ts.
    const maxClassificationParam = c.req.query('maxClassification')
    let maxClassification: MemoryClassification | undefined
    if (maxClassificationParam) {
      if (!VALID_CLASSIFICATIONS.includes(maxClassificationParam as MemoryClassification)) {
        return c.json({ error: `maxClassification must be one of: ${VALID_CLASSIFICATIONS.join(', ')}` }, 400)
      }
      maxClassification = maxClassificationParam as MemoryClassification
    }

    const accessLevelParam = c.req.query('accessLevel')
    let accessLevel: MemoryAccessLevel | undefined
    if (accessLevelParam) {
      if (!VALID_ACCESS_LEVELS.includes(accessLevelParam as MemoryAccessLevel)) {
        return c.json({ error: `accessLevel must be one of: ${VALID_ACCESS_LEVELS.join(', ')}` }, 400)
      }
      accessLevel = accessLevelParam as MemoryAccessLevel
    }

    // Resolve the allowed classification tiers. undefined → no ceiling → no
    // filter applied (unchanged behavior). maxClassification overrides
    // accessLevel inside the helper.
    const allowed = allowedClassificationsForCeiling(accessLevel, maxClassification)

    // A NULL classification column hydrates to 'internal' (rowToMemory's
    // `?? 'internal'`), so NULL rows are in-tier only when 'internal' is allowed.
    // `.in()` never matches NULL, so admit NULL explicitly via `.or()` in that case.
    const includeNull = allowed?.includes('internal') ?? false

    // Applies the ceiling to a Supabase query builder (no-op when no ceiling).
    const withCeiling = (q: any) => {
      if (!allowed) return q
      if (includeNull) {
        return q.or(`classification.in.(${allowed.join(',')}),classification.is.null`)
      }
      return q.in('classification', allowed)
    }

    // Level 3: domain + category → list summaries
    if (domain && category) {
      const { data, error } = await withCeiling(
        (client.from(table) as any)
          .select('id, summary, topic, tags, created_at, classification')
          .eq('is_archived', false)
          .eq('domain', domain)
          .eq('category', category),
      )
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) throw new Error(error.message)
      return c.json({
        level: 'memories',
        domain,
        category,
        count: (data || []).length,
        memories: (data || []).map((r: any) => ({
          id: r.id,
          summary: r.summary || '(no summary)',
          topic: r.topic,
          tags: r.tags || [],
        })),
      })
    }

    // Level 2: domain → category counts
    if (domain) {
      const { data, error } = await withCeiling(
        (client.from(table) as any)
          .select('category')
          .eq('is_archived', false)
          .eq('domain', domain),
      )

      if (error) throw new Error(error.message)
      const counts: Record<string, number> = {}
      for (const row of data || []) {
        const cat = row.category || 'uncategorized'
        counts[cat] = (counts[cat] || 0) + 1
      }
      return c.json({
        level: 'categories',
        domain,
        total: (data || []).length,
        categories: counts,
      })
    }

    // Level 1: top-level domain counts
    const { data, error } = await withCeiling(
      (client.from(table) as any)
        .select('domain')
        .eq('is_archived', false),
    )

    if (error) throw new Error(error.message)
    const counts: Record<string, number> = {}
    for (const row of data || []) {
      const dom = row.domain || 'unclassified'
      counts[dom] = (counts[dom] || 0) + 1
    }
    return c.json({
      level: 'domains',
      total: (data || []).length,
      domains: counts,
    })
  } catch (error) {
    console.error('[memory/browse] Error:', error)
    return c.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      500
    )
  }
})

export default app
