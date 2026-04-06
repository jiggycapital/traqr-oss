/**
 * Memory CRUD Routes
 *
 * GET /get?id=<memory-id>
 * PATCH /update
 * POST /verify (round-trip verification)
 * GET /verify (system health)
 */

import { Hono } from 'hono'
import {
  getMemory,
  updateMemory,
  archiveMemory,
  getSystemHealth,
  verifyRoundTrip,
  getDetailedStats,
} from '../lib/memory.js'
import type { MemoryCategory, MemoryUpdate } from '../vectordb/types.js'

const VALID_CATEGORIES: MemoryCategory[] = ['gotcha', 'pattern', 'fix', 'insight', 'question', 'preference', 'convention']

const app = new Hono()

// GET /get?id=<memory-id>
app.get('/get', async (c) => {
  try {
    const id = c.req.query('id')

    if (!id) {
      return c.json({ success: false, error: 'id parameter required' }, 400)
    }

    const memory = await getMemory(id)

    if (!memory) {
      return c.json({ success: false, error: 'Memory not found' }, 404)
    }

    return c.json({ success: true, memory })
  } catch (error) {
    console.error('[memory/get] Error:', error)
    return c.json({ success: false, error: 'Internal server error' }, 500)
  }
})

// PATCH /update
app.patch('/update', async (c) => {
  try {
    const body = await c.req.json()

    if (!body.id || typeof body.id !== 'string') {
      return c.json({ success: false, error: 'id is required' }, 400)
    }

    // Accept any category string — the system learns the user's taxonomy
    // VALID_CATEGORIES are suggestions for auto-derive, not restrictions

    if (body.confidence !== undefined) {
      const conf = Number(body.confidence)
      if (isNaN(conf) || conf < 0 || conf > 1) {
        return c.json({ success: false, error: 'confidence must be a number between 0 and 1' }, 400)
      }
    }

    // Handle archive as a special case
    if (body.isArchived === true) {
      const archived = await archiveMemory(body.id, body.archiveReason || 'manual')
      return c.json({ success: true, memory: archived })
    }

    // Handle forget as a special case
    if (body.isForgotten === true) {
      const { getMemoryClient } = await import('../lib/client.js')
      const client = getMemoryClient()
      const { data, error } = await (client.from('traqr_memories') as any)
        .update({
          is_forgotten: true,
          forgotten_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', body.id)
        .select()
        .single()
      if (error) {
        return c.json({ success: false, error: `Failed to forget: ${error.message}` }, 500)
      }
      return c.json({ success: true, memory: data })
    }

    const updateFields = ['content', 'category', 'tags', 'confidence', 'changeReason', 'summary', 'contextTags', 'relatedTo']
    const hasUpdate = updateFields.some(f => body[f] !== undefined)
    if (!hasUpdate) {
      return c.json({ success: false, error: `At least one update field required: ${updateFields.join(', ')}` }, 400)
    }

    const existing = await getMemory(body.id)
    if (!existing) {
      return c.json({ success: false, error: `Memory ${body.id} not found` }, 404)
    }

    const updates: MemoryUpdate = {}
    if (body.content !== undefined) updates.content = body.content.trim()
    if (body.summary !== undefined) updates.summary = body.summary.trim()
    if (body.category !== undefined) updates.category = body.category
    if (body.tags !== undefined) updates.tags = Array.isArray(body.tags) ? body.tags.filter(Boolean) : []
    if (body.contextTags !== undefined) updates.contextTags = Array.isArray(body.contextTags) ? body.contextTags.filter(Boolean) : []
    if (body.confidence !== undefined) updates.confidence = Number(body.confidence)
    if (body.relatedTo !== undefined) updates.relatedTo = Array.isArray(body.relatedTo) ? body.relatedTo : []
    if (body.changeReason !== undefined) updates.changeReason = body.changeReason

    const updated = await updateMemory(body.id, updates)

    return c.json({ success: true, memory: updated })
  } catch (error) {
    console.error('[Memory Update] Error:', error)
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      500
    )
  }
})

// GET /verify — system health
app.get('/verify', async (c) => {
  try {
    const includeStats = c.req.query('stats') === 'true'

    const health = await getSystemHealth()

    const response: Record<string, unknown> = {
      success: true,
      health,
      timestamp: new Date().toISOString(),
    }

    if (includeStats) {
      response.stats = await getDetailedStats()
    }

    return c.json(response)
  } catch (error) {
    console.error('[memory/verify] GET error:', error)
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error', timestamp: new Date().toISOString() },
      500
    )
  }
})

// POST /verify — round-trip verification
app.post('/verify', async (c) => {
  try {
    const startTime = Date.now()

    const [roundTrip, health, stats] = await Promise.all([
      verifyRoundTrip(),
      getSystemHealth(),
      getDetailedStats(),
    ])

    const totalTime = Date.now() - startTime

    const summary = {
      success: roundTrip.success && health.overall !== 'failed',
      verification: {
        passed: roundTrip.success,
        steps: {
          store: roundTrip.steps.store.success,
          search: roundTrip.steps.search.success && roundTrip.steps.search.found,
          retrieve: roundTrip.steps.retrieve.success && roundTrip.steps.retrieve.contentMatches,
          cleanup: roundTrip.steps.cleanup.success,
        },
        relevanceScore: roundTrip.steps.search.relevanceScore,
        totalLatencyMs: roundTrip.totalLatencyMs,
        error: roundTrip.error,
      },
      health: {
        overall: health.overall,
        database: health.database.status,
        embeddings: health.embeddings.status,
        canStore: health.embeddings.canStore,
        canSearch: health.embeddings.canSearch,
        degradedReasons: health.degradedReasons,
      },
      stats: {
        total: stats.total,
        active: stats.active,
        last24h: stats.recentCount.last24h,
        last7d: stats.recentCount.last7d,
      },
      timestamp: new Date().toISOString(),
      processingTimeMs: totalTime,
    }

    if (!summary.success) {
      return c.json(summary, 503)
    }

    return c.json(summary)
  } catch (error) {
    console.error('[memory/verify] POST error:', error)
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error', timestamp: new Date().toISOString() },
      500
    )
  }
})

export default app
