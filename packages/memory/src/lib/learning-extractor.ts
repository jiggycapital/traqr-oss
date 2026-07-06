/**
 * Learning Extractor — Portable
 *
 * Auto-extract learnings from PRs, sessions, codebases, and voice samples.
 * Uses OpenAI for extraction, stores in @traqr/memory.
 *
 * Portable version: no NookTraqr-specific imports. Uses package-internal
 * memory operations and env-based project identity.
 */

import OpenAI from 'openai'
import { storeWithDedup, searchMemories } from './memory.js'
import { passesQualityGate } from './quality-gate.js'
import type { MemoryCategory } from '../vectordb/types.js'

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null
  return new OpenAI({ apiKey })
}

// ============================================================
// Project Identity
// ============================================================

/**
 * Resolve the current project slug for memory tagging.
 * Checks env var first (set by daemon/templates), falls back to 'default'.
 */
export function getSourceProject(): string {
  return process.env.TRAQR_SOURCE_PROJECT || process.env.NEXT_PUBLIC_TRAQR_PROJECT_SLUG || 'default'
}

// ============================================================
// Types
// ============================================================

export interface PRContext {
  prNumber: number
  title: string
  filesChanged: string[]
  diffSummary?: string
  templatePath?: string
  description?: string
}

export type SuggestedLayer = 'vector_db' | 'claude_memory' | 'claude_md'

export interface ExtractedLearning {
  content: string
  category: MemoryCategory
  tags: string[]
  confidence: number
  suggestedLayer?: SuggestedLayer
}

export interface ExtractionResult {
  memoriesStored: number
  memoriesDeduplicated: number
  learnings: ExtractedLearning[]
  errors: string[]
  layerSuggestions: Array<{ content: string; layer: SuggestedLayer; reason: string }>
}

// ============================================================
// Constants
// ============================================================

const EXTRACTION_PROMPT = `You are analyzing a completed pull request to extract learnings that will help with future development.

PR Details:
- Number: #{{prNumber}}
- Title: {{title}}
- Files Changed: {{filesChanged}}
{{#if diffSummary}}
- Diff Summary: {{diffSummary}}
{{/if}}
{{#if description}}
- Description: {{description}}
{{/if}}
{{#if templatePath}}
- Template/Domain: {{templatePath}}
{{/if}}

Extract 1-3 learnings MAX. Quality over quantity. Return empty array if nothing notable — most PRs have ZERO novel learnings. Only extract if a future agent would genuinely do something WRONG without this knowledge.

Focus on:
1. **Gotchas**: Things that could trip someone up in the future
2. **Patterns**: Approaches that worked well and should be repeated
3. **Fixes**: Solutions to specific problems
4. **Insights**: Non-obvious realizations about the codebase or domain
5. **Preferences**: Developer style choices, design decisions, how things are preferred
6. **Conventions**: Naming patterns, file structure rules, project conventions
7. **Identity**: What does this PR reveal about the developer's priorities, decision-making, target audience, or values?

For each learning, provide:
- content: A clear, actionable statement (1-2 sentences)
- category: One of "gotcha", "pattern", "fix", "insight", "preference", "convention"
- tags: 2-4 relevant tags (lowercase, no spaces)
- confidence: How confident you are this is valuable (0.5-1.0)

Rules:
- Be specific, not generic. "Use thread_ts not ts for Slack replies" is good. "Be careful with Slack" is bad.
- Include context about WHY, not just WHAT
- Reference specific APIs, functions, or patterns when relevant
- Only extract learnings that would genuinely help future development
- If there's nothing notable to learn, return an empty array

ANTI-PATTERNS (auto-reject):
- "Be careful with..." → too vague
- "Remember to..." → no specificity
- "Always make sure..." → generic advice
- "Consider..." → not actionable

REQUIRED for every learning:
- Specific file path, function name, or API quirk
- Answer: "What would a future agent do DIFFERENTLY because of this?"
- Minimum 50 characters

THE ACID TEST: Would a future agent say "I would have done that wrong without knowing this"? If no, don't extract it.

IMPORTANT: You are working with LIMITED context (PR metadata only, not full diff). If you cannot be brutally specific, return FEWER learnings or an empty array. 0 learnings is better than 3 vague ones.

Respond with JSON only:
{
  "learnings": [
    {
      "content": "...",
      "category": "gotcha|pattern|fix|insight",
      "tags": ["tag1", "tag2"],
      "confidence": 0.6
    }
  ]
}
`

// ============================================================
// Validation & Quality Gate
// ============================================================

const VALID_CATEGORIES: MemoryCategory[] = [
  'gotcha', 'pattern', 'fix', 'insight', 'question', 'preference', 'convention',
]

function isValidLearning(l: unknown): l is ExtractedLearning {
  if (typeof l !== 'object' || l === null) return false
  const obj = l as Record<string, unknown>

  return (
    typeof obj.content === 'string' &&
    obj.content.length > 10 &&
    typeof obj.category === 'string' &&
    VALID_CATEGORIES.includes(obj.category as MemoryCategory)
  )
}

// BANNED_PHRASES, SPECIFICITY_MARKERS, FLUFF_PATTERNS, and passesQualityGate
// are imported from ./quality-gate.ts (shared with ingestion routes)

// ============================================================
// Layer Classification
// ============================================================

function classifyLayer(learning: ExtractedLearning): { layer: SuggestedLayer; reason: string } {
  const { content, category, tags } = learning

  const identityTags = ['identity', 'identity:value', 'identity:preference', 'identity:priority',
    'identity:thinking-style', 'identity:communication', 'identity:audience']
  if (tags.some(t => identityTags.includes(t)) || category === 'preference') {
    if (/\bSean\b/i.test(content) || /\b(prefers?|values?|prioritizes?|hates?)\b/i.test(content)) {
      return { layer: 'claude_memory', reason: 'Personal preference — suggest for Claude /memory' }
    }
  }

  if (category === 'convention' || tags.includes('convention')) {
    return { layer: 'claude_md', reason: 'Project convention — suggest for CLAUDE.md' }
  }
  if (/\b(always|never|must)\s+(use|import|name|prefix)\b/i.test(content) && category !== 'gotcha') {
    return { layer: 'claude_md', reason: 'Stable rule — suggest for CLAUDE.md' }
  }

  return { layer: 'vector_db', reason: 'Situational learning — store in vector DB' }
}

// ============================================================
// Preflight Dedup Check
// ============================================================

async function shouldSkipExtraction(searchText: string): Promise<boolean> {
  try {
    const existing = await searchMemories(searchText, {
      limit: 5,
      similarityThreshold: 0.8,
    })
    if (existing.length >= 3) {
      console.error(`[learning-extractor] Preflight dedup: ${existing.length} memories at >0.8 similarity, skipping extraction`)
      return true
    }
  } catch {
    // If search fails, proceed with extraction
  }
  return false
}

// ============================================================
// Main Extraction Function
// ============================================================

export async function extractLearningsFromPR(
  context: PRContext
): Promise<ExtractionResult> {
  const result: ExtractionResult = {
    memoriesStored: 0,
    memoriesDeduplicated: 0,
    learnings: [],
    errors: [],
    layerSuggestions: [],
  }

  try {
    const searchText = `${context.title} ${context.filesChanged.join(' ')}`
    if (await shouldSkipExtraction(searchText)) {
      return result
    }

    const learnings = await callClaudeForExtraction(context)

    if (!learnings || learnings.length === 0) {
      return result
    }

    result.learnings = learnings

    for (const learning of learnings) {
      const { layer, reason } = classifyLayer(learning)
      learning.suggestedLayer = layer

      if (layer !== 'vector_db') {
        result.layerSuggestions.push({ content: learning.content, layer, reason })
        learning.tags = [...learning.tags, `suggested-layer:${layer}`]
      }

      try {
        const { deduplicated } = await storeWithDedup({
          content: learning.content,
          category: learning.category,
          tags: learning.tags,
          sourceType: 'pr',
          sourceTool: 'learning-extractor',
          sourceRef: `PR #${context.prNumber}: ${context.title}`,
          sourceProject: getSourceProject(),
          confidence: learning.confidence,
          contextTags: context.templatePath
            ? [context.templatePath]
            : undefined,
        })
        if (deduplicated) {
          result.memoriesDeduplicated++
        } else {
          result.memoriesStored++
        }
      } catch (err) {
        result.errors.push(
          `Failed to store learning: ${err instanceof Error ? err.message : 'Unknown error'}`
        )
      }
    }
  } catch (err) {
    result.errors.push(
      `Extraction failed: ${err instanceof Error ? err.message : 'Unknown error'}`
    )
  }

  return result
}

// ============================================================
// Claude API Call
// ============================================================

async function callClaudeForExtraction(
  context: PRContext
): Promise<ExtractedLearning[]> {
  const openai = getOpenAIClient()
  if (!openai) {
    console.warn('[learning-extractor] No OPENAI_API_KEY, skipping extraction')
    return []
  }

  const prompt = EXTRACTION_PROMPT
    .replace('{{prNumber}}', String(context.prNumber))
    .replace('{{title}}', context.title)
    .replace('{{filesChanged}}', context.filesChanged.join(', '))
    .replace('{{#if diffSummary}}', context.diffSummary ? '' : '<!--')
    .replace('{{/if}}', context.diffSummary ? '' : '-->')
    .replace('{{diffSummary}}', context.diffSummary || '')
    .replace('{{#if description}}', context.description ? '' : '<!--')
    .replace('{{/if}}', context.description ? '' : '-->')
    .replace('{{description}}', context.description || '')
    .replace('{{#if templatePath}}', context.templatePath ? '' : '<!--')
    .replace('{{/if}}', context.templatePath ? '' : '-->')
    .replace('{{templatePath}}', context.templatePath || '')

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    })

    const textContent = response.choices[0]?.message?.content
    if (!textContent) return []

    const jsonMatch = textContent.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return []

    const parsed = JSON.parse(jsonMatch[0])
    if (!parsed.learnings || !Array.isArray(parsed.learnings)) return []

    return parsed.learnings
      .filter((l: unknown) => isValidLearning(l))
      .map((l: ExtractedLearning) => ({
        content: l.content.trim(),
        category: l.category as MemoryCategory,
        tags: Array.isArray(l.tags)
          ? l.tags.map((t) => String(t).toLowerCase().trim())
          : [],
        confidence: Math.min(1, Math.max(0.5, Number(l.confidence) || 0.7)),
      }))
      .filter((l: ExtractedLearning) => passesQualityGate(l))
  } catch (err) {
    console.error('[learning-extractor] OpenAI API error:', err)
    return []
  }
}

// ============================================================
// Codebase Analysis Extraction
// ============================================================

export interface CodebaseAnalysisContext {
  analysisType: 'component-patterns' | 'design-system' | 'state-management'
    | 'error-handling' | 'api-patterns' | 'naming-conventions'
    | 'typescript-patterns' | 'animation-patterns' | 'layout-patterns'
    | 'performance-patterns' | 'full'
  fileSamples: { path: string; content: string }[]
  configFiles?: { path: string; content: string }[]
}

export interface CodebaseAnalysisResult {
  memoriesStored: number
  memoriesDeduplicated: number
  learnings: ExtractedLearning[]
  errors: string[]
  analysisType: string
}

const CODEBASE_ANALYSIS_PROMPT = `You are analyzing source code files to extract the developer's design preferences and coding conventions.

Analysis Type: {{analysisType}}

{{#if configFiles}}
Config Files:
{{configFiles}}
{{/if}}

Source Files:
{{fileSamples}}

Extract the developer's design preferences and coding conventions from these files. Focus on CHOICES — what they chose over alternatives, and WHY it matters.

Extract 5-15 learnings. Be exhaustive — every color choice, naming convention, animation parameter, component pattern, and style decision is worth capturing.

Categories to use:
- **preference**: Coding style, design choices, how the developer likes things done
- **convention**: Project rules, naming patterns, file structure conventions
- **pattern**: Reusable architectural patterns
- **insight**: Non-obvious design decisions and their rationale

For each learning, provide:
- content: A specific, actionable statement (1-2 sentences). Include exact values when possible.
- category: One of "preference", "convention", "pattern", "insight"
- tags: 2-4 relevant tags (lowercase, no spaces)
- confidence: How confident (0.5-1.0)

Respond with JSON only:
{
  "learnings": [
    {
      "content": "...",
      "category": "preference|convention|pattern|insight",
      "tags": ["tag1", "tag2"],
      "confidence": 0.6
    }
  ]
}
`

export async function extractFromCodebaseAnalysis(
  context: CodebaseAnalysisContext
): Promise<CodebaseAnalysisResult> {
  const result: CodebaseAnalysisResult = {
    memoriesStored: 0,
    memoriesDeduplicated: 0,
    learnings: [],
    errors: [],
    analysisType: context.analysisType,
  }

  const openai = getOpenAIClient()
  if (!openai) {
    result.errors.push('No OPENAI_API_KEY configured')
    return result
  }

  try {
    const fileSamplesText = context.fileSamples
      .map(f => `### ${f.path}\n\`\`\`\n${f.content.slice(0, 4500)}\n\`\`\``)
      .join('\n\n')

    const configFilesText = context.configFiles
      ? context.configFiles
          .map(f => `### ${f.path}\n\`\`\`\n${f.content.slice(0, 3000)}\n\`\`\``)
          .join('\n\n')
      : ''

    const prompt = CODEBASE_ANALYSIS_PROMPT
      .replace('{{analysisType}}', context.analysisType)
      .replace('{{#if configFiles}}', configFilesText ? '' : '<!--')
      .replace('{{/if}}', configFilesText ? '' : '-->')
      .replace('{{configFiles}}', configFilesText)
      .replace('{{fileSamples}}', fileSamplesText)

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    })

    const textContent = response.choices[0]?.message?.content
    if (!textContent) return result

    const jsonMatch = textContent.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return result

    const parsed = JSON.parse(jsonMatch[0])
    if (!parsed.learnings || !Array.isArray(parsed.learnings)) return result

    const learnings: ExtractedLearning[] = parsed.learnings
      .filter((l: unknown) => isValidLearning(l))
      .map((l: ExtractedLearning) => ({
        content: l.content.trim(),
        category: l.category as MemoryCategory,
        tags: Array.isArray(l.tags) ? l.tags.map((t: string) => String(t).toLowerCase().trim()) : [],
        confidence: Math.min(1, Math.max(0.5, Number(l.confidence) || 0.7)),
      }))
      .filter((l: ExtractedLearning) => passesQualityGate(l))

    result.learnings = learnings

    const sourceRef = `codebase-analysis:${context.analysisType}:${new Date().toISOString().split('T')[0]}`

    for (const learning of learnings) {
      try {
        const { deduplicated } = await storeWithDedup({
          content: learning.content,
          category: learning.category,
          tags: [...learning.tags, context.analysisType],
          sourceType: 'codebase_analysis',
          sourceTool: 'learning-extractor',
          sourceRef,
          sourceProject: getSourceProject(),
          confidence: learning.confidence,
        })

        if (deduplicated) {
          result.memoriesDeduplicated++
        } else {
          result.memoriesStored++
        }
      } catch (err) {
        result.errors.push(
          `Failed to store analysis learning: ${err instanceof Error ? err.message : 'Unknown error'}`
        )
      }
    }
  } catch (err) {
    result.errors.push(
      `Codebase analysis extraction failed: ${err instanceof Error ? err.message : 'Unknown error'}`
    )
  }

  return result
}

// ============================================================
// Voice Analysis Extraction
// ============================================================

export type VoiceAnalysisType =
  | 'user-facing'
  | 'business'
  | 'technical'
  | 'social'
  | 'brand'
  | 'full'

export interface VoiceAnalysisContext {
  analysisType: VoiceAnalysisType
  writingSamples: { label: string; content: string }[]
}

export interface VoiceAnalysisResult {
  memoriesStored: number
  memoriesDeduplicated: number
  learnings: ExtractedLearning[]
  errors: string[]
  analysisType: string
}

const VOICE_EXTRACTION_PROMPT = `You are analyzing writing samples to extract a developer/founder's communication voice and style patterns.

Analysis Type: {{analysisType}}

Writing Samples:
{{writingSamples}}

Extract the writer's voice traits, communication patterns, and style preferences. Focus on CHOICES — what they chose over alternatives, and how their voice shifts across audiences.

Extract 5-15 voice traits. Be exhaustive.

Categories to use:
- **preference**: Voice choices, tone decisions, structural preferences
- **convention**: Consistent patterns that should be replicated
- **pattern**: Reusable rhetorical structures
- **insight**: Non-obvious voice characteristics and their effect

For each learning, provide:
- content: A specific, actionable statement (1-2 sentences). Include exact phrases when possible.
- category: One of "preference", "convention", "pattern", "insight"
- tags: 2-4 relevant tags — always include "voice" and an audience tag like "audience:user-facing", etc.
- confidence: How confident (0.5-1.0)

Respond with JSON only:
{
  "learnings": [
    {
      "content": "...",
      "category": "preference|convention|pattern|insight",
      "tags": ["voice", "audience:user-facing", "tone"],
      "confidence": 0.6
    }
  ]
}
`

export async function extractVoiceTraits(
  context: VoiceAnalysisContext
): Promise<VoiceAnalysisResult> {
  const result: VoiceAnalysisResult = {
    memoriesStored: 0,
    memoriesDeduplicated: 0,
    learnings: [],
    errors: [],
    analysisType: context.analysisType,
  }

  const openai = getOpenAIClient()
  if (!openai) {
    result.errors.push('No OPENAI_API_KEY configured')
    return result
  }

  try {
    const samplesText = context.writingSamples
      .map(s => `### ${s.label}\n\`\`\`\n${s.content.slice(0, 4500)}\n\`\`\``)
      .join('\n\n')

    const prompt = VOICE_EXTRACTION_PROMPT
      .replace('{{analysisType}}', context.analysisType)
      .replace('{{writingSamples}}', samplesText)

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    })

    const textContent = response.choices[0]?.message?.content
    if (!textContent) return result

    const jsonMatch = textContent.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return result

    const parsed = JSON.parse(jsonMatch[0])
    if (!parsed.learnings || !Array.isArray(parsed.learnings)) return result

    const learnings: ExtractedLearning[] = parsed.learnings
      .filter((l: unknown) => isValidLearning(l))
      .map((l: ExtractedLearning) => ({
        content: l.content.trim(),
        category: l.category as MemoryCategory,
        tags: Array.isArray(l.tags) ? l.tags.map((t: string) => String(t).toLowerCase().trim()) : [],
        confidence: Math.min(1, Math.max(0.5, Number(l.confidence) || 0.7)),
      }))
      .filter((l: ExtractedLearning) => passesQualityGate(l))

    result.learnings = learnings

    const sourceRef = `voice-analysis:${context.analysisType}:${new Date().toISOString().split('T')[0]}`

    for (const learning of learnings) {
      try {
        const tags = learning.tags.includes('voice')
          ? learning.tags
          : ['voice', ...learning.tags]

        const { deduplicated } = await storeWithDedup({
          content: learning.content,
          category: learning.category,
          tags: [...tags, context.analysisType],
          sourceType: 'codebase_analysis',
          sourceTool: 'learning-extractor',
          sourceRef,
          sourceProject: getSourceProject(),
          confidence: learning.confidence,
        })

        if (deduplicated) {
          result.memoriesDeduplicated++
        } else {
          result.memoriesStored++
        }
      } catch (err) {
        result.errors.push(
          `Failed to store voice learning: ${err instanceof Error ? err.message : 'Unknown error'}`
        )
      }
    }
  } catch (err) {
    result.errors.push(
      `Voice analysis extraction failed: ${err instanceof Error ? err.message : 'Unknown error'}`
    )
  }

  return result
}

// ============================================================
// Formatting
// ============================================================

export function formatExtractionResult(result: ExtractionResult): string {
  if (result.memoriesStored === 0 && result.memoriesDeduplicated === 0 && result.errors.length === 0) {
    return 'No learnings extracted from this PR.'
  }

  const lines: string[] = []

  if (result.memoriesStored > 0 || result.memoriesDeduplicated > 0) {
    if (result.memoriesStored > 0 && result.memoriesDeduplicated > 0) {
      lines.push(`**${result.memoriesStored} new learnings stored (${result.memoriesDeduplicated} confirmed existing):**`)
    } else if (result.memoriesStored > 0) {
      lines.push(`**${result.memoriesStored} new learnings extracted and stored:**`)
    } else {
      lines.push(`**${result.memoriesDeduplicated} learnings confirmed (all matched existing knowledge)**`)
    }
    lines.push('')
    result.learnings.forEach((l, i) => {
      const emoji =
        l.category === 'gotcha'
          ? '|!|'
          : l.category === 'pattern'
          ? '->'
          : l.category === 'fix'
          ? '[+]'
          : '*'
      lines.push(`${i + 1}. ${emoji} **${l.category}**: ${l.content}`)
      lines.push(`   Tags: ${l.tags.map((t) => `\`${t}\``).join(' ')}`)
    })
  }

  if (result.errors.length > 0) {
    lines.push('')
    lines.push('**Errors:**')
    result.errors.forEach((e) => {
      lines.push(`- ${e}`)
    })
  }

  return lines.join('\n')
}
