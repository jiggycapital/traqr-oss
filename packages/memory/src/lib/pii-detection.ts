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

// Sensitive topic keywords that suggest restricted classification
const RESTRICTED_KEYWORDS = [
  'psychoanalysis', 'addictive personality', 'medication',
  'therapy', 'mental health', 'diagnosis',
  'salary', 'compensation', 'ssn', 'social security',
  'password', 'api key', 'secret key', 'private key',
]

// Confidential topic keywords
const CONFIDENTIAL_KEYWORDS = [
  'pipeline', 'revenue', 'pricing', 'client list',
  'inherited opps', 'discovery call', 'consulting fee',
  'trust tier', 'foxhole',
]

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
  const hasRestricted = RESTRICTED_KEYWORDS.some(kw => contentLower.includes(kw))
  const hasConfidential = CONFIDENTIAL_KEYWORDS.some(kw => contentLower.includes(kw))

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
 * Generate a redacted version of content for embedding generation.
 * PII is replaced with type-specific placeholders so semantic meaning is preserved
 * but actual values are not embedded in vector space.
 */
export function redactForEmbedding(content: string): string {
  let redacted = content

  // Replace in order of specificity (more specific patterns first)
  redacted = redacted.replace(PII_PATTERNS.creditCard, '[CREDIT_CARD]')
  redacted = redacted.replace(PII_PATTERNS.ssn, '[SSN]')
  redacted = redacted.replace(PII_PATTERNS.phone, '[PHONE]')
  redacted = redacted.replace(PII_PATTERNS.email, '[EMAIL]')
  redacted = redacted.replace(PII_PATTERNS.financialAmount, '[AMOUNT]')
  redacted = redacted.replace(PII_PATTERNS.address, '[ADDRESS]')

  return redacted
}
