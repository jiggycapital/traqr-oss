/**
 * Codebase Analysis Route (Portable)
 *
 * POST /analyze-codebase — Accepts file samples, extracts design preferences
 * and coding conventions via LLM, stores in memory.
 */

import { Hono } from 'hono'
import { extractFromCodebaseAnalysis } from '../lib/learning-extractor.js'
import type { CodebaseAnalysisContext } from '../lib/learning-extractor.js'

const VALID_ANALYSIS_TYPES = [
  'component-patterns', 'design-system', 'state-management',
  'error-handling', 'api-patterns', 'naming-conventions',
  'typescript-patterns', 'animation-patterns', 'layout-patterns',
  'performance-patterns', 'full',
]

const app = new Hono()

app.post('/', async (c) => {
  try {
    const body = await c.req.json()

    if (!body.analyses || !Array.isArray(body.analyses) || body.analyses.length === 0) {
      return c.json(
        { success: false, error: 'analyses array is required and must not be empty' },
        400
      )
    }

    for (const analysis of body.analyses) {
      if (!analysis.analysisType || !VALID_ANALYSIS_TYPES.includes(analysis.analysisType)) {
        return c.json(
          { success: false, error: `Invalid analysisType: ${analysis.analysisType}. Must be one of: ${VALID_ANALYSIS_TYPES.join(', ')}` },
          400
        )
      }
      if (!analysis.fileSamples || !Array.isArray(analysis.fileSamples) || analysis.fileSamples.length === 0) {
        return c.json(
          { success: false, error: `fileSamples required for analysisType: ${analysis.analysisType}` },
          400
        )
      }
    }

    let totalStored = 0
    let totalDeduplicated = 0
    const allErrors: string[] = []
    const byType: Record<string, { stored: number; deduplicated: number; learnings: number }> = {}

    for (const analysis of body.analyses) {
      const context: CodebaseAnalysisContext = {
        analysisType: analysis.analysisType,
        fileSamples: analysis.fileSamples.map((f: { path: string; content: string }) => ({
          path: f.path,
          content: String(f.content).slice(0, 4500),
        })),
        configFiles: analysis.configFiles?.map((f: { path: string; content: string }) => ({
          path: f.path,
          content: String(f.content).slice(0, 3000),
        })),
      }

      const result = await extractFromCodebaseAnalysis(context)

      totalStored += result.memoriesStored
      totalDeduplicated += result.memoriesDeduplicated
      allErrors.push(...result.errors)

      byType[analysis.analysisType] = {
        stored: result.memoriesStored,
        deduplicated: result.memoriesDeduplicated,
        learnings: result.learnings.length,
      }
    }

    return c.json({
      success: true,
      totalStored,
      totalDeduplicated,
      byType,
      errors: allErrors,
    })
  } catch (error) {
    console.error('[Memory Analyze Codebase] Error:', error)
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error analyzing codebase' },
      500
    )
  }
})

export default app
