/**
 * Voice Analysis Route (Portable)
 *
 * POST /analyze-voice — Accepts writing samples, extracts voice traits
 * via LLM, and stores them as preference memories with voice tags.
 */

import { Hono } from 'hono'
import { extractVoiceTraits } from '../lib/learning-extractor.js'
import type { VoiceAnalysisType, VoiceAnalysisContext } from '../lib/learning-extractor.js'

const VALID_ANALYSIS_TYPES: VoiceAnalysisType[] = [
  'user-facing', 'business', 'technical', 'social', 'brand', 'full',
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
      if (!analysis.writingSamples || !Array.isArray(analysis.writingSamples) || analysis.writingSamples.length === 0) {
        return c.json(
          { success: false, error: `writingSamples required for analysisType: ${analysis.analysisType}` },
          400
        )
      }
    }

    let totalStored = 0
    let totalDeduplicated = 0
    const allErrors: string[] = []
    const byType: Record<string, { stored: number; deduplicated: number; learnings: number }> = {}

    for (const analysis of body.analyses) {
      const context: VoiceAnalysisContext = {
        analysisType: analysis.analysisType,
        writingSamples: analysis.writingSamples.map((s: { label: string; content: string }) => ({
          label: s.label,
          content: String(s.content).slice(0, 4500),
        })),
      }

      const result = await extractVoiceTraits(context)

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
    console.error('[Memory Analyze Voice] Error:', error)
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error analyzing voice' },
      500
    )
  }
})

export default app
