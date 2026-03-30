/**
 * Memory Browse Route
 *
 * GET /browse — Faceted navigation without vector search.
 *   No params:              domain counts
 *   ?domain=sean:           category counts within domain
 *   ?domain=sean&category=insight: memory summaries within domain+category
 */

import { Hono } from 'hono'
import { getMemoryClient, getTableName } from '../lib/client.js'

const app = new Hono()

app.get('/', async (c) => {
  try {
    const client = getMemoryClient()
    const table = getTableName()
    const domain = c.req.query('domain')
    const category = c.req.query('category')

    // Level 3: domain + category → list summaries
    if (domain && category) {
      const { data, error } = await (client.from(table) as any)
        .select('id, summary, topic, tags, created_at')
        .eq('is_archived', false)
        .eq('domain', domain)
        .eq('category', category)
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
      const { data, error } = await (client.from(table) as any)
        .select('category')
        .eq('is_archived', false)
        .eq('domain', domain)

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
    const { data, error } = await (client.from(table) as any)
      .select('domain')
      .eq('is_archived', false)

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
