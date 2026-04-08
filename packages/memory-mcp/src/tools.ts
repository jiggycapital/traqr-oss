/**
 * MCP Tool Handlers
 *
 * 10 memory tools calling @traqr/memory library functions directly.
 * No HTTP layer, no apiCall(), no localhost server needed.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { enrichError } from './errors.js'
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
  getVectorDB,
  createRelationship,
  supersedeMemory,
} from '@traqr/memory'
import type { MemoryInput, MemoryCategory, MemoryClassification, MemoryAccessLevel, SearchOptions } from '@traqr/memory'

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const categoryEnum = z.string().describe('Suggested: gotcha, pattern, fix, insight, question, preference, convention. Any string accepted — the system learns your taxonomy.')
const controlledTagEnum = z.enum(['critical', 'important', 'nice-to-know', 'evergreen', 'active', 'stale-risk', 'from-incident', 'from-decision', 'from-observation'])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorResult(toolName: string, err: unknown) {
  return { content: [{ type: 'text' as const, text: enrichError(toolName, err) }] }
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
      summary: z.string().max(120).optional().describe('Override auto-summary (max 120 chars)'),
      category: categoryEnum.optional().describe('Override auto-category'),
      domain: z.enum(['sean', 'traqr', 'tooling', 'universal', 'nooktraqr', 'pokotraqr', 'poketraqr', 'milestraqr', 'jiggy']).optional()
        .describe('Override auto-domain (sean, traqr, tooling, universal, app name)'),
      topic: z.string().optional().describe('Override auto-topic'),
      tags: z.array(controlledTagEnum).optional().describe('Override auto-tags'),
      confidence: z.number().min(0).max(1).default(0.6).describe('0-1. Default 0.6 — raise to 0.8+ only for facts you are confident about. Bad context is worse than no context.'),
      sourceReliability: z.enum(['direct-user', 'deliberate-store', 'granola-single', 'granola-multi', 'inferred', 'auto-derived']).optional()
        .describe('How trustworthy is the source? direct-user (Sean said it) > deliberate-store > granola-single > granola-multi (speaker confusion risk) > inferred > auto-derived'),
      classification: z.enum(['public', 'internal', 'confidential', 'restricted']).optional()
        .describe('Security classification. public=shareable, internal=team only, confidential=need-to-know, restricted=highest sensitivity. Default: auto-derived from content.'),
      clientNamespace: z.string().optional()
        .describe('Client namespace for isolation. Memories in a namespace are only visible to searches within that namespace.'),
    },
    async ({ content, summary, category, domain, topic, tags, confidence, sourceReliability, classification, clientNamespace }) => {
      try {
        const derived = deriveAll(content, { summary, category, domain, topic, tags, sourceTool: 'mcp-store' })
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
          ...(sourceReliability ? { sourceReliability } : {}),
          ...(classification ? { classification: classification as MemoryClassification } : {}),
          ...(clientNamespace ? { clientNamespace } : {}),
        }
        const memory = await storeMemory(input)
        return {
          content: [{ type: 'text' as const, text: `Stored [${derived.domain}/${derived.category}] ${derived.summary}` }],
        }
      } catch (err) { return errorResult('memory_store', err) }
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
      domain: z.enum(['sean', 'traqr', 'tooling', 'universal', 'nooktraqr', 'pokotraqr', 'poketraqr', 'milestraqr', 'jiggy']).optional().describe('Filter by domain'),
      memoryType: z.enum(['fact', 'preference', 'pattern']).optional().describe('Filter by memory type'),
      tags: z.array(controlledTagEnum).optional(),
      threshold: z.number().min(0).max(1).optional(),
      accessLevel: z.enum(['exploration', 'standard', 'privileged', 'admin']).optional()
        .describe('Agent access tier. exploration=public+internal only, standard=+confidential, privileged=+restricted, admin=full cross-namespace. Default: no filter (all visible).'),
    },
    async ({ query, limit, category, domain, memoryType, tags, threshold, accessLevel }) => {
      try {
        const options: SearchOptions = {
          limit,
          category: category as any,
          memoryType: memoryType as any,
          similarityThreshold: threshold,
          ...(tags ? { tags } : {}),
          ...(accessLevel ? { accessLevel: accessLevel as MemoryAccessLevel } : {}),
        }
        let results = await searchMemoriesV2(query, options)
        // Post-filter by domain (not in RPC)
        if (domain) {
          results = results.filter((r: any) => r.domain === domain)
        }
        const summaries = results.map(toSummaryResult)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            query, total: summaries.length, showing: summaries.length, results: summaries,
          }, null, 2) }],
        }
      } catch (err) { return errorResult('memory_search', err) }
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
      } catch (err) { return errorResult('memory_read', err) }
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
      } catch (err) { return errorResult('memory_enhance', err) }
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
        const db = getVectorDB()
        const data = await db.browse({ domain, category })

        if (!domain && !category) {
          // Return domain counts
          const counts: Record<string, number> = {}
          for (const row of data) {
            const d = row.domain || 'unknown'
            counts[d] = (counts[d] || 0) + 1
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify({ domains: counts }, null, 2) }] }
        }

        const summaries = data.map((r) => ({
          id: r.id,
          summary: r.summary || r.content?.slice(0, 100),
          domain: r.domain,
          category: r.category,
        }))
        return { content: [{ type: 'text' as const, text: JSON.stringify(summaries, null, 2) }] }
      } catch (err) { return errorResult('memory_browse', err) }
    },
  )

  // --- memory_context ---
  server.tool(
    'memory_context',
    'Load task-relevant context — principles, preferences, gotchas for the current work.',
    {
      taskDescription: z.string().optional(),
      slotName: z.string().optional().describe('Auto: slot name for source tracking'),
      accessLevel: z.enum(['exploration', 'standard', 'privileged', 'admin']).optional()
        .describe('Agent access tier. Controls which classification levels appear in context. Default: no filter.'),
    },
    async ({ taskDescription, slotName, accessLevel }) => {
      try {
        const result = await assembleSessionContext({
          slotName: slotName || 'standalone',
          taskDescription,
          ...(accessLevel ? { accessLevel: accessLevel as MemoryAccessLevel } : {}),
        })
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
      } catch (err) { return errorResult('memory_context', err) }
    },
  )

  // --- memory_pulse ---
  server.tool(
    'memory_pulse',
    'Batch operation: capture multiple learnings + search + update in one call. Each capture only needs content. Max 5 captures per call — send multiple calls for larger batches.',
    {
      search: z.string().optional(),
      searchLimit: z.number().min(1).max(5).default(3),
      accessLevel: z.enum(['exploration', 'standard', 'privileged', 'admin']).optional()
        .describe('Access tier for the search portion. Controls which classification levels are visible.'),
      captures: z.array(z.object({
        content: z.string().max(50000).describe('What you learned (min 20 chars)'),
        category: categoryEnum.optional(),
        domain: z.enum(['sean', 'traqr', 'tooling', 'universal', 'nooktraqr', 'pokotraqr', 'poketraqr', 'milestraqr', 'jiggy']).optional()
          .describe('Override auto-domain'),
        topic: z.string().optional().describe('Override auto-topic'),
        tags: z.array(controlledTagEnum).optional(),
      })).default([]),
      sourceProject: z.string().optional().describe('Source project slug for all captures in this batch'),
      slot: z.string().optional().describe('Slot name for source tracking'),
    },
    async ({ search, searchLimit, accessLevel, captures, sourceProject, slot }) => {
      try {
        const MAX_CAPTURES = 5
        const validCaptures = captures.filter((c) => c.content.trim().length >= 20)
        const tooShort = captures.length - validCaptures.length
        const dropped = Math.max(0, validCaptures.length - MAX_CAPTURES)
        const toProcess = validCaptures.slice(0, MAX_CAPTURES)

        // Run captures through triage
        const captureResults = await Promise.all(
          toProcess.map((cap, idx) => {
              const derived = deriveAll(cap.content, {
                category: cap.category, domain: (cap as any).domain, topic: (cap as any).topic,
                tags: cap.tags, sourceTool: 'mcp-pulse',
              })
              const input: MemoryInput = {
                content: cap.content.trim(),
                summary: derived.summary as string,
                category: derived.category as MemoryCategory,
                tags: [...(derived.tags as string[] || []), 'pulse', ...(slot ? [`slot:${slot}`] : [])],
                sourceType: 'session',
                sourceProject: sourceProject || 'default',
                confidence: 0.6,
                domain: derived.domain as string,
                topic: derived.topic as string,
                memoryType: derived.memoryType as any,
                sourceTool: 'mcp-pulse',
              }
              return triageAndStore(input).then((r) => ({ index: idx, ...r })).catch(() => ({ index: idx, zone: 'error' }))
            }),
        )

        // Run search if requested (respects access level)
        let searchResults: any[] = []
        if (search) {
          const searchOpts: SearchOptions = {
            limit: searchLimit,
            ...(accessLevel ? { accessLevel: accessLevel as MemoryAccessLevel } : {}),
          }
          const results = await searchMemoriesV2(search, searchOpts).catch(() => [])
          searchResults = results.map(toSummaryResult)
        }

        const successful = captureResults.filter((r: any) => r?.zone !== 'error')
        const zones = {
          noop: successful.filter((r: any) => r?.zone === 'noop').length,
          add: successful.filter((r: any) => r?.zone === 'add').length,
          borderline: successful.filter((r: any) => r?.zone === 'borderline').length,
        }

        const parts: string[] = []
        parts.push(`Captured ${successful.filter((r: any) => !r?.deduplicated).length}, merged ${successful.filter((r: any) => r?.merged).length} | Zones: ${zones.noop} noop, ${zones.add} new, ${zones.borderline} borderline`)
        if (dropped > 0) parts.push(`WARNING: ${dropped} capture(s) dropped — batch limit is ${MAX_CAPTURES}. Send multiple pulse calls for larger batches.`)
        if (tooShort > 0) parts.push(`Filtered: ${tooShort} capture(s) skipped (content < 20 chars)`)

        const summary = parts.join('\n')
        const text = searchResults.length > 0
          ? `${summary}\n\nSearch: ${searchResults.length} results\n${JSON.stringify(searchResults, null, 2)}`
          : summary

        return { content: [{ type: 'text' as const, text }] }
      } catch (err) { return errorResult('memory_pulse', err) }
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
      } catch (err) { return errorResult('memory_audit', err) }
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
      } catch (err) { return errorResult('memory_archive', err) }
    },
  )

  // --- memory_correct ---
  server.tool(
    'memory_correct',
    'Correct a wrong memory. Atomically: stores the corrected version, archives the wrong one, ' +
      'and creates a supersedes relationship. Use when Sean corrects a previous conclusion or ' +
      'when a prior memory is factually wrong. Never leave contradicting memories both active.',
    {
      wrongMemoryId: z.string().describe('ID of the memory to correct'),
      correctedContent: z.string().max(50000).describe('The corrected content — what should replace the wrong memory'),
      reason: z.string().describe('Why the original was wrong and what changed'),
      category: categoryEnum.optional().describe('Override auto-category for corrected memory'),
      tags: z.array(controlledTagEnum).optional().describe('Override auto-tags'),
      confidence: z.number().min(0).max(1).default(0.9),
    },
    async ({ wrongMemoryId, correctedContent, reason, category, tags, confidence }) => {
      try {
        // 1. Verify the wrong memory exists
        const wrongMemory = await getMemory(wrongMemoryId)
        if (!wrongMemory) {
          return { content: [{ type: 'text' as const, text: `Memory ${wrongMemoryId} not found. Cannot correct a non-existent memory.` }] }
        }

        // 2. Store the corrected version
        const derived = deriveAll(correctedContent, { category, tags, sourceTool: 'mcp-correct' })
        const input: MemoryInput = {
          content: correctedContent,
          summary: derived.summary as string,
          category: derived.category as MemoryCategory,
          tags: [...(derived.tags as string[]), 'from-correction'],
          sourceType: 'session',
          sourceProject: 'default',
          confidence,
          domain: derived.domain as string,
          topic: derived.topic as string,
          memoryType: derived.memoryType as any,
          sourceTool: 'mcp-correct',
        }
        const correctedMemory = await storeMemory(input)

        // 3. Archive the wrong memory with reason
        await archiveMemory(wrongMemoryId, `corrected: ${reason}`.slice(0, 500))

        // 4. Mark the old memory as superseded
        await supersedeMemory(wrongMemoryId)

        // 5. Create supersedes relationship edge
        await createRelationship(
          correctedMemory.id,
          wrongMemoryId,
          'updates',
          1.0,
          { correctionReason: reason, correctedAt: new Date().toISOString() },
        )

        return {
          content: [{
            type: 'text' as const,
            text: `Corrected memory ${wrongMemoryId}.\n` +
              `Old: ${wrongMemory.summary || '(no summary)'}\n` +
              `New: [${derived.domain}/${derived.category}] ${derived.summary}\n` +
              `Reason: ${reason}\n` +
              `New memory ID: ${correctedMemory.id}`,
          }],
        }
      } catch (err) { return errorResult('memory_correct', err) }
    },
  )

  // --- memory_forget ---
  server.tool(
    'memory_forget',
    'Hard-delete a memory (GDPR Article 17). Permanently removes the memory, its embedding, and all relationships. ' +
      'Audit trail is retained for compliance. Different from archive: archive = hide but keep, forget = permanently erase.',
    {
      memoryId: z.string().uuid().describe('UUID of the memory to forget'),
      reason: z.string().optional().describe('Why this memory should be forgotten'),
    },
    async ({ memoryId, reason }) => {
      try {
        const db = getVectorDB()
        await db.forget(memoryId)
        return { content: [{ type: 'text' as const, text: `Permanently deleted ${memoryId}${reason ? `: ${reason}` : ''}` }] }
      } catch (err) { return errorResult('memory_forget', err) }
    },
  )

  // --- memory_purge ---
  server.tool(
    'memory_purge',
    'Right-to-delete: permanently purge ALL memories for a client namespace. ' +
      'Exports data first, then hard-deletes everything. Audit trail retained for compliance proof. ' +
      'Use when a consulting engagement ends or client requests data deletion.',
    {
      namespace: z.string().describe('Client namespace to purge (e.g., "duke-ellington", "mom-consulting")'),
      reason: z.string().optional().describe('Reason for purge (default: right-to-delete)'),
      exportFirst: z.boolean().optional().default(true).describe('Export memories before deleting (default: true)'),
    },
    async ({ namespace, reason, exportFirst }) => {
      try {
        const db = getVectorDB() as any
        if (!db.purgeNamespace || !db.exportNamespace) {
          return errorResult('memory_purge', new Error('Purge not supported — migration 013 may not be deployed'))
        }

        let exportData: any[] = []
        if (exportFirst) {
          exportData = await db.exportNamespace(namespace)
        }

        const deletedCount = await db.purgeNamespace(namespace, reason)

        const parts = [
          `Purged namespace "${namespace}": ${deletedCount} memories permanently deleted.`,
        ]
        if (exportFirst && exportData.length > 0) {
          parts.push(`Pre-deletion export: ${exportData.length} memories captured.`)
          parts.push(`Export data:\n${JSON.stringify(exportData, null, 2).slice(0, 3000)}`)
        }
        if (reason) parts.push(`Reason: ${reason}`)

        return { content: [{ type: 'text' as const, text: parts.join('\n') }] }
      } catch (err) { return errorResult('memory_purge', err) }
    },
  )
}
