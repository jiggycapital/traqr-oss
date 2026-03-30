/**
 * Quality Gate v2 — Domain-Agnostic Memory Validation
 *
 * Three-layer architecture:
 *   Layer 1: Universal rejection (42 banned phrase regexes)
 *   Layer 2: Universal specificity (16 domain-agnostic markers)
 *   Layer 3: Code-specific boost (6 additive code markers)
 *
 * Three gate modes:
 *   - Strict gate: LLM extraction pipeline (≥3 markers, ≥80 chars, confidence ≥0.85)
 *   - Ingestion gate: MCP tools / agent writes (≥2 markers, ≥30 chars)
 *   - Light gate: Life Import bulk (≥20 chars, banned phrases only)
 *
 * ADR: [[MCP Redesign — Quality Gate v2]]
 */

// ============================================================
// Layer 1: Banned Phrases — content matching any is rejected
// ============================================================

export const BANNED_PHRASES = [
  /\bbe careful\b/i,
  /\bremember to\b/i,
  /\balways make sure\b/i,
  /\bconsider /i,
  /\bthink about\b/i,
  /\bdon't forget\b/i,
  /\bpromoting\b.*\bseparation of concerns\b/i,
  /\bcleaner\b.*\barchitecture\b/i,
  /\bbest practice/i,
  /\bensur(?:es?|ing)\b.*\bmaintainab/i,
  /\bimportant to\b/i,
  /\bkeep in mind\b/i,
  /\bworth noting\b/i,
  /\bhelps with\b/i,
  /\bimproves?\b.*\breadability\b/i,
  /\b(demonstrates?|suggests?|indicates?)\s+a\s+preference\b/i,
  /\b(promoting|enhancing|improving)\s+(readability|maintainability)\b/i,
  /\bcognitive load\b/i,
  /\bindicating\b.*\b(value|preference|focus)\b/i,
  /\bhighlighting\b.*\b(importance|value|preference)\b/i,
  /\breflecting\b.*\b(design choice|preference|value)\b/i,
  /\bfacilitating\b.*\b(easier|better|improved)\b/i,
  /\b(this|the)\s+(approach|modification|update|change)\s+(aids?|revealed?)\b/i,
  /\binforms?\s+future\s+developers?\b/i,
  /\baids?\s+future\s+developers?\b/i,
  /\bsave\s+time\s+for\s+future\b/i,
]

// ============================================================
// Layer 2: Universal Specificity Markers (16 patterns)
// Fire on ANY domain — dev, health, finance, cooking, personal.
// ============================================================

export const UNIVERSAL_SPECIFICITY_MARKERS = [
  // Identity + judgment (existing, reclassified)
  /\bSean\b/,
  /\b(prefers?|prioritizes?|values?|avoids?|hates?|loves?)\b/i,
  /\b(decided|chose|picked|rejected|ruled out)\b/i,
  /\b(because|reason|rationale|motivation|why)\b/i,
  /\b(goal|vision|strategy|roadmap|north star)\b/i,

  // Quantitative + structural (existing, reclassified)
  /\b\d{2,}\b/,

  // NEW universal markers
  /\b(always|never|every time|mandatory)\b/i,
  /\b(instead of|rather than|not|unlike)\b/i,
  /\b(discovered|learned|realized|found out)\b/i,
  /\b(broke|failed|crashed|bug|error)\b/i,
  /"[^"]{3,}"/,
  /\b[A-Z]{2,}\b/,
  /\b(recipe|ingredient|medication|dosage|blood|allergy|diagnosis|symptom|weight|calories)\b/i,
  /\b(company|stock|portfolio|invest)\b/i,
  /\b(deadline|meeting|project|sprint)\b/i,
  /\w+\.\w+/,
]

// ============================================================
// Layer 3: Code-Specific Markers (6 patterns, additive boost)
// Only fire on content with code artifacts. Never required.
// ============================================================

export const CODE_SPECIFICITY_MARKERS = [
  /`[^`]+`/,
  /\.(ts|tsx|js|jsx|md|json|sql|sh|py|rs|go)/,
  /[A-Z][a-z]+[A-Z]/,
  /\b(src|lib|app|api|components|packages)\//,
  /\w+\([^)]*\)/,
  /\b(function|const|export|import|interface|type)\b/i,
]

// Backward-compatible union export
export const SPECIFICITY_MARKERS = [...UNIVERSAL_SPECIFICITY_MARKERS, ...CODE_SPECIFICITY_MARKERS]

// ============================================================
// Fluff Patterns — generic LLM-speak that adds no value
// ============================================================

export const FLUFF_PATTERNS = [
  /\b(promotes?|ensures?|improves?|enables?|facilitates?|leverages?)\b.*\b(cleaner|better|proper|good|robust|maintainable|scalable|readable|modular)\b/i,
  /\b(this|the)\s+(approach|pattern|modification|change|update)\b.*\b(helps?|allows?|supports?|shows? how)\b/i,
  /\badopt the pattern\b/i,
  /\b(demonstrates?|suggests?|indicates?|showcases?|illustrates?|highlights?|reveals?)\s+(a\s+)?(preference|value|focus|priority)\s+(for|on|in)\b/i,
  /\b(modular|scalable|maintainable|readable)\b.*\b(code|design|architecture)\b/i,
  /\b(separation of concerns|single responsibility|DRY principle)\b/i,
  /\b(enhancing|improving|promoting)\s+(readability|maintainability|scalability|reusability)\b/i,
  /\bthe\s+(drastic|extensive|deliberate|significant|major)\s+(reduction|insertion|removal|update|change)\b.*\b(indicates?|suggests?|shows?)\b/i,
  /\bensuring\s+(comprehensive|thorough|complete)\s+(testing|coverage|validation)\b/i,
  /\b(extensive|significant|large)\s+(insertion|addition|deletion|removal)\s+of\s+\d+/i,
]

// ============================================================
// Scoring
// ============================================================

function countSpecificityMarkers(content: string): number {
  const universal = UNIVERSAL_SPECIFICITY_MARKERS.filter(p => p.test(content)).length
  const code = CODE_SPECIFICITY_MARKERS.filter(p => p.test(content)).length
  return universal + code
}

// ============================================================
// Gate interfaces
// ============================================================

export interface QualityGateResult {
  passes: boolean
  reason?: string
}

interface LearningLike {
  content: string
  confidence: number
}

// ============================================================
// Strict Gate — LLM extraction pipeline
// ============================================================

export function passesQualityGate(learning: LearningLike): boolean {
  if (learning.confidence < 0.85) return false
  if (learning.content.length < 80) return false
  if (countSpecificityMarkers(learning.content) < 3) return false
  if (BANNED_PHRASES.some(r => r.test(learning.content))) return false
  if (FLUFF_PATTERNS.some(r => r.test(learning.content))) return false
  return true
}

// ============================================================
// Ingestion Gate — MCP tools, agent writes, pulse
// ============================================================

export function passesIngestionGate(content: string): QualityGateResult {
  if (content.length < 30) {
    return { passes: false, reason: 'Content too short (min 30 chars)' }
  }

  const hasBannedPhrase = BANNED_PHRASES.some(r => r.test(content))
  if (hasBannedPhrase) {
    return { passes: false, reason: 'Content contains generic/advisory phrasing' }
  }

  const hasFluff = FLUFF_PATTERNS.some(r => r.test(content))
  if (hasFluff) {
    return { passes: false, reason: 'Content is too generic — add specific details (file paths, function names, concrete decisions)' }
  }

  if (countSpecificityMarkers(content) < 2) {
    return { passes: false, reason: 'Content lacks specificity — include at least 2 of: file paths, function names, code refs, concrete decisions, or rationale' }
  }

  return { passes: true }
}

// ============================================================
// Light Gate — Life Import bulk ingestion
// ============================================================

export function passesLightGate(content: string): QualityGateResult {
  if (content.length < 20) {
    return { passes: false, reason: 'Content too short (min 20 chars)' }
  }

  const hasBannedPhrase = BANNED_PHRASES.some(r => r.test(content))
  if (hasBannedPhrase) {
    return { passes: false, reason: 'Content contains generic/advisory phrasing' }
  }

  return { passes: true }
}
