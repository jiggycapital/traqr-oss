/**
 * Memory Sync Route (Portable)
 *
 * GET /sync?since=<timestamp>&limit=50
 *   Returns new learnings since the given timestamp
 *
 * POST /sync
 *   Returns recent learnings (simplified from NookTraqr's broadcast system)
 */

import { Hono } from 'hono'
import { getMemoryClient, getTableName } from '../lib/client.js'

const app = new Hono()

app.get('/', async (c) => {
  try {
    const sinceParam = c.req.query('since')
    const limit = parseInt(c.req.query('limit') || '50', 10)

    let sinceTimestamp: number

    if (sinceParam) {
      sinceTimestamp = parseInt(sinceParam, 10)
      if (isNaN(sinceTimestamp)) {
        return c.json({ success: false, error: 'Invalid since timestamp' }, 400)
      }
    } else {
      sinceTimestamp = Date.now() - 60 * 60 * 1000
    }

    const sinceDate = new Date(sinceTimestamp).toISOString()
    const client = getMemoryClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (client.from(getTableName()) as any)
      .select('id, content, category, tags, source_type, created_at, original_confidence')
      .eq('is_archived', false)
      .gte('created_at', sinceDate)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      throw new Error(error.message)
    }

    return c.json({
      success: true,
      learnings: data || [],
      total: (data || []).length,
      syncedAt: Date.now(),
      since: sinceTimestamp,
    })
  } catch (error) {
    console.error('[memory/sync] GET error:', error)
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      500
    )
  }
})

app.post('/', async (c) => {
  try {
    const body = await c.req.json()
    const since = body.since || Date.now() - 60 * 60 * 1000
    const limit = body.limit || 50

    const sinceDate = new Date(since).toISOString()
    const client = getMemoryClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (client.from(getTableName()) as any)
      .select('id, content, category, tags, source_type, created_at, original_confidence')
      .eq('is_archived', false)
      .gte('created_at', sinceDate)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      throw new Error(error.message)
    }

    return c.json({
      success: true,
      learnings: data || [],
      total: (data || []).length,
      syncedAt: Date.now(),
      previousSync: since,
    })
  } catch (error) {
    console.error('[memory/sync] POST error:', error)
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      500
    )
  }
})

export default app
