/**
 * Entity Lifecycle Cron Route
 *
 * POST /entity-cron — Archive orphaned entities (all linked memories archived/forgotten).
 */

import { Hono } from 'hono'
import { getVectorDB } from '../vectordb/index.js'

const app = new Hono()

app.post('/', async (c) => {
  try {
    const db = getVectorDB()
    const orphanedIds = await db.findOrphanedEntities()

    if (orphanedIds.length === 0) {
      return c.json({ success: true, archived: 0 })
    }

    const archived = await db.archiveEntities(orphanedIds)
    console.log(`[entity-cron] Archived ${archived} orphaned entities`)

    return c.json({ success: true, archived })
  } catch (error) {
    console.error('[entity-cron] Error:', error)
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      500,
    )
  }
})

export default app
