/**
 * Memory Capture Session Route (Portable)
 *
 * POST /capture-session
 *   Accepts pre-extracted learnings and stores them with dedup.
 *
 * Unlike the NookTraqr version which uses learning-extractor (OpenAI LLM),
 * this portable version accepts already-extracted learnings and stores them.
 * The caller is responsible for extraction.
 */

import { Hono } from 'hono'
import { storeWithDedup } from '../lib/memory.js'
import { getMemoryClient } from '../lib/client.js'
import { passesIngestionGate } from '../lib/quality-gate.js'
import type { MemoryCategory } from '../vectordb/types.js'

interface CapturedLearning {
  content: string
  category?: MemoryCategory
  tags?: string[]
  confidence?: number
}

const app = new Hono()

app.post('/', async (c) => {
  try {
    const body = await c.req.json()

    if (!body.slot || typeof body.slot !== 'string') {
      return c.json({ success: false, error: 'slot is required' }, 400)
    }

    const learnings: CapturedLearning[] = body.learnings || []
    const sourceProject = body.sourceProject || 'default'
    const sourceRef = body.branch ? `${body.slot}/${body.branch}` : body.slot

    let memoriesStored = 0
    let memoriesDeduplicated = 0
    const errors: string[] = []

    for (const learning of learnings) {
      if (!learning.content || learning.content.trim().length < 20) continue
      const gate = passesIngestionGate(learning.content.trim())
      if (!gate.passes) continue

      try {
        const result = await storeWithDedup({
          content: learning.content.trim(),
          category: learning.category || 'insight',
          tags: learning.tags || [],
          sourceType: 'session',
          sourceRef,
          sourceProject,
          confidence: learning.confidence ?? 0.6,
          sourceTool: 'capture-session',
        })
        if (result.deduplicated) {
          memoriesDeduplicated++
        } else {
          memoriesStored++
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : 'Unknown error')
      }
    }

    // Record citations if provided
    let citedCount = 0
    const citedMemories = Array.isArray(body.citedMemories) ? body.citedMemories : []
    if (citedMemories.length > 0) {
      const client = getMemoryClient()
      for (const id of citedMemories.slice(0, 50)) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (client.rpc as any)('cite_memory', { p_memory_id: id })
          citedCount++
        } catch {
          // Best-effort
        }
      }
    }

    return c.json({
      success: true,
      memoriesStored,
      memoriesDeduplicated,
      errors,
      citedCount,
    })
  } catch (error) {
    console.error('[Memory Capture Session] Error:', error)
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      500
    )
  }
})

export default app
