/**
 * Memory Bootstrap Route (Portable)
 *
 * POST /bootstrap
 *   Accepts markdown sections and stores them as memories with dedup.
 *
 * Unlike the NookTraqr version which reads hardcoded file paths,
 * this portable version accepts content via the request body.
 */

import { Hono } from 'hono'
import { storeWithDedup } from '../lib/memory.js'
import type { MemoryCategory } from '../vectordb/types.js'

const VALID_CATEGORIES: MemoryCategory[] = ['gotcha', 'pattern', 'fix', 'insight', 'question', 'preference', 'convention']

interface BootstrapSection {
  content: string
  summary?: string
  category?: MemoryCategory
  tags?: string[]
  confidence?: number
  sourceRef?: string
}

const app = new Hono()

app.get('/', async (c) => {
  return c.json({
    success: true,
    usage: 'POST an array of sections to bootstrap into memory',
    schema: {
      sections: [
        {
          content: 'string (required)',
          summary: 'string (optional)',
          category: `one of: ${VALID_CATEGORIES.join(', ')}`,
          tags: 'string[] (optional)',
          confidence: 'number 0-1 (optional, default 0.8)',
          sourceRef: 'string (optional)',
        },
      ],
      sourceProject: 'string (optional, default: "default")',
      dryRun: 'boolean (optional, default: false)',
    },
  })
})

app.post('/', async (c) => {
  try {
    const body = await c.req.json()

    const sections: BootstrapSection[] = body.sections
    if (!Array.isArray(sections) || sections.length === 0) {
      return c.json({ success: false, error: 'sections array is required and must not be empty' }, 400)
    }

    const sourceProject = body.sourceProject || 'default'
    const dryRun = body.dryRun === true

    let imported = 0
    let deduplicated = 0
    let skipped = 0
    const errors: string[] = []

    for (const section of sections) {
      if (!section.content || section.content.trim().length < 20) {
        skipped++
        continue
      }

      if (section.category && !VALID_CATEGORIES.includes(section.category)) {
        errors.push(`Invalid category "${section.category}" for section: ${section.summary || section.content.slice(0, 50)}`)
        continue
      }

      if (!dryRun) {
        try {
          const result = await storeWithDedup({
            content: section.content.trim(),
            summary: section.summary,
            category: section.category || 'insight',
            tags: section.tags || [],
            sourceType: 'bootstrap',
            sourceRef: section.sourceRef,
            sourceProject,
            confidence: section.confidence ?? 0.8,
          })
          if (result.deduplicated) {
            deduplicated++
          } else {
            imported++
          }
        } catch (err) {
          errors.push(
            `Failed to store "${section.summary || section.content.slice(0, 50)}": ${err instanceof Error ? err.message : 'Unknown error'}`
          )
        }
      } else {
        imported++
      }
    }

    return c.json({
      success: errors.length === 0,
      dryRun,
      summary: {
        sectionsReceived: sections.length,
        sectionsImported: imported,
        sectionsDeduplicated: deduplicated,
        sectionsSkipped: skipped,
        errors: errors.length,
      },
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error) {
    console.error('[memory/bootstrap] Error:', error)
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      500
    )
  }
})

export default app
