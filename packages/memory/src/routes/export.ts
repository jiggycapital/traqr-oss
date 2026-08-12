/**
 * Memory Export Route
 *
 * GET /export?format=json&domain=<name>
 */

import { Hono } from 'hono'
import { exportAllMemories, getMemoryStats } from '../lib/memory.js'
import { getVectorDB } from '../vectordb/index.js'

const app = new Hono()

app.get('/', async (c) => {
  try {
    const format = c.req.query('format') || 'json'
    const domainName = c.req.query('domain')

    let domainId: string | undefined
    if (domainName) {
      const db = getVectorDB()
      const domain = await db.getDomain(domainName)
      if (!domain) {
        return c.json({ success: false, error: `Domain not found: ${domainName}` }, 404)
      }
      domainId = domain.id
    }

    const memories = await exportAllMemories(domainId)
    const stats = await getMemoryStats()

    if (format === 'csv') {
      const headers = [
        'id', 'content', 'summary', 'category', 'tags', 'contextTags',
        'sourceType', 'sourceRef', 'sourceProject', 'confidence',
        'lastValidated', 'isArchived', 'embeddingModel', 'createdAt',
      ]

      const rows = memories.map(m => [
        m.id,
        `"${(m.content || '').replace(/"/g, '""')}"`,
        `"${(m.summary || '').replace(/"/g, '""')}"`,
        m.category || '',
        (m.tags || []).join(';'),
        (m.contextTags || []).join(';'),
        m.sourceType,
        m.sourceRef || '',
        m.sourceProject,
        m.originalConfidence,
        m.lastValidated,
        m.isArchived,
        m.embeddingModel,
        m.createdAt,
      ])

      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')

      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="memories-export-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      })
    }

    return c.json({
      success: true,
      exportedAt: new Date().toISOString(),
      count: memories.length,
      stats,
      memories,
    })
  } catch (error) {
    console.error('[Memory Export] Error:', error)
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error exporting memories' },
      500
    )
  }
})

export default app
