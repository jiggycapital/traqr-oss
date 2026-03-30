/**
 * MCP Tool Handlers
 *
 * 10 memory tools calling @traqr/memory library functions directly.
 * No HTTP layer, no apiCall(), no localhost server needed.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  storeMemory,
  searchMemoriesV2,
  getMemory,
  archiveMemory,
  triageAndStore,
  getSystemHealth,
  getDetailedStats,
  assembleSessionContext,
  deriveAll,
  getMemoryClient,
} from '@traqr/memory'
import type { MemoryInput, MemoryCategory, SearchOptions } from '@traqr/memory'

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const categoryEnum = z.enum(['gotcha', 'pattern', 'fix', 'insight', 'question', 'preference', 'convention'])
const controlledTagEnum = z.enum(['critical', 'important', 'nice-to-know', 'evergreen', 'active', 'stale-risk', 'from-incident', 'from-decision', 'from-observation'])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorResult(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  return { content: [{ type: 'text' as const, text: `Error: ${msg}` }] }
}

function toSummaryResult(r: any) {
  return {
    id: r.id,
    summary: r.summary || (r.content ? r.content.slice(0, 120) + '...' : ''),
    domain: r.domain,
    category: r.category,
    topic: r.topic,
    score: Math.round((r.relevanceScore || r.similarity || 0) * 1000) / 1000,
  }
}

// ---------------------------------------------------------------------------
// Tool Registration
// ---------------------------------------------------------------------------

export function registerTools(server: McpServer) {

  // --- memory_store ---
  server.tool(
    'memory_store',
    'Remember something. Only content required — domain, category, summary, topic, tags are all auto-derived. ' +
      'Use when you learn a fact, preference, or pattern worth keeping. Override any field if auto-detection is wrong.',
    {
      content: z.string().max(50000).describe('What you learned — be specific. Include WHAT, WHY, WHERE.'),
      summary: z.string().max(120).optional().describe('Override auto-summary'),
      category: categoryEnum.optional().describe('Override auto-category'),
      topic: z.string().optional().describe('Override auto-topic'),
      tags: z.array(controlledTagEnum).optional().describe('Override auto-tags'),
      confidence: z.number().min(0).max(1).default(0.8),
    },
    async ({ content, summary, category, topic, tags, confidence }) => {
      try {
        const derived = deriveAll(content, { summary, category, topic, tags, sourceTool: 'mcp-store' })
        const input: MemoryInput = {
          content,
          summary: derived.summary as string,
          category: derived.category as MemoryCategory,
          tags: derived.tags as string[],
          sourceType: 'session',
          sourceProject: 'default',
          confidence,
          domain: derived.domain as string,
          topic: derived.topic as string,
          memoryType: derived.memoryType as any,
          sourceTool: 'mcp-store',
        }
        const memory = await storeMemory(input)
        return {
          content: [{ type: 'text' as const, text: `Stored [${derived.domain}/${derived.category}] ${derived.summary}` }],
        }
      } catch (err) { return errorResult(err) }
    },
  )

  // --- memory_search ---
  server.tool(
    'memory_search',
    'Search memories by meaning. Returns summaries (~30 tokens each). Use memory_read to expand a specific result.',
    {
      query: z.string().describe('Natural language search query'),
      limit: z.number().min(1).max(50).default(10),
      category: categoryEnum.optional(),
      memoryType: z.enum(['fact', 'preference', 'pattern']).optional(),
      threshold: z.number().min(0).max(1).optional(),
    },
    async ({ query, limit, category, memoryType, threshold }) => {
      try {
        const options: SearchOptions = {
          limit,
          category,
          memoryType: memoryType as any,
          similarityThreshold: threshold,
        }
        const results = await searchMemoriesV2(query, options)
        const summaries = results.map(toSummaryResult)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            query, total: summaries.length, showing: summaries.length, results: summaries,
          }, null, 2) }],
        }
      } catch (err) { return errorResult(err) }
    },
  )

  // --- memory_read ---
  server.tool(
    'memory_read',
    'Expand a memory by ID. Shows full content, metadata, version history, and related memories.',
    { memoryId: z.string().uuid().describe('UUID of the memory') },
    async ({ memoryId }) => {
      try {
        const memory = await getMemory(memoryId)
        if (!memory) return { content: [{ type: 'text' as const, text: `Memory ${memoryId} not found` }] }
        return { content: [{ type: 'text' as const, text: JSON.stringify(memory, null, 2) }] }
      } catch (err) { return errorResult(err) }
    },
  )

  // --- memory_enhance ---
  server.tool(
    'memory_enhance',
    'Deepen understanding of a topic. Stores a new connected memory that extends existing knowledge. ' +
      'Use when you learn something that adds to what you already know.',
    {
      content: z.string().max(50000).describe('New observation or detail to add'),
      context: z.string().optional().describe('Why this matters or when it applies'),
    },
    async ({ content, context }) => {
      try {
        const fullContent = context ? `${content}\n\nContext: ${context}` : content
        const derived = deriveAll(fullContent, { sourceTool: 'mcp-enhance' })
        const input: MemoryInput = {
          content: fullContent,
          summary: derived.summary as string,
          category: derived.category as MemoryCategory,
          tags: derived.tags as string[],
          sourceType: 'session',
          sourceProject: 'default',
          confidence: 0.85,
          domain: derived.domain as string,
          topic: derived.topic as string,
          memoryType: derived.memoryType as any,
          sourceTool: 'mcp-enhance',
        }
        const result = await triageAndStore(input)
        return {
          content: [{ type: 'text' as const, text: `Enhanced [${derived.domain}/${derived.category}]: ${derived.summary} (zone: ${result.zone})` }],
        }
      } catch (err) { return errorResult(err) }
    },
  )

  // --- memory_browse ---
  server.tool(
    'memory_browse',
    'Navigate memories by facet. No args = domain counts. +domain = categories. +category = summaries. Zero embedding cost.',
    {
      domain: z.string().optional(),
      category: categoryEnum.optional(),
    },
    async ({ domain, category }) => {
      try {
        // Direct query via client — browse doesn't need the full search pipeline
        const client = getMemoryClient()
        let query = (client.from('traqr_memories') as any)
          .select('domain, category, content, summary, id')
          .eq('is_archived', false)
          .eq('is_forgotten', false)

        if (domain) query = query.eq('domain', domain)
        if (category) query = query.eq('category', category)
        query = query.limit(20).order('created_at', { ascending: false })

        const { data, error } = await query
        if (error) throw new Error(error.message)

        if (!domain && !category) {
          // Return domain counts
          const counts: Record<string, number> = {}
          for (const row of data || []) {
            const d = row.domain || 'unknown'
            counts[d] = (counts[d] || 0) + 1
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify({ domains: counts }, null, 2) }] }
        }

        const summaries = (data || []).map((r: any) => ({
          id: r.id,
          summary: r.summary || r.content?.slice(0, 100),
          domain: r.domain,
          category: r.category,
        }))
        return { content: [{ type: 'text' as const, text: JSON.stringify(summaries, null, 2) }] }
      } catch (err) { return errorResult(err) }
    },
  )

  // --- memory_context ---
  server.tool(
    'memory_context',
    'Load task-relevant context — principles, preferences, gotchas for the current work.',
    {
      taskDescription: z.string().optional(),
    },
    async ({ taskDescription }) => {
      try {
        const result = await assembleSessionContext({
          slotName: 'standalone',
          taskDescription,
        })
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
      } catch (err) { return errorResult(err) }
    },
  )

  // --- memory_pulse ---
  server.tool(
    'memory_pulse',
    'Batch operation: capture multiple learnings + search + update in one call. Each capture only needs content.',
    {
      search: z.string().optional(),
      searchLimit: z.number().min(1).max(5).default(3),
      captures: z.array(z.object({
        content: z.string().max(50000).describe('What you learned (min 20 chars)'),
        category: categoryEnum.optional(),
        tags: z.array(controlledTagEnum).optional(),
      })).default([]),
    },
    async ({ search, searchLimit, captures }) => {
      try {
        // Run captures through triage
        const captureResults = await Promise.all(
          captures
            .filter((c) => c.content.trim().length >= 20)
            .slice(0, 5)
            .map((cap) => {
              const derived = deriveAll(cap.content, {
                category: cap.category, tags: cap.tags, sourceTool: 'mcp-pulse',
              })
              const input: MemoryInput = {
                content: cap.content.trim(),
                summary: derived.summary as string,
                category: derived.category as MemoryCategory,
                tags: [...(derived.tags as string[] || []), 'pulse'],
                sourceType: 'session',
                sourceProject: 'default',
                confidence: 0.8,
                domain: derived.domain as string,
                topic: derived.topic as string,
                memoryType: derived.memoryType as any,
                sourceTool: 'mcp-pulse',
              }
              return triageAndStore(input).catch(() => null)
            }),
        )

        // Run search if requested
        let searchResults: any[] = []
        if (search) {
          const results = await searchMemoriesV2(search, { limit: searchLimit }).catch(() => [])
          searchResults = results.map(toSummaryResult)
        }

        const successful = captureResults.filter(Boolean)
        const zones = {
          noop: successful.filter((r: any) => r?.zone === 'noop').length,
          add: successful.filter((r: any) => r?.zone === 'add').length,
          borderline: successful.filter((r: any) => r?.zone === 'borderline').length,
        }

        const summary = `Captured ${successful.filter((r: any) => !r?.deduplicated).length}, merged ${successful.filter((r: any) => r?.merged).length} | Zones: ${zones.noop} noop, ${zones.add} new, ${zones.borderline} borderline`
        const text = searchResults.length > 0
          ? `${summary}\n\nSearch: ${searchResults.length} results\n${JSON.stringify(searchResults, null, 2)}`
          : summary

        return { content: [{ type: 'text' as const, text }] }
      } catch (err) { return errorResult(err) }
    },
  )

  // --- memory_audit ---
  server.tool(
    'memory_audit',
    'Memory system health, stats, and quality metrics.',
    {},
    async () => {
      try {
        const [health, stats] = await Promise.all([
          getSystemHealth(),
          getDetailedStats(),
        ])
        return { content: [{ type: 'text' as const, text: JSON.stringify({ health, stats }, null, 2) }] }
      } catch (err) { return errorResult(err) }
    },
  )

  // --- memory_archive ---
  server.tool(
    'memory_archive',
    'Archive a memory. Use for stale or outdated content that was once correct.',
    {
      memoryId: z.string().uuid(),
      reason: z.string().describe('Why: stale, incorrect, duplicate, noise'),
    },
    async ({ memoryId, reason }) => {
      try {
        await archiveMemory(memoryId, reason)
        return { content: [{ type: 'text' as const, text: `Archived ${memoryId}: ${reason}` }] }
      } catch (err) { return errorResult(err) }
    },
  )

  // --- memory_forget ---
  server.tool(
    'memory_forget',
    'Forget a memory. Use for incorrect, irrelevant, or harmful content that should never surface again. ' +
      'Different from archive: archive = once correct but now stale, forget = should not exist.',
    {
      memoryId: z.string().uuid().describe('UUID of the memory to forget'),
      reason: z.string().optional().describe('Why this memory should be forgotten'),
    },
    async ({ memoryId, reason }) => {
      try {
        const client = getMemoryClient()
        const { error } = await (client.from('traqr_memories') as any)
          .update({
            is_forgotten: true,
            forgotten_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', memoryId)
        if (error) throw new Error(error.message)
        return { content: [{ type: 'text' as const, text: `Forgotten ${memoryId}${reason ? `: ${reason}` : ''}` }] }
      } catch (err) { return errorResult(err) }
    },
  )
}
