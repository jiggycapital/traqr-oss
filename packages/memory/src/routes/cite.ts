/**
 * Memory Citation Route
 *
 * POST /cite
 * Records that an agent explicitly referenced memories (cited them).
 */

import { Hono } from 'hono'
import { getMemoryClient } from '../lib/client.js'

const app = new Hono()

app.post('/', async (c) => {
  try {
    const body = await c.req.json()

    const memoryIds: string[] = body.memoryIds
      ? (Array.isArray(body.memoryIds) ? body.memoryIds : [body.memoryIds])
      : body.memoryId
        ? [body.memoryId]
        : []

    if (memoryIds.length === 0) {
      return c.json({ success: false, error: 'memoryId or memoryIds required' }, 400)
    }

    const ids = memoryIds.slice(0, 50)
    const client = getMemoryClient()
    let citedCount = 0
    const failedIds: string[] = []

    for (const id of ids) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client.rpc as any)('cite_memory', { p_memory_id: id })
        citedCount++
      } catch (err) {
        console.warn(`[memory/cite] Failed to cite ${id}:`, err)
        failedIds.push(id)
      }
    }

    return c.json({
      success: failedIds.length === 0,
      cited: citedCount,
      failed: failedIds,
      requested: ids.length,
    })
  } catch (error) {
    console.error('[memory/cite] Error:', error)
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      500
    )
  }
})

export default app
