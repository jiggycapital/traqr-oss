/**
 * Learnings Query Route (Portable)
 *
 * GET /learnings?hours=24&format=json|slack|text&category=gotcha
 * Returns all learnings organized by domain.
 */

import { Hono } from 'hono'
import { exportAllMemories } from '../lib/memory.js'
import { CATEGORY_EMOJI } from '../lib/formatting.js'
import type { MemoryExport, MemoryCategory } from '../vectordb/types.js'

// ============================================================
// Domain Classification
// ============================================================

type LearningDomain = 'technical' | 'user' | 'process' | 'meta'

const DOMAIN_INFO: Record<LearningDomain, { emoji: string; title: string; description: string }> = {
  technical: {
    emoji: '🔧',
    title: 'Technical',
    description: 'Code patterns, architecture, bugs, file locations',
  },
  user: {
    emoji: '👤',
    title: 'User/Personal',
    description: "User preferences, priorities, communication style",
  },
  process: {
    emoji: '📋',
    title: 'Process',
    description: 'Workflows, verification, bottlenecks, automation',
  },
  meta: {
    emoji: '🧠',
    title: 'Meta',
    description: 'How to learn better, compounding patterns',
  },
}

interface OrganizedLearnings {
  technical: MemoryExport[]
  user: MemoryExport[]
  process: MemoryExport[]
  meta: MemoryExport[]
  uncategorized: MemoryExport[]
}

function classifyToDomain(memory: MemoryExport): { domain: LearningDomain; confidence: number } {
  const content = memory.content.toLowerCase()
  const tags = memory.tags.map(t => t.toLowerCase())
  const allText = `${content} ${tags.join(' ')} ${memory.sourceRef || ''}`

  const technicalKeywords = [
    'function', 'api', 'code', 'error', 'bug', 'fix', 'type', 'typescript',
    'import', 'export', 'route', 'endpoint', 'database', 'query', 'schema',
    'component', 'hook', 'state', 'render', 'build', 'deploy', 'git', 'pr',
    'file', 'path', 'src/', 'lib/', 'config', 'env', 'variable', 'parameter',
    'supabase', 'firebase', 'vercel', 'kv', 'slot', 'orchestrat',
  ]
  const userKeywords = [
    'sean', 'user', 'preference', 'communication', 'frustrat', 'excit',
    'priority', 'vision', 'decision', 'style', 'thinks', 'wants', 'values',
    'feedback', 'non-technical', 'demo', 'pitch', 'aws', 'business',
    'convention', 'design', 'layout', 'color', 'ux', 'ui', 'animation',
  ]
  const processKeywords = [
    'workflow', 'flow', 'process', 'step', 'procedure', 'verification',
    'testing', 'deploy', 'ship', 'merge', 'sync', 'before', 'after',
    'checklist', 'debug', 'diagnos', 'bottleneck', 'automat', 'gate',
  ]
  const metaKeywords = [
    'learning', 'memory', 'capture', 'reference', 'compound', 'improve',
    'system', 'pattern', 'domain', 'cross-reference', 'update', 'log',
    'obsessive', 'addicted', 'record', 'store', 'query', 'search',
  ]

  const scores = { technical: 0, user: 0, process: 0, meta: 0 }

  for (const kw of technicalKeywords) { if (allText.includes(kw)) scores.technical++ }
  for (const kw of userKeywords) { if (allText.includes(kw)) scores.user++ }
  for (const kw of processKeywords) { if (allText.includes(kw)) scores.process++ }
  for (const kw of metaKeywords) { if (allText.includes(kw)) scores.meta++ }

  // Category-based boosting
  if (memory.category === 'gotcha' || memory.category === 'fix') scores.technical += 2
  if (memory.category === 'pattern') scores.process += 1
  if (memory.category === 'insight') scores.meta += 1
  if (memory.category === 'preference') scores.user += 2
  if (memory.category === 'convention') { scores.technical += 1; scores.process += 1 }

  const entries = Object.entries(scores) as [LearningDomain, number][]
  entries.sort((a, b) => b[1] - a[1])

  const [topDomain, topScore] = entries[0]
  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0)

  return {
    domain: topDomain,
    confidence: totalScore > 0 ? topScore / totalScore : 0.25,
  }
}

function organizeLearnings(memories: MemoryExport[]): OrganizedLearnings {
  const organized: OrganizedLearnings = {
    technical: [], user: [], process: [], meta: [], uncategorized: [],
  }

  for (const memory of memories) {
    const classification = classifyToDomain(memory)
    if (classification.confidence >= 0.2) {
      organized[classification.domain].push(memory)
    } else {
      organized.uncategorized.push(memory)
    }
  }

  for (const domain of Object.keys(organized) as (keyof OrganizedLearnings)[]) {
    organized[domain].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  }

  return organized
}

function formatForSlack(organized: OrganizedLearnings, hoursBack: number): object[] {
  const blocks: object[] = []

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: `📚 Learnings (Last ${hoursBack}h)`, emoji: true },
  })
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `_Organized by domain for easy review_` }],
  })
  blocks.push({ type: 'divider' })

  const domains: LearningDomain[] = ['technical', 'user', 'process', 'meta']

  for (const domain of domains) {
    const learnings = organized[domain]
    if (learnings.length === 0) continue

    const info = DOMAIN_INFO[domain]
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `${info.emoji} *${info.title}* (${learnings.length})\n_${info.description}_` },
    })

    const displayed = learnings.slice(0, 5)
    for (const learning of displayed) {
      const categoryEmoji = CATEGORY_EMOJI[learning.category || ''] || '📝'
      const source = learning.sourceRef ? ` — _${learning.sourceRef}_` : ''
      const truncated = learning.content.length > 200
        ? learning.content.slice(0, 200) + '...'
        : learning.content

      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `${categoryEmoji} ${truncated}${source}` },
      })
    }

    if (learnings.length > 5) {
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `_+ ${learnings.length - 5} more ${info.title.toLowerCase()} learnings_` }],
      })
    }

    blocks.push({ type: 'divider' })
  }

  const total = domains.reduce((sum, d) => sum + organized[d].length, 0)
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `*Total:* ${total} learnings | Technical: ${organized.technical.length} | User: ${organized.user.length} | Process: ${organized.process.length} | Meta: ${organized.meta.length}`,
    }],
  })

  return blocks
}

function formatForText(organized: OrganizedLearnings, hoursBack: number): string {
  const lines: string[] = []
  lines.push(`# Learnings (Last ${hoursBack}h)`)
  lines.push('')

  const domains: LearningDomain[] = ['technical', 'user', 'process', 'meta']

  for (const domain of domains) {
    const learnings = organized[domain]
    if (learnings.length === 0) continue

    const info = DOMAIN_INFO[domain]
    lines.push(`## ${info.emoji} ${info.title} (${learnings.length})`)
    lines.push(`_${info.description}_`)
    lines.push('')

    for (const learning of learnings) {
      const categoryEmoji = CATEGORY_EMOJI[learning.category || ''] || '📝'
      const source = learning.sourceRef ? ` — ${learning.sourceRef}` : ''
      lines.push(`- ${categoryEmoji} ${learning.content}${source}`)
    }

    lines.push('')
  }

  const total = domains.reduce((sum, d) => sum + organized[d].length, 0)
  lines.push('---')
  lines.push(
    `**Total:** ${total} | Technical: ${organized.technical.length} | User: ${organized.user.length} | Process: ${organized.process.length} | Meta: ${organized.meta.length}`
  )

  return lines.join('\n')
}

// ============================================================
// Route
// ============================================================

const app = new Hono()

app.get('/', async (c) => {
  try {
    const hoursBack = parseInt(c.req.query('hours') || '24', 10)
    const format = c.req.query('format') || 'json'
    const category = c.req.query('category') as MemoryCategory | undefined

    const allMemories = await exportAllMemories()

    const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000)
    let filteredMemories = allMemories.filter(
      m => new Date(m.createdAt) >= cutoff && !m.isArchived
    )

    if (category) {
      filteredMemories = filteredMemories.filter(m => m.category === category)
    }

    const organized = organizeLearnings(filteredMemories)

    if (format === 'slack') {
      const blocks = formatForSlack(organized, hoursBack)
      return c.json({ blocks })
    }

    if (format === 'text') {
      const text = formatForText(organized, hoursBack)
      return new Response(text, {
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    return c.json({
      success: true,
      hoursBack,
      totalLearnings: filteredMemories.length,
      byDomain: {
        technical: organized.technical.length,
        user: organized.user.length,
        process: organized.process.length,
        meta: organized.meta.length,
      },
      learnings: organized,
    })
  } catch (error) {
    console.error('[memory/learnings] Error:', error)
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      500
    )
  }
})

export default app
