/**
 * Context Assembly Route (Portable)
 *
 * POST /assemble-context — Runs parallel vector searches and returns
 * assembled session context. Replaces 5+ serial HTTP calls in /startup.
 */

import { Hono } from 'hono'
import { assembleSessionContext } from '../lib/context.js'

const app = new Hono()

app.post('/', async (c) => {
  try {
    const body = await c.req.json()
    const { slotName, taskDescription, filesExpected, sourceProject } = body

    if (!slotName) {
      return c.json({ error: 'slotName is required' }, 400)
    }

    const context = await assembleSessionContext({
      slotName,
      taskDescription,
      filesExpected,
      sourceProject,
    })

    return c.json({
      success: true,
      slotName,
      taskDescription: taskDescription || null,
      totalFound: context.totalFound,
      counts: {
        principles: context.principles.length,
        taskRelevant: context.taskRelevant.length,
        gotchas: context.gotchas.length,
        preferences: context.preferences.length,
        voiceTraits: context.voiceTraits.length,
        identity: context.identity.length,
        recentLearnings: context.recentLearnings.length,
      },
      searchTimings: context.searchTimings,
      promptContext: context.promptContext,
      results: {
        principles: context.principles.map(summarize),
        taskRelevant: context.taskRelevant.map(summarize),
        gotchas: context.gotchas.map(summarize),
        preferences: context.preferences.map(summarize),
        voiceTraits: context.voiceTraits.map(summarize),
        identity: context.identity.map(summarize),
      },
    })
  } catch (error) {
    console.error('[memory/assemble-context] Error:', error)
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

function summarize(r: { id: string; content: string; category?: string; tags: string[]; relevanceScore: number; sourceRef?: string }) {
  return {
    id: r.id,
    category: r.category,
    tags: r.tags,
    relevanceScore: Math.round(r.relevanceScore * 100) / 100,
    sourceRef: r.sourceRef,
    contentPreview: r.content.length > 200 ? r.content.slice(0, 200) + '...' : r.content,
  }
}

export default app
