/**
 * Memory Context Assembly — Portable
 *
 * Single function that replaces 5+ serial HTTP calls in /startup.
 * Runs parallel vector searches and assembles a formatted context block
 * for injection into agent sessions.
 */

import { searchMemories } from './memory.js'
import { CATEGORY_EMOJI } from './formatting.js'
import { getMemoryClient } from './client.js'
import type { MemorySearchResult } from '../vectordb/types.js'

// ============================================================
// Types
// ============================================================

export interface SessionContextParams {
  slotName: string
  taskDescription?: string
  filesExpected?: string[]
  sourceProject?: string
}

export interface MemoryWithShortCode extends MemorySearchResult {
  shortCode: string
}

export interface SessionContext {
  principles: MemoryWithShortCode[]
  taskRelevant: MemoryWithShortCode[]
  gotchas: MemoryWithShortCode[]
  preferences: MemoryWithShortCode[]
  voiceTraits: MemoryWithShortCode[]
  identity: MemoryWithShortCode[]
  recentLearnings: MemoryWithShortCode[]
  learningsLoaded: { id: string; shortCode: string; content: string }[]
  totalFound: number
  promptContext: string
  searchTimings: { query: string; ms: number }[]
}

// ============================================================
// Domain Classification
// ============================================================

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  technical: [
    'api', 'endpoint', 'database', 'supabase', 'firebase', 'vercel',
    'posthog', 'linear', 'slack', 'webhook', 'cron', 'auth', 'sync',
    'slot', 'daemon', 'deploy', 'build', 'type', 'schema', 'migration',
    'query', 'index', 'cache', 'embedding', 'vector', 'openai',
  ],
  user: [
    'sean', 'user', 'ux', 'onboarding', 'feedback', 'preference',
    'visual', 'demo', 'pitch', 'aws', 'product', 'mvp', 'bar',
    'non-technical', 'easy', 'simple',
  ],
  process: [
    'workflow', 'process', 'ship', 'merge', 'pr', 'commit', 'review',
    'test', 'verify', 'debug', 'slot', 'sync', 'dispatch', 'plan',
    'audit', 'error message', 'diagnostic',
  ],
  meta: [
    'learning', 'memory', 'compound', 'reference', 'capture', 'bootstrap',
    'startup', 'session', 'loop', 'self-improving', 'system',
  ],
}

function classifyDomain(content: string): string {
  const lower = content.toLowerCase()
  const scores: Record<string, number> = { technical: 0, user: 0, process: 0, meta: 0 }

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        scores[domain]++
      }
    }
  }

  let best = 'technical'
  let bestScore = 0
  for (const [domain, score] of Object.entries(scores)) {
    if (score > bestScore) {
      best = domain
      bestScore = score
    }
  }
  return best
}

// ============================================================
// Timed Search Helper
// ============================================================

interface TimedSearchResult {
  results: MemorySearchResult[]
  timing: { query: string; ms: number }
}

async function timedSearch(
  label: string,
  query: string,
  options: Parameters<typeof searchMemories>[1] = {}
): Promise<TimedSearchResult> {
  const start = Date.now()
  try {
    const results = await searchMemories(query, options)
    return {
      results,
      timing: { query: label, ms: Date.now() - start },
    }
  } catch (error) {
    console.warn(`[memory-context] Search "${label}" failed:`, error)
    return {
      results: [],
      timing: { query: `${label} (FAILED)`, ms: Date.now() - start },
    }
  }
}

// ============================================================
// Core Assembly
// ============================================================

export async function assembleSessionContext(
  params: SessionContextParams
): Promise<SessionContext> {
  const { slotName, taskDescription, filesExpected } = params

  const searches = await Promise.all([
    timedSearch('principles', 'critical rules conventions best practices gotchas', {
      limit: 5,
      similarityThreshold: 0.45,
    }),

    taskDescription
      ? timedSearch('task-relevant', taskDescription, {
          limit: 7,
          similarityThreshold: 0.4,
        })
      : Promise.resolve({ results: [], timing: { query: 'task-relevant (skipped)', ms: 0 } }),

    filesExpected && filesExpected.length > 0
      ? timedSearch('gotchas', filesExpected.join(' '), {
          limit: 3,
          category: 'gotcha',
          similarityThreshold: 0.4,
        })
      : timedSearch('gotchas', `${slotName} common gotchas pitfalls`, {
          limit: 3,
          category: 'gotcha',
          similarityThreshold: 0.4,
        }),

    timedSearch('preferences', 'design preference convention style naming file structure', {
      limit: 3,
      similarityThreshold: 0.4,
    }),

    timedSearch('voice', 'writing voice tone style audience', {
      limit: 2,
      tags: ['voice'],
      similarityThreshold: 0.4,
    }),

    timedSearch('identity', 'Sean preferences priorities values target audience decision-making style', {
      limit: 3,
      tags: ['identity'],
      similarityThreshold: 0.35,
    }),
  ])

  const [principlesSearch, taskSearch, gotchasSearch, preferencesSearch, voiceSearch, identitySearch] = searches

  const seen = new Set<string>()
  const addShortCode = (r: MemorySearchResult): MemoryWithShortCode => ({
    ...r,
    shortCode: `MEM-${r.id.slice(0, 6)}`,
  })
  const dedup = (results: MemorySearchResult[]): MemoryWithShortCode[] => {
    return results
      .filter((r) => {
        if (seen.has(r.id)) return false
        seen.add(r.id)
        return true
      })
      .map(addShortCode)
  }

  const RELEVANCE_FLOOR = 0.35
  const principles = dedup(principlesSearch.results).filter(r => r.relevanceScore >= RELEVANCE_FLOOR)
  const taskRelevant = dedup(taskSearch.results).filter(r => r.relevanceScore >= RELEVANCE_FLOOR)
  const gotchas = dedup(gotchasSearch.results).filter(r => r.relevanceScore >= RELEVANCE_FLOOR)
  const preferences = dedup(preferencesSearch.results).filter(r => r.relevanceScore >= RELEVANCE_FLOOR)
  const voiceTraits = dedup(voiceSearch.results).filter(r => r.relevanceScore >= RELEVANCE_FLOOR)
  const identity = dedup(identitySearch.results).filter(r => r.relevanceScore >= RELEVANCE_FLOOR)

  const allResults = [...principles, ...taskRelevant, ...gotchas, ...preferences, ...voiceTraits, ...identity]
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const recentLearnings = allResults.filter((r) => new Date(r.createdAt) > sevenDaysAgo)

  const totalFound = allResults.length

  const learningsLoaded = allResults.map((r) => ({
    id: r.id,
    shortCode: r.shortCode,
    content: r.content.slice(0, 100),
  }))

  const searchTimings = searches.map((s) => s.timing)

  // Fire-and-forget: track which memories were returned
  if (allResults.length > 0) {
    const memoryIds = allResults.map(r => r.id)
    trackMemoryReturns(memoryIds).catch(() => {
      // Silently ignore — tracking is best-effort
    })
  }

  const promptContext = formatPromptContext({
    principles,
    taskRelevant,
    gotchas,
    preferences,
    voiceTraits,
    identity,
    taskDescription,
  })

  return {
    principles,
    taskRelevant,
    gotchas,
    preferences,
    voiceTraits,
    identity,
    recentLearnings,
    learningsLoaded,
    totalFound,
    promptContext,
    searchTimings,
  }
}

// ============================================================
// Prompt Context Formatting
// ============================================================

interface FormatParams {
  principles: MemoryWithShortCode[]
  taskRelevant: MemoryWithShortCode[]
  gotchas: MemoryWithShortCode[]
  preferences: MemoryWithShortCode[]
  voiceTraits: MemoryWithShortCode[]
  identity: MemoryWithShortCode[]
  taskDescription?: string
}

function formatPromptContext(params: FormatParams): string {
  const { principles, taskRelevant, gotchas, preferences, voiceTraits, identity, taskDescription } = params
  const lines: string[] = []

  const HARD_CAP = 15
  let totalShown = 0

  const byDomain: Record<string, MemoryWithShortCode[]> = {
    technical: [],
    user: [],
    process: [],
    meta: [],
  }

  for (const p of principles) {
    const domain = classifyDomain(p.content)
    byDomain[domain].push(p)
  }

  lines.push('RELEVANT LEARNINGS FROM VECTOR DB')
  lines.push('='.repeat(50))
  lines.push('')

  if (byDomain.technical.length > 0 && totalShown < HARD_CAP) {
    lines.push('TECHNICAL')
    lines.push('-'.repeat(30))
    for (const m of byDomain.technical.slice(0, 3)) {
      if (totalShown >= HARD_CAP) break
      const emoji = CATEGORY_EMOJI[m.category || ''] || ''
      const summary = extractSummary(m.content)
      lines.push(`  [${m.shortCode}] ${emoji} [${m.category}] ${summary}`)
      totalShown++
    }
    lines.push('')
  }

  if (byDomain.user.length > 0 && totalShown < HARD_CAP) {
    lines.push('USER/SEAN')
    lines.push('-'.repeat(30))
    for (const m of byDomain.user.slice(0, 2)) {
      if (totalShown >= HARD_CAP) break
      const emoji = CATEGORY_EMOJI[m.category || ''] || ''
      const summary = extractSummary(m.content)
      lines.push(`  [${m.shortCode}] ${emoji} [${m.category}] ${summary}`)
      totalShown++
    }
    lines.push('')
  }

  if (byDomain.process.length > 0 && totalShown < HARD_CAP) {
    lines.push('PROCESS')
    lines.push('-'.repeat(30))
    for (const m of byDomain.process.slice(0, 2)) {
      if (totalShown >= HARD_CAP) break
      const emoji = CATEGORY_EMOJI[m.category || ''] || ''
      const summary = extractSummary(m.content)
      lines.push(`  [${m.shortCode}] ${emoji} [${m.category}] ${summary}`)
      totalShown++
    }
    lines.push('')
  }

  if (byDomain.meta.length > 0 && totalShown < HARD_CAP) {
    lines.push('META')
    lines.push('-'.repeat(30))
    for (const m of byDomain.meta.slice(0, 2)) {
      if (totalShown >= HARD_CAP) break
      const emoji = CATEGORY_EMOJI[m.category || ''] || ''
      const summary = extractSummary(m.content)
      lines.push(`  [${m.shortCode}] ${emoji} [${m.category}] ${summary}`)
      totalShown++
    }
    lines.push('')
  }

  if (taskDescription && taskRelevant.length > 0 && totalShown < HARD_CAP) {
    lines.push('RELEVANT TO YOUR TASK')
    lines.push('-'.repeat(30))
    for (const m of taskRelevant.slice(0, 4)) {
      if (totalShown >= HARD_CAP) break
      const emoji = CATEGORY_EMOJI[m.category || ''] || ''
      const pct = Math.round(m.relevanceScore * 100)
      const summary = extractSummary(m.content)
      lines.push(`  [${m.shortCode}] ${emoji} [${pct}%] ${summary}`)
      totalShown++
    }
    lines.push('')
  }

  if (gotchas.length > 0) {
    lines.push('GOTCHAS / WARNINGS')
    lines.push('-'.repeat(30))
    for (const m of gotchas) {
      const summary = extractSummary(m.content)
      lines.push(`  [${m.shortCode}] ${CATEGORY_EMOJI.gotcha} ${summary}`)
    }
    lines.push('')
  }

  if (preferences.length > 0) {
    lines.push('DESIGN PREFERENCES & CONVENTIONS')
    lines.push('-'.repeat(30))
    for (const m of preferences) {
      const emoji = CATEGORY_EMOJI[m.category || ''] || ''
      const summary = extractSummary(m.content)
      lines.push(`  [${m.shortCode}] ${emoji} ${summary}`)
    }
    lines.push('')
  }

  if (voiceTraits.length > 0) {
    lines.push('VOICE PROFILE')
    lines.push('-'.repeat(30))
    for (const m of voiceTraits) {
      const summary = extractSummary(m.content)
      lines.push(`  [${m.shortCode}] ${summary}`)
    }
    lines.push('')
  }

  if (identity.length > 0) {
    lines.push('IDENTITY & CONTEXT')
    lines.push('-'.repeat(30))
    for (const m of identity) {
      const emoji = CATEGORY_EMOJI[m.category || ''] || ''
      const summary = extractSummary(m.content)
      lines.push(`  [${m.shortCode}] ${emoji} ${summary}`)
    }
    lines.push('')
  }

  lines.push('='.repeat(50))
  const total = principles.length + taskRelevant.length + gotchas.length + preferences.length + voiceTraits.length + identity.length
  lines.push(`Total: ${total} learnings loaded from vector DB`)

  return lines.join('\n')
}

function extractSummary(content: string): string {
  const lines = content.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('```')) continue
    if (trimmed.length > 150) return trimmed.slice(0, 147) + '...'
    return trimmed
  }
  return content.slice(0, 100) + '...'
}

// ============================================================
// Citation Tracking
// ============================================================

async function trackMemoryReturns(memoryIds: string[]): Promise<void> {
  if (memoryIds.length === 0) return
  try {
    const client = getMemoryClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client.rpc as any)('increment_memory_returns', {
      p_memory_ids: memoryIds,
    })
  } catch (err) {
    console.warn('[memory-context] Failed to track memory returns:', err)
  }
}
