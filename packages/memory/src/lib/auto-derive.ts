/**
 * Auto-Derive v2 — Consolidated field derivation module
 *
 * Infers domain, category, topic, summary, tags, memoryType, and more
 * from memory content. Single source of truth — imported by MCP server,
 * pulse route, store route, and any future ingestion path.
 *
 * ADR: [[MCP Redesign — Auto-Derive Module]]
 */

import type { MemoryType } from '../vectordb/types.js'

// ============================================================
// Types
// ============================================================

export interface EntityCandidate {
  name: string
  type: string // person, company, technology, project, location, concept
}

export interface DeriveResult {
  domain: string
  category: string
  topic?: string
  summary: string
  tags: string[]
  memoryType: MemoryType
  forgetAfter?: Date
  sourceTool?: string
  entityCandidates: EntityCandidate[]
}

// ============================================================
// 1. deriveDomain — detect domain from content
// ============================================================

export function deriveDomain(content: string): string {
  const c = content.toLowerCase()
  if (/\bsean\b/.test(c) || /\b(prefer|personality|background|vibe.cod|credit.card|llc|traqr enterprises)/i.test(c)) return 'sean'
  if (/\b(traqr|worktree|guardian|slot.system|daemon|memory.*(system|db)|\.traqr\/|traqr-init)/i.test(c)) return 'traqr'
  if (/\b(nooktraqr|animal.crossing|villager|island.profile|turnip)/i.test(c)) return 'nooktraqr'
  if (/\b(pokotraqr|pokopia|pokop)/i.test(c)) return 'pokotraqr'
  if (/\b(poketraqr|pokemon)/i.test(c)) return 'poketraqr'
  if (/\b(milestraqr|miles.voyager)/i.test(c)) return 'milestraqr'
  if (/\b(jiggy|capital|portfolio|earnings|koyfin)/i.test(c)) return 'jiggy'
  if (/\b(supabase|vercel|cloudflare|openai|linear|slack|github|firebase|clerk|resend|posthog)/i.test(c)) return 'tooling'
  return 'universal'
}

// ============================================================
// 2. deriveCategory — detect category from content
// ============================================================

export function deriveCategory(content: string): string {
  const c = content.toLowerCase()
  if (/\b(gotcha|critical|never\s+trust|always\s+check|warning|silently.fail|broke\b)/i.test(c)) return 'gotcha'
  if (/\b(fix|bug|root.cause|resolved|patch|was.broken|caused.by)/i.test(c)) return 'fix'
  if (/\b(prefer|values?|wants?|hates?|loves?|style|personality|blunt|direct)/i.test(c)) return 'preference'
  if (/\b(pattern|approach|technique|strategy|method|architecture|flywheel)/i.test(c)) return 'pattern'
  if (/\b(convention|rule|naming|structure|format|must.be|required)/i.test(c)) return 'convention'
  if (/\b(question|unclear|investigate|explore|wonder|unsolved)/i.test(c)) return 'question'
  return 'insight'
}

// ============================================================
// 3. deriveTopic — 18-topic scoring algorithm
// ============================================================

const TOPIC_KEYWORDS: Record<string, string[]> = {
  supabase: ['supabase', 'rpc', 'pgvector', 'rls', 'migration'],
  git: ['git', 'rebase', 'merge', 'commit', 'branch', 'push', 'stash'],
  vercel: ['vercel', 'serverless', 'edge function', 'hobby tier'],
  cloudflare: ['cloudflare', 'workers', 'cron trigger', 'd1'],
  linear: ['linear', 'ticket', 'issue', 'agent-ready'],
  slack: ['slack', 'channel', 'webhook', 'thread'],
  auth: ['auth', 'login', 'session', 'token', 'clerk', 'firebase auth'],
  deployment: ['deploy', 'production', 'build', 'ci/cd', 'ship'],
  design: ['design', 'ui', 'ux', 'dark mode', 'component', 'layout'],
  architecture: ['architecture', 'monorepo', 'package', 'platform', 'system design'],
  business: ['llc', 'business', 'revenue', 'pricing', 'saas'],
  'personal-finance': ['credit card', 'points', 'miles', 'amex', 'chase', 'capital one', 'sign-up bonus'],
  'product-strategy': ['product', 'roadmap', 'mvp', 'launch', 'users', 'growth'],
  'memory-system': ['memory', 'vector', 'embedding', 'pgvector', 'learning'],
  testing: ['test', 'e2e', 'verify', 'assertion'],
  seo: ['seo', 'sitemap', 'indexing', 'google search', 'gsc'],
  personality: ['personality', 'communication', 'decision-making', 'values'],
  workflow: ['workflow', 'process', 'shipping', 'velocity', 'bottleneck'],
}

export function deriveTopic(content: string): string | undefined {
  const c = content.toLowerCase()
  let bestTopic: string | undefined
  let bestScore = 0
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    const score = keywords.filter(kw => c.includes(kw)).length
    if (score > bestScore) { bestScore = score; bestTopic = topic }
  }
  return bestTopic
}

// ============================================================
// 4. deriveSummary — first meaningful sentence, max 120 chars
// ============================================================

export function deriveSummary(content: string): string {
  const lines = content.split(/\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('```')) continue
    const firstSentence = trimmed.split(/(?<=[.!?])\s/)[0]
    if (firstSentence && firstSentence.length <= 120) return firstSentence
    return trimmed.slice(0, 117) + '...'
  }
  return content.slice(0, 117) + '...'
}

// ============================================================
// 5. deriveTags — provenance, lifecycle, importance
// ============================================================

export function deriveTags(content: string, category: string): string[] {
  const tags: string[] = []
  const c = content.toLowerCase()
  // Provenance
  if (/\b(broke|incident|failure|crashed|lost.data|silently|wipe)/i.test(c)) tags.push('from-incident')
  else if (/\b(decided|chose|opted|picked|ruled.out|went.with)/i.test(c)) tags.push('from-decision')
  else tags.push('from-observation')
  // Lifecycle
  if (/\b(always|never|every.time|mandatory|non-negotiable|universal)/i.test(c)) tags.push('evergreen')
  else tags.push('active')
  // Importance
  if (category === 'gotcha' || /\bcritical\b/i.test(c)) tags.push('critical')
  else if (category === 'preference' || category === 'convention') tags.push('important')
  else tags.push('nice-to-know')
  return tags
}

// ============================================================
// 6. deriveMemoryType — classify fact/preference/pattern (v2)
// ============================================================

export function deriveMemoryType(content: string, category: string): MemoryType {
  // Preference: category already detected, or strong preference signals
  if (category === 'preference') return 'preference'
  if (/\b(prefers?|prioritizes?|values?|avoids?|hates?|loves?|style|personality)\b/i.test(content)) return 'preference'

  // Fact: assertions with numbers, dates, proper nouns + copula
  if (/\b(is|are|was|has|have|costs?|weighs?|measures?)\s+\d/i.test(content)) return 'fact'
  if (/\b(born|founded|created|established|started)\s+(in|on|at)\s+\d/i.test(content)) return 'fact'
  if (/\b(located|based|headquartered)\s+(in|at)\b/i.test(content)) return 'fact'
  if (/\bblood.type\b/i.test(content)) return 'fact'

  // Default: pattern
  return 'pattern'
}

// ============================================================
// 7. deriveForgetAfter — detect temporal content (v2)
// ============================================================

export function deriveForgetAfter(content: string): Date | undefined {
  const c = content.toLowerCase()

  // "this week/month/sprint" -> 7/30/14 days from now + buffer
  if (/\bthis\s+week\b/i.test(c)) {
    const d = new Date()
    d.setDate(d.getDate() + 14) // end of week + 7 day buffer
    return d
  }
  if (/\bthis\s+sprint\b/i.test(c)) {
    const d = new Date()
    d.setDate(d.getDate() + 21) // ~2 week sprint + 7 day buffer
    return d
  }
  if (/\bthis\s+month\b/i.test(c)) {
    const d = new Date()
    d.setDate(d.getDate() + 37) // end of month + 7 day buffer
    return d
  }

  // "by <day>" or "deadline <day>" -> attempt to parse
  const deadlineMatch = c.match(/\b(?:by|deadline|due|before)\s+(\w+\s+\d{1,2}(?:,?\s+\d{4})?)/i)
  if (deadlineMatch) {
    const parsed = new Date(deadlineMatch[1])
    if (!isNaN(parsed.getTime())) {
      parsed.setDate(parsed.getDate() + 7) // 7 day buffer
      return parsed
    }
  }

  return undefined
}

// ============================================================
// 8. deriveSourceTool — explicit, not auto-detected (v2)
// ============================================================
// Callers pass their own identity: 'mcp-store', 'mcp-pulse', 'http-store', etc.
// This function exists for consistency in the deriveAll interface.

export function deriveSourceTool(explicit?: string): string | undefined {
  return explicit || undefined
}

// ============================================================
// 9. extractEntityCandidates — regex NER (v2)
// ============================================================

export function extractEntityCandidates(content: string): EntityCandidate[] {
  const candidates: EntityCandidate[] = []
  const seen = new Set<string>()

  // Capitalized multi-word names (e.g., "Sean Fitzsimons", "Animal Crossing")
  const nameMatches = content.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g)
  if (nameMatches) {
    for (const name of nameMatches) {
      const key = name.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        candidates.push({ name, type: 'person' }) // default to person, can be reclassified
      }
    }
  }

  // ALL_CAPS acronyms 2+ chars (e.g., AWS, API, SQL, BMI)
  const acronymMatches = content.match(/\b[A-Z]{2,}\b/g)
  if (acronymMatches) {
    const skipAcronyms = new Set(['OR', 'AND', 'NOT', 'THE', 'FOR', 'BUT', 'NOR', 'YET', 'IF', 'AS', 'IN', 'ON', 'AT', 'TO', 'IS', 'IT', 'BY', 'OF', 'NO', 'DO', 'SO', 'UP', 'AM', 'PM', 'OK', 'VS'])
    for (const acr of acronymMatches) {
      if (!skipAcronyms.has(acr) && !seen.has(acr.toLowerCase())) {
        seen.add(acr.toLowerCase())
        candidates.push({ name: acr, type: 'technology' }) // default to technology
      }
    }
  }

  // Known technology patterns (PascalCase single words like React, Supabase, TypeScript)
  const techMatches = content.match(/\b(?:React|Supabase|Vercel|Cloudflare|TypeScript|JavaScript|PostgreSQL?|Redis|Docker|Kubernetes|NextJS|Node|Python|Rust|GraphQL|Prisma|Drizzle)\b/g)
  if (techMatches) {
    for (const tech of techMatches) {
      const key = tech.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        candidates.push({ name: tech, type: 'technology' })
      }
    }
  }

  // Known company patterns
  const companyMatches = content.match(/\b(?:Google|Apple|Amazon|Microsoft|Meta|Netflix|Anthropic|OpenAI|GitHub|Linear|Slack|Stripe|Twilio)\b/g)
  if (companyMatches) {
    for (const company of companyMatches) {
      const key = company.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        candidates.push({ name: company, type: 'company' })
      }
    }
  }

  return candidates
}

// ============================================================
// Orchestrator — derive all fields, respecting explicit overrides
// ============================================================

export function deriveAll(content: string, overrides: Partial<DeriveResult> = {}): DeriveResult {
  const category = overrides.category || deriveCategory(content)
  return {
    domain: overrides.domain || deriveDomain(content),
    category,
    topic: overrides.topic || deriveTopic(content),
    summary: overrides.summary || deriveSummary(content),
    tags: overrides.tags?.length ? overrides.tags : deriveTags(content, category),
    memoryType: overrides.memoryType || deriveMemoryType(content, category),
    forgetAfter: overrides.forgetAfter || deriveForgetAfter(content),
    sourceTool: overrides.sourceTool,
    entityCandidates: extractEntityCandidates(content),
  }
}
