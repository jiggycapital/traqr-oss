/**
 * LLM Borderline Decision Module
 *
 * When cosine triage hits Zone 3 (0.60-0.90 similarity),
 * this module uses GPT-4o-mini to decide: ADD, UPDATE, or NOOP.
 * UUID masking prevents the LLM from hallucinating memory IDs.
 *
 * Fallback: if LLM fails for ANY reason, caller uses I-M6 heuristic.
 */

import OpenAI from 'openai'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The single source of truth for borderline actions.
 *
 * TD-1334: this used to be three hand-maintained lists — the type union, the
 * response-schema enum, and the runtime validator's allowlist. #1223 added
 * 'correct' to the first two and missed the third, so for 150 days a valid
 * CORRECT verdict was rejected as a malformed response. Deriving all three
 * from one array makes that class of drift unrepresentable.
 */
export const BORDERLINE_ACTIONS = ['add', 'update', 'correct', 'noop'] as const

export type BorderlineAction = (typeof BORDERLINE_ACTIONS)[number]

export interface BorderlineDecision {
  action: BorderlineAction
  target?: string       // masked label (e.g., 'MEMORY_A') — caller maps back to real ID
  edgeType: 'updates' | 'extends' | 'related' | null
  reasoning: string
}

export interface MaskedMemory {
  label: string         // MEMORY_A, MEMORY_B, etc.
  content: string
  memoryType?: string
}

// ---------------------------------------------------------------------------
// OpenAI Client (singleton, same pattern as embeddings.ts)
// ---------------------------------------------------------------------------

let client: OpenAI | null = null

function getClient(): OpenAI {
  if (client) return client
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error(
    'OPENAI_API_KEY not set. Borderline decisions use GPT-4o-mini to classify memories ' +
    'near the cosine similarity threshold. Without it, the system falls back to heuristic ' +
    'scoring (still works, slightly less accurate). Set OPENAI_API_KEY to enable LLM triage.'
  )
  client = new OpenAI({ apiKey })
  return client
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const LABELS = ['MEMORY_A', 'MEMORY_B', 'MEMORY_C']

export function buildPrompt(newContent: string, existing: MaskedMemory[], memoryType: string): string {
  const typeGuidance = {
    fact: 'Facts have one truth. If the new memory contradicts an existing fact, UPDATE.',
    preference: 'Preferences change over time. If the new memory expresses a different preference on the same topic, UPDATE.',
    pattern: 'Patterns compound. Usually ADD alongside existing. Only UPDATE if directly contradicted.',
  }[memoryType] || 'Use your best judgment based on content overlap and contradiction.'

  const existingBlock = existing
    .map((m) => `${m.label}: ${m.content}`)
    .join('\n\n')

  return `You are a memory deduplication classifier for a personal knowledge system.

Given a NEW memory and EXISTING similar memories, decide:
- ADD: genuinely new information that should be stored alongside existing memories
- UPDATE: new memory supersedes an existing memory — the old one should be replaced (evolution, not contradiction)
- CORRECT: new memory CONTRADICTS an existing memory — the old one was WRONG and should be archived as incorrect. Use when the new content explicitly reverses, corrects, or debunks what was previously stored.
- NOOP: existing memory already covers this content — skip storing the new one

Memory type: ${memoryType.toUpperCase()}
${typeGuidance}

NEW MEMORY:
${newContent}

EXISTING MEMORIES:
${existingBlock}

Respond with JSON only.`
}

// ---------------------------------------------------------------------------
// JSON Schema for structured output
// ---------------------------------------------------------------------------

export const RESPONSE_SCHEMA = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'borderline_decision',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: [...BORDERLINE_ACTIONS] },
        target: { type: ['string', 'null'], description: 'Label of the existing memory to update (e.g., MEMORY_A). Null for add/noop.' },
        reasoning: { type: 'string', description: 'Brief explanation of the decision.' },
      },
      required: ['action', 'target', 'reasoning'],
      additionalProperties: false,
    },
  },
}

// ---------------------------------------------------------------------------
// Core Decision Function
// ---------------------------------------------------------------------------

/**
 * Turn a parsed LLM response into a decision, or null if it is unusable.
 *
 * Split out of `borderlineDecision` so these rules are reachable by a test
 * without an OpenAI round-trip — the TD-1334 defect lived here and survived
 * 150 days precisely because the only way to exercise it was over the network.
 *
 * Returning null means "the LLM did not answer", and the caller then falls back
 * to a length heuristic that has NOT read the two texts against each other. So
 * rejecting a VALID verdict here is not a neutral degradation: it is how a
 * correction ends up scored on which text is longer.
 */
export function interpretBorderlineResponse(parsed: any): BorderlineDecision | null {
  if (!parsed || typeof parsed !== 'object') return null

  if (!(BORDERLINE_ACTIONS as readonly string[]).includes(parsed.action)) return null

  const target =
    typeof parsed.target === 'string' && parsed.target ? parsed.target : undefined

  // Validate the target label for every action that acts ON an existing memory.
  // 'correct' belongs here because it ARCHIVES that target — an unrecognised
  // label would otherwise silently resolve to the nearest neighbour upstream.
  if ((parsed.action === 'update' || parsed.action === 'correct') && target) {
    if (!LABELS.includes(target)) return null
  }

  // A CORRECT naming no target would archive the nearest neighbour on a guess.
  // Degrade to ADD instead: storing alongside is never data loss.
  const action: BorderlineAction =
    parsed.action === 'correct' && !target ? 'add' : parsed.action

  const edgeType: BorderlineDecision['edgeType'] =
    action === 'update' || action === 'correct' ? 'updates' :
    action === 'add' ? 'related' :
    null

  return {
    action,
    target,
    edgeType,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
  }
}

/**
 * Ask GPT-4o-mini to classify a borderline memory.
 * Returns null on any failure — caller should fall back to heuristic.
 */
export async function borderlineDecision(
  newContent: string,
  existingMemories: MaskedMemory[],
  memoryType: string,
): Promise<BorderlineDecision | null> {
  try {
    const openai = getClient()
    const prompt = buildPrompt(newContent, existingMemories.slice(0, 3), memoryType)

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: RESPONSE_SCHEMA,
      temperature: 0,
      max_tokens: 200,
    })

    const content = response.choices[0]?.message?.content
    if (!content) return null

    return interpretBorderlineResponse(JSON.parse(content))
  } catch (err) {
    console.warn('[borderline] LLM decision failed, falling back to heuristic:', err instanceof Error ? err.message : err)
    return null
  }
}
