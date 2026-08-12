/**
 * Thought Capture Route (Portable)
 *
 * POST /capture — Capture a thought/idea with automatic analysis
 * GET  /capture — List recent captures
 *
 * Foundation for the passive knowledge capture system.
 * Every capture is analyzed for topics, sentiment, and type,
 * then stored in the memory vector DB.
 */

import { Hono } from 'hono'
import { storeMemory, searchMemories } from '../lib/memory.js'
import { getSourceProject } from '../lib/learning-extractor.js'
import { passesIngestionGate } from '../lib/quality-gate.js'
import type { MemoryInput, MemoryCategory } from '../vectordb/types.js'

const TYPE_TO_CATEGORY: Record<string, MemoryCategory> = {
  idea: 'insight',
  observation: 'insight',
  question: 'question',
  decision: 'pattern',
  reflection: 'insight',
}

function extractTopics(content: string): string[] {
  const lowered = content.toLowerCase()
  const topics: string[] = []

  const domainKeywords: Record<string, string[]> = {
    aws: ['aws', 'amazon', 's3', 'lambda', 'ec2', 'dynamodb', 'iceberg'],
    authentication: ['auth', 'login', 'token', 'jwt', 'oauth', 'session'],
    vector: ['vector', 'embedding', 'similarity', 'semantic'],
    slack: ['slack', 'channel', 'thread', 'message'],
    marketplace: ['marketplace', 'buy', 'sell', 'creator', 'package'],
    personality: ['personality', 'identity', 'who you are', 'passive'],
    knowledge: ['knowledge', 'learn', 'skill', 'expertise', 'grading'],
    demo: ['demo', 'pitch', 'presentation', 'proof'],
    api: ['api', 'endpoint', 'route', 'request', 'response'],
    ui: ['ui', 'component', 'layout', 'button', 'form'],
    database: ['database', 'db', 'query', 'schema', 'table'],
    testing: ['test', 'spec', 'coverage', 'e2e', 'unit'],
  }

  for (const [topic, keywords] of Object.entries(domainKeywords)) {
    if (keywords.some(kw => lowered.includes(kw))) {
      topics.push(topic)
    }
  }

  return topics.slice(0, 5)
}

function detectSentiment(content: string): 'positive' | 'negative' | 'neutral' {
  const lowered = content.toLowerCase()
  const positiveWords = ['great', 'awesome', 'perfect', 'love', 'excited', 'amazing', 'brilliant', 'solved', 'works', 'success']
  const negativeWords = ['bug', 'error', 'broken', 'fail', 'issue', 'problem', 'wrong', 'bad', 'stuck', 'confused']
  const positiveCount = positiveWords.filter(w => lowered.includes(w)).length
  const negativeCount = negativeWords.filter(w => lowered.includes(w)).length
  if (positiveCount > negativeCount) return 'positive'
  if (negativeCount > positiveCount) return 'negative'
  return 'neutral'
}

function detectType(content: string): string {
  const lowered = content.toLowerCase()
  if (lowered.includes('?') || lowered.startsWith('what') || lowered.startsWith('how') || lowered.startsWith('why')) return 'question'
  if (lowered.includes('decided') || lowered.includes('will do') || lowered.includes('going to')) return 'decision'
  if (lowered.includes('realized') || lowered.includes('noticed') || lowered.includes('saw that')) return 'observation'
  if (lowered.includes('thinking about') || lowered.includes('reflecting') || lowered.includes('pondering')) return 'reflection'
  if (lowered.includes('what if') || lowered.includes('idea') || lowered.includes('could')) return 'idea'
  return 'observation'
}

const app = new Hono()

app.post('/', async (c) => {
  try {
    const body = await c.req.json()

    if (!body.content || typeof body.content !== 'string' || body.content.trim().length === 0) {
      return c.json(
        { success: false, error: 'content is required and must be a non-empty string' },
        400
      )
    }

    const content = body.content.trim()

    const gate = passesIngestionGate(content)
    if (!gate.passes) {
      return c.json(
        { success: false, error: `Quality gate rejected: ${gate.reason}` },
        400
      )
    }
    const source = body.source || 'manual'
    const userTags = Array.isArray(body.tags) ? body.tags : []
    const context = body.context?.trim() || null
    const template = body.template?.trim() || null
    const link = body.link?.trim() || null

    const topics = extractTopics(content)
    const sentiment = detectSentiment(content)
    const captureType = detectType(content)

    const category = TYPE_TO_CATEGORY[captureType] || 'insight'
    const allTags = [...new Set([...userTags, ...topics])]

    const contextTags: string[] = []
    if (context) contextTags.push(context)
    if (source) contextTags.push(`source:${source}`)
    if (template) contextTags.push(`template:${template}`)
    if (sentiment !== 'neutral') contextTags.push(`sentiment:${sentiment}`)
    contextTags.push(`type:${captureType}`)

    const input: MemoryInput = {
      content,
      summary: content.length > 100 ? content.substring(0, 97) + '...' : content,
      category,
      tags: allTags,
      contextTags,
      sourceType: 'manual',
      sourceRef: link || undefined,
      sourceProject: getSourceProject(),
      confidence: 0.6,
      relatedTo: [],
      isContradiction: false,
    }

    const memory = await storeMemory(input)

    let relatedCaptures: Array<{ id: string; content: string; similarity: number; tags: string[] }> = []
    try {
      const searchResults = await searchMemories(content, { limit: 3 })
      relatedCaptures = searchResults
        .filter(r => r.id !== memory.id)
        .slice(0, 2)
        .map(r => ({
          id: r.id,
          content: r.content.substring(0, 100) + (r.content.length > 100 ? '...' : ''),
          similarity: r.similarity,
          tags: r.tags,
        }))
    } catch (e) {
      console.warn('[Capture] Could not find related captures:', e)
    }

    const capture = {
      id: memory.id,
      content: memory.content,
      analysis: { topics, type: captureType, sentiment },
      metadata: { source, tags: allTags, context, template, link, timestamp: memory.createdAt },
    }

    return c.json({
      success: true,
      capture,
      relatedCaptures,
      message: `Captured ${captureType} about: ${topics.length > 0 ? topics.join(', ') : 'general'}`,
    })
  } catch (error) {
    console.error('[Capture] Error:', error)
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error capturing thought' },
      500
    )
  }
})

app.get('/', async (c) => {
  try {
    const limit = Math.min(parseInt(c.req.query('limit') || '10'), 50)
    const tag = c.req.query('tag')
    const template = c.req.query('template')

    const query = template ? `template:${template} ${tag || 'capture'}` : (tag || 'capture')
    const results = await searchMemories(query, {
      limit,
      tags: tag ? [tag] : undefined,
    })

    const captures = results.map(r => ({
      id: r.id,
      content: r.content,
      summary: r.summary,
      tags: r.tags,
      contextTags: r.contextTags,
      createdAt: r.createdAt,
    }))

    return c.json({ success: true, captures, count: captures.length })
  } catch (error) {
    console.error('[Capture] GET Error:', error)
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error listing captures' },
      500
    )
  }
})

export default app
