/**
 * Voice Profile Route (Portable)
 *
 * GET /voice-profile?audience=user-facing|business|technical|social
 * Aggregates voice-tagged memories into a structured voice profile.
 */

import { Hono } from 'hono'
import { searchMemories } from '../lib/memory.js'

const AUDIENCE_TYPES = ['user-facing', 'business', 'technical', 'social', 'brand'] as const
type AudienceType = typeof AUDIENCE_TYPES[number]

interface VoiceMemory {
  content: string
  confidence: number
  category: string
  tags: string[]
}

interface AudienceProfile {
  traits: VoiceMemory[]
  count: number
}

interface VoiceProfile {
  audiences: Partial<Record<AudienceType, AudienceProfile>>
  universal: VoiceMemory[]
  totalVoiceMemories: number
  promptContext: string
}

const app = new Hono()

app.get('/', async (c) => {
  try {
    const audienceFilter = c.req.query('audience') as AudienceType | null

    if (audienceFilter && !AUDIENCE_TYPES.includes(audienceFilter)) {
      return c.json(
        { success: false, error: `Invalid audience: ${audienceFilter}. Must be one of: ${AUDIENCE_TYPES.join(', ')}` },
        400
      )
    }

    const queries = [
      'voice writing style tone',
      'voice communication pattern',
      'voice signature phrase sign-off',
      'voice audience adaptation',
      'voice vocabulary emoji',
    ]

    const allMemories = new Map<string, VoiceMemory & { id: string }>()

    for (const query of queries) {
      const results = await searchMemories(query, {
        limit: 30,
        tags: ['voice'],
        similarityThreshold: 0.2,
      })

      for (const r of results) {
        if (!allMemories.has(r.id)) {
          allMemories.set(r.id, {
            id: r.id,
            content: r.content,
            confidence: r.relevanceScore,
            category: r.category || 'preference',
            tags: r.tags || [],
          })
        }
      }
    }

    const memories = Array.from(allMemories.values())

    const profile: VoiceProfile = {
      audiences: {},
      universal: [],
      totalVoiceMemories: memories.length,
      promptContext: '',
    }

    for (const memory of memories) {
      let matched = false

      for (const audience of AUDIENCE_TYPES) {
        const hasAudienceTag = memory.tags.some(t =>
          t === `audience:${audience}` ||
          t === audience ||
          t === audience.replace('-', '_')
        )

        if (hasAudienceTag) {
          if (audienceFilter && audience !== audienceFilter) continue

          if (!profile.audiences[audience]) {
            profile.audiences[audience] = { traits: [], count: 0 }
          }
          profile.audiences[audience]!.traits.push({
            content: memory.content,
            confidence: memory.confidence,
            category: memory.category,
            tags: memory.tags,
          })
          profile.audiences[audience]!.count++
          matched = true
        }
      }

      if (!matched && !audienceFilter) {
        profile.universal.push({
          content: memory.content,
          confidence: memory.confidence,
          category: memory.category,
          tags: memory.tags,
        })
      }
    }

    for (const audience of AUDIENCE_TYPES) {
      if (profile.audiences[audience]) {
        profile.audiences[audience]!.traits.sort((a, b) => b.confidence - a.confidence)
      }
    }
    profile.universal.sort((a, b) => b.confidence - a.confidence)

    profile.promptContext = buildPromptContext(profile, audienceFilter)

    return c.json({ success: true, ...profile })
  } catch (error) {
    console.error('[Voice Profile] Error:', error)
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error building voice profile' },
      500
    )
  }
})

function buildPromptContext(
  profile: VoiceProfile,
  audienceFilter: AudienceType | null
): string {
  const lines: string[] = []

  lines.push('=== VOICE PROFILE ===')
  lines.push('')

  if (profile.totalVoiceMemories === 0) {
    lines.push('No voice profile data available. Run /voice to analyze writing samples first.')
    return lines.join('\n')
  }

  for (const audience of AUDIENCE_TYPES) {
    const section = profile.audiences[audience]
    if (!section || section.traits.length === 0) continue

    lines.push(`## ${audience.toUpperCase()} Voice`)
    for (const trait of section.traits) {
      lines.push(`- ${trait.content}`)
    }
    lines.push('')
  }

  if (profile.universal.length > 0 && !audienceFilter) {
    lines.push('## UNIVERSAL Traits (across all audiences)')
    for (const trait of profile.universal) {
      lines.push(`- ${trait.content}`)
    }
    lines.push('')
  }

  lines.push('=== END VOICE PROFILE ===')

  return lines.join('\n')
}

export default app
