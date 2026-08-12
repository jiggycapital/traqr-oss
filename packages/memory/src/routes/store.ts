/**
 * Memory Store Route
 *
 * POST /store
 */

import { Hono } from 'hono'
import { storeMemory } from '../lib/memory.js'
import { passesIngestionGate } from '../lib/quality-gate.js'
import { deriveAll } from '../lib/auto-derive.js'
import { detectPii } from '../lib/pii-detection.js'
import type { MemoryInput, MemoryCategory, MemoryClassification } from '../vectordb/types.js'
import { CLASSIFICATION_RANK } from '../vectordb/types.js'

const VALID_CLASSIFICATIONS: MemoryClassification[] = ['public', 'internal', 'confidential', 'restricted']

const VALID_CATEGORIES: MemoryCategory[] = ['gotcha', 'pattern', 'fix', 'insight', 'question', 'preference', 'convention']
const VALID_SOURCE_TYPES = ['pr', 'manual', 'extracted', 'bootstrap', 'advisor_session', 'plan', 'web_research', 'session', 'codebase_analysis']
const VALID_DURABILITIES = ['permanent', 'temporary', 'session']

const app = new Hono()

app.post('/', async (c) => {
  try {
    const body = await c.req.json()

    if (!body.content || typeof body.content !== 'string') {
      return c.json({ success: false, error: 'content is required and must be a string' }, 400)
    }

    if (!body.skipQualityGate) {
      const gate = passesIngestionGate(body.content.trim())
      if (!gate.passes) {
        return c.json({ success: false, error: `Quality gate rejected: ${gate.reason}` }, 400)
      }
    }

    if (!body.sourceType) {
      body.sourceType = 'manual'
    } else if (!VALID_SOURCE_TYPES.includes(body.sourceType)) {
      return c.json({ success: false, error: `sourceType must be one of: ${VALID_SOURCE_TYPES.join(', ')}` }, 400)
    }

    // Accept any category string — the system learns the user's taxonomy
    // VALID_CATEGORIES are suggestions for auto-derive, not restrictions

    if (body.confidence !== undefined) {
      const conf = Number(body.confidence)
      if (isNaN(conf) || conf < 0 || conf > 1) {
        return c.json({ success: false, error: 'confidence must be a number between 0 and 1' }, 400)
      }
    }

    if (body.durability && !VALID_DURABILITIES.includes(body.durability)) {
      return c.json({ success: false, error: `durability must be one of: ${VALID_DURABILITIES.join(', ')}` }, 400)
    }

    if (body.expiresAt) {
      const parsed = new Date(body.expiresAt)
      if (isNaN(parsed.getTime())) {
        return c.json({ success: false, error: 'expiresAt must be a valid ISO date string' }, 400)
      }
    }

    // PII detection — auto-classify before storage (TD-714)
    const piiResult = detectPii(body.content.trim())
    const requestedClassification = (VALID_CLASSIFICATIONS.includes(body.classification) ? body.classification : 'internal') as MemoryClassification
    // PII detection can ELEVATE classification but never lower it
    const finalClassification = CLASSIFICATION_RANK[piiResult.suggestedClassification] > CLASSIFICATION_RANK[requestedClassification]
      ? piiResult.suggestedClassification
      : requestedClassification

    // Auto-derive missing fields from content
    const content = body.content.trim()
    const derived = deriveAll(content, {
      category: body.category || undefined,
      tags: Array.isArray(body.tags) && body.tags.length > 0 ? body.tags : undefined,
      summary: body.summary?.trim() || undefined,
      domain: body.domain?.trim() || undefined,
      topic: body.topic?.trim() || undefined,
      memoryType: body.memoryType || undefined,
      sourceTool: body.sourceTool?.trim() || 'http-store',
    })

    const input: MemoryInput = {
      content,
      summary: derived.summary,
      category: derived.category as MemoryCategory,
      tags: derived.tags,
      contextTags: Array.isArray(body.contextTags) ? body.contextTags.filter(Boolean) : [],
      sourceType: body.sourceType,
      sourceRef: body.sourceRef?.trim(),
      sourceProject: body.sourceProject?.trim() || 'default',
      confidence: body.confidence,
      relatedTo: Array.isArray(body.relatedTo) ? body.relatedTo : [],
      isContradiction: body.isContradiction || false,
      durability: body.durability || 'permanent',
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
      domain: derived.domain,
      topic: derived.topic,
      memoryType: derived.memoryType,
      sourceTool: derived.sourceTool,
      // v3: Security classification (Glasswing Red Alert)
      classification: finalClassification,
      clientNamespace: body.clientNamespace?.trim() || undefined,
      containsPii: piiResult.containsPii || body.containsPii || false,
    }

    const memory = await storeMemory(input)

    return c.json({ success: true, memory })
  } catch (error) {
    console.error('[Memory Store] Error:', error)
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error storing memory' },
      500
    )
  }
})

export default app
