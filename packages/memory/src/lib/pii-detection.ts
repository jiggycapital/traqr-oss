/**
 * PII Detection Pipeline (TD-714)
 *
 * Scans memory content for personally identifiable information before storage.
 * Auto-classifies and flags memories containing PII.
 *
 * Part of Glasswing Red Alert security infrastructure.
 */

import type { MemoryClassification } from '../vectordb/types.js'

export interface PiiDetectionResult {
  containsPii: boolean
  piiTypes: string[]
  suggestedClassification: MemoryClassification
  redactedContent?: string // content with PII replaced by placeholders
}

// Regex patterns for structured PII
const PII_PATTERNS: Record<string, RegExp> = {
  // US phone numbers (various formats)
  phone: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  // Email addresses
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  // SSN (with or without dashes)
  ssn: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
  // Dollar amounts over $100
  financialAmount: /\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?\b|\$\d{3,}(?:\.\d{2})?\b/g,
  // Physical addresses (basic heuristic: number + street name + type)
  address: /\b\d{1,5}\s+(?:[A-Z][a-z]+\s+){1,3}(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Way|Pl|Place)\b/gi,
  // Credit card numbers (basic: 4 groups of 4 digits)
  creditCard: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
}

/**
 * Keyword lists are split into a published half and a private half (TD-1105).
 *
 * This file ships to a PUBLIC mirror. A hardcoded list of the topics one
 * operator keeps notes about is a description of that operator: the earlier
 * version of this array mixed narrow, personal health vocabulary in with the
 * generic terms, and read as somebody's medical profile rather than a
 * detector's category list. Naming those terms here to explain the fix would
 * republish them, so this comment does not.
 *
 * The built-ins below are generic categories any deployment wants flagged.
 * Operator-specific vocabulary goes in `MEMORY_RESTRICTED_KEYWORDS` /
 * `MEMORY_CONFIDENTIAL_KEYWORDS` (comma-separated) and is merged at runtime,
 * so private terms keep classifying without ever entering the repository.
 *
 * Deleting a private term rather than relocating it would have been the wrong
 * fix: these keywords are what force a memory to `restricted`, so dropping them
 * silently DOWNGRADES the classification of exactly the most sensitive
 * memories. Privacy work that removes a protection is not privacy work.
 */
const RESTRICTED_KEYWORDS_BUILTIN = [
  'medication', 'therapy', 'mental health', 'diagnosis',
  'salary', 'compensation', 'ssn', 'social security',
  'password', 'api key', 'secret key', 'private key',
] as const

const CONFIDENTIAL_KEYWORDS_BUILTIN = [
  'pipeline', 'revenue', 'pricing', 'client list',
  'discovery call', 'consulting fee',
] as const

function mergeKeywords(envVar: string, builtin: readonly string[]): string[] {
  const extra = (process.env[envVar] || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
  return [...builtin, ...extra]
}

// Resolved on first use, not at import. `detectPii` is called from a request
// handler, so by then dotenv has run; reading env at module scope would race
// the loader and silently drop every private term.
let restrictedKeywords: string[] | null = null
let confidentialKeywords: string[] | null = null

function getRestrictedKeywords(): string[] {
  restrictedKeywords ??= mergeKeywords('MEMORY_RESTRICTED_KEYWORDS', RESTRICTED_KEYWORDS_BUILTIN)
  return restrictedKeywords
}

function getConfidentialKeywords(): string[] {
  confidentialKeywords ??= mergeKeywords('MEMORY_CONFIDENTIAL_KEYWORDS', CONFIDENTIAL_KEYWORDS_BUILTIN)
  return confidentialKeywords
}

/** Test seam — drops the memoized lists so a test can vary the env. */
export function __resetKeywordCache(): void {
  restrictedKeywords = null
  confidentialKeywords = null
}

/**
 * Detect PII in memory content.
 * Returns detection result with types found and suggested classification.
 */
export function detectPii(content: string): PiiDetectionResult {
  const piiTypes: string[] = []
  let suggestedClassification: MemoryClassification = 'internal'

  // Check regex patterns
  for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
    // Reset lastIndex for global regex
    pattern.lastIndex = 0
    if (pattern.test(content)) {
      piiTypes.push(type)
    }
  }

  // Check restricted keywords
  const contentLower = content.toLowerCase()
  const hasRestricted = getRestrictedKeywords().some(kw => contentLower.includes(kw))
  const hasConfidential = getConfidentialKeywords().some(kw => contentLower.includes(kw))

  // Determine classification
  if (hasRestricted) {
    suggestedClassification = 'restricted'
  } else if (piiTypes.length > 0 || hasConfidential) {
    suggestedClassification = 'confidential'
  }

  return {
    containsPii: piiTypes.length > 0,
    piiTypes,
    suggestedClassification,
  }
}

/**
 * Redact high-sensitivity PII from text before it reaches the embedding
 * provider and lands in vector space (TD-856).
 *
 * Scope is deliberately the four "never searched by value" types — credit
 * card, SSN, phone, email — because:
 *  - they carry ~zero semantic search weight (you search by the surrounding
 *    context, not by the literal value), so redacting them costs ~nothing in
 *    recall; and
 *  - leaving them raw was a real EGRESS leak — the literal values were being
 *    sent to the embedding API and encoded into vector space.
 *
 * `financialAmount` and `address` are intentionally NOT redacted here: dollar
 * figures and street addresses are search-load-bearing for jiggy / life-CRM
 * memories, and redacting them would degrade recall. (`detectPii` still FLAGS
 * all six types for classification — this function governs only what reaches
 * the embedding vector.)
 *
 * Wired inside `generateEmbedding`, so store and query text redact through the
 * same path: a query containing an email embeds as `[EMAIL]` and still matches
 * a stored `[EMAIL]`, keeping recall consistent even for the looser phone/ssn
 * patterns. This does NOT touch the raw `content` column or the BM25 lexical
 * index — those stay plaintext (governed by classification tiers + TD-715
 * encryption); this is purely the vector-space / provider-egress layer.
 */
export function redactForEmbedding(content: string): string {
  let redacted = content

  // Order matters: consume a credit-card number before the ssn/phone patterns
  // can match a sub-run of its digits.
  redacted = redacted.replace(PII_PATTERNS.creditCard, '[CREDIT_CARD]')
  redacted = redacted.replace(PII_PATTERNS.ssn, '[SSN]')
  redacted = redacted.replace(PII_PATTERNS.phone, '[PHONE]')
  redacted = redacted.replace(PII_PATTERNS.email, '[EMAIL]')

  return redacted
}
