/**
 * Memory Dashboard Route
 *
 * GET /dashboard?hours=24
 * Returns overview stats and recent learnings.
 */

import { Hono } from 'hono'
import { getMemoryClient, getTableName } from '../lib/client.js'

const app = new Hono()

app.get('/', async (c) => {
  try {
    const hours = parseInt(c.req.query('hours') || '24', 10)

    const supabase = getMemoryClient()
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [totalResult, recentResult, categoryResult, sourceResult] = await Promise.all([
      (supabase.from(getTableName()) as any)
        .select('id', { count: 'exact', head: true })
        .eq('is_archived', false),
      (supabase.from(getTableName()) as any)
        .select('id, content, category, tags, created_at, original_confidence')
        .eq('is_archived', false)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(10),
      (supabase.from(getTableName()) as any)
        .select('category')
        .eq('is_archived', false),
      (supabase.from(getTableName()) as any)
        .select('source_type')
        .eq('is_archived', false),
    ])

    const categories = ((categoryResult.data || []) as Array<{ category: string }>).reduce(
      (acc: Record<string, number>, m) => {
        const cat = m.category || 'uncategorized'
        acc[cat] = (acc[cat] || 0) + 1
        return acc
      },
      {} as Record<string, number>
    )

    const sources = ((sourceResult.data || []) as Array<{ source_type: string }>).reduce(
      (acc: Record<string, number>, m) => {
        const src = m.source_type || 'unknown'
        acc[src] = (acc[src] || 0) + 1
        return acc
      },
      {} as Record<string, number>
    )

    type RecentRow = { id: string; content: string; category: string; tags: string[]; created_at: string; original_confidence: number }
    const recentLearnings = ((recentResult.data || []) as RecentRow[]).map((m) => ({
      id: m.id,
      shortCode: `MEM-${m.id.slice(0, 6)}`,
      content: m.content.length > 100 ? m.content.slice(0, 100) + '...' : m.content,
      category: m.category,
      tags: m.tags,
      confidence: m.original_confidence,
      createdAt: m.created_at,
    }))

    const totalCount = totalResult.count || 0
    const recentCount = recentResult.data?.length || 0
    const avgConfidence =
      recentLearnings.length > 0
        ? recentLearnings.reduce((sum: number, l) => sum + (l.confidence || 0.7), 0) / recentLearnings.length
        : 0

    return c.json({
      success: true,
      overview: {
        totalMemories: totalCount,
        recentCount: recentCount,
        hoursQueried: hours,
        avgRecentConfidence: Math.round(avgConfidence * 100) / 100,
      },
      breakdown: {
        byCategory: categories,
        bySource: sources,
      },
      recentLearnings,
      qualityIndicators: {
        hasGotchas: (categories['gotcha'] || 0) > 0,
        hasPatterns: (categories['pattern'] || 0) > 0,
        hasPreferences: (categories['preference'] || 0) > 0,
        diversityScore: Object.keys(categories).length,
      },
      lastUpdated: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[memory/dashboard] Error:', error)
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      500
    )
  }
})

export default app
