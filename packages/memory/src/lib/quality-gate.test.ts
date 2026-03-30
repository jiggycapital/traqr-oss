/**
 * Quality Gate v2 — Verification Script
 *
 * Tests MUST PASS and MUST FAIL cases from [[MCP Redesign -- Quality Gate v2]] ADR.
 * Run: npx ts-node packages/memory/src/lib/quality-gate.test.ts
 */

import { passesIngestionGate, passesLightGate, passesQualityGate } from './quality-gate.js'

let passed = 0
let failed = 0

function assert(label: string, actual: boolean, expected: boolean) {
  if (actual === expected) {
    console.log(`  PASS  ${label}`)
    passed++
  } else {
    console.log(`  FAIL  ${label} (got ${actual}, expected ${expected})`)
    failed++
  }
}

// ============================================================
// Ingestion Gate — MUST PASS
// ============================================================
console.log('\n--- Ingestion Gate: MUST PASS ---')

assert(
  'Personal health: "Sean\'s blood type is O+ and he discovered this at age 28"',
  passesIngestionGate("Sean's blood type is O+ and he discovered this at age 28").passes,
  true
)

assert(
  'Work fact with numbers: "The deadline for Q2 sprint is March 30"',
  passesIngestionGate('The deadline for Q2 sprint is March 30').passes,
  true
)

assert(
  'Health discovery: "Discovered that BMI above 25 increases risk"',
  passesIngestionGate('Discovered that BMI above 25 increases risk').passes,
  true
)

assert(
  'API error: "The API returns 429 when rate-limited"',
  passesIngestionGate('The API returns 429 when rate-limited').passes,
  true
)

assert(
  'Finance decision: "Sean decided to invest in AAPL instead of GOOG"',
  passesIngestionGate('Sean decided to invest in AAPL instead of GOOG').passes,
  true
)

assert(
  'Finance numbers: "Portfolio target is 60% stocks, 40% bonds"',
  passesIngestionGate('Portfolio target is 60% stocks, 40% bonds').passes,
  true
)

assert(
  'Dev content still passes: "The `searchMemories` function in src/lib/memory.ts handles vector search"',
  passesIngestionGate('The `searchMemories` function in src/lib/memory.ts handles vector search').passes,
  true
)

assert(
  'Preference with reasoning: "Sean prefers TypeScript because it catches errors at compile time"',
  passesIngestionGate('Sean prefers TypeScript because it catches errors at compile time').passes,
  true
)

// ============================================================
// Ingestion Gate — MUST FAIL
// ============================================================
console.log('\n--- Ingestion Gate: MUST FAIL ---')

assert(
  'Banned: "Remember to always be careful"',
  passesIngestionGate('Remember to always be careful').passes,
  false
)

assert(
  'Banned: "This is a best practice for clean code"',
  passesIngestionGate('This is a best practice for clean code').passes,
  false
)

assert(
  'Too short: "ok"',
  passesIngestionGate('ok').passes,
  false
)

assert(
  'No markers: "I did some stuff today and it was interesting overall"',
  passesIngestionGate('I did some stuff today and it was interesting overall').passes,
  false
)

assert(
  'Fluff: "The approach demonstrates a preference for clean architecture"',
  passesIngestionGate('The approach demonstrates a preference for clean architecture').passes,
  false
)

// ============================================================
// Light Gate — MUST PASS
// ============================================================
console.log('\n--- Light Gate: MUST PASS ---')

assert(
  'Casual content: "I had pasta for dinner last night"',
  passesLightGate('I had pasta for dinner last night').passes,
  true
)

assert(
  'Short but valid: "This is a valid memory entry"',
  passesLightGate('This is a valid memory entry').passes,
  true
)

// ============================================================
// Light Gate — MUST FAIL
// ============================================================
console.log('\n--- Light Gate: MUST FAIL ---')

assert(
  'Too short: "hi"',
  passesLightGate('hi').passes,
  false
)

assert(
  'Banned phrase: "Remember to always be careful with authentication"',
  passesLightGate('Remember to always be careful with authentication').passes,
  false
)

// ============================================================
// Strict Gate — spot checks
// ============================================================
console.log('\n--- Strict Gate: spot checks ---')

assert(
  'High confidence dev content passes strict',
  passesQualityGate({
    content: 'The `searchMemories` function in packages/memory/src/lib/memory.ts uses a cosine similarity threshold of 0.35 because lower values return too much noise',
    confidence: 0.9
  }),
  true
)

assert(
  'Low confidence rejected',
  passesQualityGate({ content: 'Some important learning about code', confidence: 0.5 }),
  false
)

assert(
  'Short content rejected',
  passesQualityGate({ content: 'Short', confidence: 0.9 }),
  false
)

// ============================================================
// Summary
// ============================================================
console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('QUALITY GATE TESTS FAILED')
  process.exit(1)
} else {
  console.log('All quality gate tests passed!')
}
