#!/usr/bin/env node
/**
 * @traqr/core — E2E Test: Upgrade Path Verification
 *
 * Exercises the progressive tier upgrade path:
 *   Solo → Smart → Production → Full
 *
 * At each step: deepMerge with next tier defaults, recalculate score,
 * renderAllTemplates, and validate output.
 *
 * Usage: node dist/e2e-upgrade-path.js [--json]
 */

import {
  formatE2EOutput,
  buildProjectConfig,
  type TestCheck,
  type SuiteResult,
  type E2ERunResult,
} from './e2e-shared.js'
import { deepMerge } from './config-resolver.js'
import { STARTER_PACK_DEFAULTS, calculateAutomationScore } from './config-schema.js'
import type { TraqrConfig } from './config-schema.js'
import { renderAllTemplates } from './template-loader.js'
import { getFeatureFlags } from './template-engine.js'

// ============================================================
// Test Data
// ============================================================

function buildSoloBaseline(): TraqrConfig {
  return buildProjectConfig({
    name: 'upgradetest',
    displayName: 'Upgrade Test',
    description: 'Upgrade path test project',
    prefix: 'ut',
    aliasPrefix: 'ut',
    kvPrefix: 'upgradetest',
    pack: 'solo',
    ports: { main: 3000, featureStart: 3001, bugfixStart: 3011, devopsStart: 3021, analysis: 3099 },
  })
}

function upgradeTier(
  current: TraqrConfig,
  targetPack: 'smart' | 'production' | 'full',
): TraqrConfig {
  const defaults = STARTER_PACK_DEFAULTS[targetPack]
  const merged = deepMerge(current, defaults as Partial<TraqrConfig>)
  merged.tier = defaults.tier as TraqrConfig['tier']
  merged.starterPack = targetPack
  merged.automationScore = calculateAutomationScore(merged)
  return merged
}

// ============================================================
// Suite 1: Solo Baseline
// ============================================================

async function suiteSoloBaseline(config: TraqrConfig): Promise<SuiteResult & { fileCount: number; score: number }> {
  const results: TestCheck[] = []
  let checks = 0

  // Render
  const renderResult = await renderAllTemplates(config)
  const fileCount = Object.keys(renderResult.files).length

  checks++
  results.push({
    name: 'renderSucceeds',
    passed: fileCount > 0,
    details: `${fileCount} files rendered`,
    checks: 1,
  })

  // No slack/memory-tier commands at Solo level
  const forbiddenFiles = ['commands/slack.md', 'commands/analyze.md']
  const presentForbidden = forbiddenFiles.filter(f =>
    Object.keys(renderResult.files).some(k => k.endsWith(f))
  )
  checks++
  results.push({
    name: 'noAdvancedCommands',
    passed: presentForbidden.length === 0,
    details: presentForbidden.length === 0
      ? 'no slack/memory-tier commands (correct for Solo)'
      : `FOUND: ${presentForbidden.join(', ')}`,
    checks: 1,
  })

  // Score in [0, 20]
  const score = config.automationScore ?? calculateAutomationScore(config)
  checks++
  results.push({
    name: 'scoreRange',
    passed: score >= 0 && score <= 20,
    details: `score=${score} (expected 0-20)`,
    checks: 1,
  })

  // Flags
  const flags = getFeatureFlags(config)
  const flagChecks = [
    { flag: 'SLACK', expected: false },
    { flag: 'MEMORY', expected: false },
    { flag: 'LINEAR', expected: false },
  ]
  const flagMismatches: string[] = []
  for (const { flag, expected } of flagChecks) {
    checks++
    if (flags[flag] !== expected) {
      flagMismatches.push(`${flag}=${flags[flag]} (expected ${expected})`)
    }
  }
  results.push({
    name: 'soloFlags',
    passed: flagMismatches.length === 0,
    details: flagMismatches.length === 0
      ? 'SLACK=false, MEMORY=false, LINEAR=false'
      : `MISMATCHES: ${flagMismatches.join(', ')}`,
    checks: flagChecks.length,
  })

  return {
    suite: '1. Solo Baseline',
    passed: results.every(r => r.passed),
    results,
    totalChecks: checks,
    fileCount,
    score,
  }
}

// ============================================================
// Suite 2: Solo → Smart
// ============================================================

async function suiteSoloToSmart(
  config: TraqrConfig,
  soloFileCount: number,
  soloScore: number,
  originalName: string,
): Promise<SuiteResult & { fileCount: number; score: number }> {
  const results: TestCheck[] = []
  let checks = 0

  // Verify deepMerge preserved project.name
  checks++
  results.push({
    name: 'projectNamePreserved',
    passed: config.project.name === originalName,
    details: `project.name="${config.project.name}" (expected "${originalName}")`,
    checks: 1,
  })

  // Tier
  checks++
  results.push({
    name: 'tier',
    passed: config.tier === 2,
    details: `tier=${config.tier}`,
    checks: 1,
  })

  // Render
  const renderResult = await renderAllTemplates(config)
  const fileCount = Object.keys(renderResult.files).length

  // Memory-tier commands appear
  const memoryFiles = ['commands/analyze.md']
  const hasMemory = memoryFiles.some(f =>
    Object.keys(renderResult.files).some(k => k.endsWith(f))
  )
  checks++
  results.push({
    name: 'memoryCommandsAppear',
    passed: hasMemory,
    details: hasMemory ? 'memory-tier commands present' : 'MISSING memory-tier commands',
    checks: 1,
  })

  // File count increases
  checks++
  results.push({
    name: 'fileCountIncreases',
    passed: fileCount > soloFileCount,
    details: `${fileCount} files (Solo had ${soloFileCount})`,
    checks: 1,
  })

  // Slack still absent
  const hasSlack = Object.keys(renderResult.files).some(k => k.endsWith('commands/slack.md'))
  checks++
  results.push({
    name: 'slackStillAbsent',
    passed: !hasSlack,
    details: hasSlack ? 'FOUND slack.md (should be absent at Smart tier)' : 'slack correctly absent',
    checks: 1,
  })

  // Score increases
  const score = config.automationScore ?? calculateAutomationScore(config)
  checks++
  results.push({
    name: 'scoreIncreases',
    passed: score > soloScore,
    details: `score=${score} (Solo was ${soloScore})`,
    checks: 1,
  })

  return {
    suite: '2. Solo → Smart',
    passed: results.every(r => r.passed),
    results,
    totalChecks: checks,
    fileCount,
    score,
  }
}

// ============================================================
// Suite 3: Smart → Production
// ============================================================

async function suiteSmartToProduction(
  config: TraqrConfig,
  smartFileCount: number,
  smartScore: number,
): Promise<SuiteResult & { fileCount: number; score: number }> {
  const results: TestCheck[] = []
  let checks = 0

  // Tier
  checks++
  results.push({
    name: 'tier',
    passed: config.tier === 3,
    details: `tier=${config.tier}`,
    checks: 1,
  })

  // Render
  const renderResult = await renderAllTemplates(config)
  const fileCount = Object.keys(renderResult.files).length

  // Slack + inbox + dispatch appear
  const slackPresent = Object.keys(renderResult.files).some(k => k.endsWith('commands/slack.md'))
  checks++
  results.push({
    name: 'slackAppears',
    passed: slackPresent,
    details: slackPresent ? 'slack.md present' : 'MISSING slack.md',
    checks: 1,
  })

  // Memory-tier commands still present
  const memoryPresent = Object.keys(renderResult.files).some(k => k.endsWith('commands/analyze.md'))
  checks++
  results.push({
    name: 'memoryStillPresent',
    passed: memoryPresent,
    details: memoryPresent ? 'memory-tier commands still present' : 'MISSING memory-tier commands',
    checks: 1,
  })

  // File count increases
  checks++
  results.push({
    name: 'fileCountIncreases',
    passed: fileCount > smartFileCount,
    details: `${fileCount} files (Smart had ${smartFileCount})`,
    checks: 1,
  })

  // Issues provider = linear
  const hasLinear = config.issues?.provider === 'linear'
  checks++
  results.push({
    name: 'linearProvider',
    passed: hasLinear,
    details: `issues.provider="${config.issues?.provider}"`,
    checks: 1,
  })

  // Score increases
  const score = config.automationScore ?? calculateAutomationScore(config)
  checks++
  results.push({
    name: 'scoreIncreases',
    passed: score > smartScore,
    details: `score=${score} (Smart was ${smartScore})`,
    checks: 1,
  })

  return {
    suite: '3. Smart → Production',
    passed: results.every(r => r.passed),
    results,
    totalChecks: checks,
    fileCount,
    score,
  }
}

// ============================================================
// Suite 4: Production → Full
// ============================================================

async function suiteProductionToFull(
  config: TraqrConfig,
  prodFileCount: number,
  prodScore: number,
): Promise<SuiteResult & { fileCount: number; score: number }> {
  const results: TestCheck[] = []
  let checks = 0

  // Tier
  checks++
  results.push({
    name: 'tier',
    passed: config.tier === 4,
    details: `tier=${config.tier}`,
    checks: 1,
  })

  // Render
  const renderResult = await renderAllTemplates(config)
  const fileCount = Object.keys(renderResult.files).length

  // Analytics/cron/email commands appear
  const analyticsPresent = Object.keys(renderResult.files).some(k => k.endsWith('commands/analytics.md'))
  const emailPresent = Object.keys(renderResult.files).some(k => k.endsWith('commands/email.md'))
  checks++
  results.push({
    name: 'fullTierCommands',
    passed: analyticsPresent && emailPresent,
    details: `analytics=${analyticsPresent}, email=${emailPresent}`,
    checks: 1,
  })

  // Guardian enabled
  const guardianEnabled = config.guardian?.enabled === true
  checks++
  results.push({
    name: 'guardianEnabled',
    passed: guardianEnabled,
    details: `guardian.enabled=${config.guardian?.enabled}`,
    checks: 1,
  })

  // File count highest
  checks++
  results.push({
    name: 'fileCountHighest',
    passed: fileCount >= prodFileCount,
    details: `${fileCount} files (Production had ${prodFileCount})`,
    checks: 1,
  })

  // Score highest
  const score = config.automationScore ?? calculateAutomationScore(config)
  checks++
  results.push({
    name: 'scoreHighest',
    passed: score >= prodScore,
    details: `score=${score} (Production was ${prodScore})`,
    checks: 1,
  })

  return {
    suite: '4. Production → Full',
    passed: results.every(r => r.passed),
    results,
    totalChecks: checks,
    fileCount,
    score,
  }
}

// ============================================================
// Suite 5: Config Merge Integrity
// ============================================================

async function suiteConfigMergeIntegrity(): Promise<SuiteResult> {
  const results: TestCheck[] = []
  let checks = 0

  // Build Solo with custom fields
  const customSolo = buildProjectConfig({
    name: 'mergetest',
    displayName: 'Merge Test',
    description: 'CUSTOM',
    prefix: 'mt',
    aliasPrefix: 'mt',
    kvPrefix: 'custom-kv',
    pack: 'solo',
    ports: { main: 3000, featureStart: 3001, bugfixStart: 3011, devopsStart: 3021, analysis: 3099 },
  })
  customSolo.coAuthor = 'Custom Author'

  // Run all 3 upgrades
  let current = customSolo
  current = upgradeTier(current, 'smart')
  current = upgradeTier(current, 'production')
  current = upgradeTier(current, 'full')

  // Custom fields survive
  checks++
  results.push({
    name: 'descriptionSurvives',
    passed: current.project.description === 'CUSTOM',
    details: `project.description="${current.project.description}"`,
    checks: 1,
  })

  checks++
  results.push({
    name: 'coAuthorSurvives',
    passed: current.coAuthor === 'Custom Author',
    details: `coAuthor="${current.coAuthor}"`,
    checks: 1,
  })

  checks++
  results.push({
    name: 'kvPrefixSurvives',
    passed: current.kvPrefix === 'custom-kv',
    details: `kvPrefix="${current.kvPrefix}"`,
    checks: 1,
  })

  // Rendered CLAUDE.md contains custom description
  const renderResult = await renderAllTemplates(current)
  const claudeMd = Object.entries(renderResult.files).find(([k]) => k.endsWith('CLAUDE.md'))?.[1] || ''
  const hasCustomDesc = claudeMd.includes('CUSTOM') || claudeMd.includes('Merge Test')
  checks++
  results.push({
    name: 'renderedContainsCustom',
    passed: hasCustomDesc,
    details: hasCustomDesc
      ? 'rendered CLAUDE.md contains custom project info'
      : 'MISSING custom description in rendered CLAUDE.md',
    checks: 1,
  })

  return {
    suite: '5. Config Merge Integrity',
    passed: results.every(r => r.passed),
    results,
    totalChecks: checks,
  }
}

// ============================================================
// Suite 6: Score Progression
// ============================================================

function suiteScoreProgression(
  soloScore: number,
  smartScore: number,
  prodScore: number,
  fullScore: number,
): SuiteResult {
  const results: TestCheck[] = []
  let checks = 0

  // Monotonically increasing
  const monotonic = soloScore < smartScore && smartScore < prodScore && prodScore <= fullScore
  checks++
  results.push({
    name: 'monotonicallyIncreasing',
    passed: monotonic,
    details: `solo=${soloScore} < smart=${smartScore} < prod=${prodScore} <= full=${fullScore}`,
    checks: 1,
  })

  // Each within tier-appropriate range
  const ranges: Array<{ name: string; score: number; min: number; max: number }> = [
    { name: 'solo', score: soloScore, min: 0, max: 25 },
    { name: 'smart', score: smartScore, min: 15, max: 55 },
    { name: 'production', score: prodScore, min: 40, max: 85 },
    { name: 'full', score: fullScore, min: 65, max: 100 },
  ]

  for (const r of ranges) {
    const inRange = r.score >= r.min && r.score <= r.max
    checks++
    results.push({
      name: `${r.name}Range`,
      passed: inRange,
      details: `${r.name}=${r.score} (expected ${r.min}-${r.max})`,
      checks: 1,
    })
  }

  return {
    suite: '6. Score Progression',
    passed: results.every(r => r.passed),
    results,
    totalChecks: checks,
  }
}

// ============================================================
// Runner
// ============================================================

export async function runSuites(): Promise<E2ERunResult> {
  const suites: SuiteResult[] = []

  // Build configs through upgrade path
  const soloConfig = buildSoloBaseline()
  const smartConfig = upgradeTier(soloConfig, 'smart')
  const prodConfig = upgradeTier(smartConfig, 'production')
  const fullConfig = upgradeTier(prodConfig, 'full')

  // Suite 1: Solo Baseline
  const soloResult = await suiteSoloBaseline(soloConfig)
  suites.push(soloResult)

  // Suite 2: Solo → Smart
  const smartResult = await suiteSoloToSmart(
    smartConfig, soloResult.fileCount, soloResult.score, soloConfig.project.name,
  )
  suites.push(smartResult)

  // Suite 3: Smart → Production
  const prodResult = await suiteSmartToProduction(
    prodConfig, smartResult.fileCount, smartResult.score,
  )
  suites.push(prodResult)

  // Suite 4: Production → Full
  const fullResult = await suiteProductionToFull(
    fullConfig, prodResult.fileCount, prodResult.score,
  )
  suites.push(fullResult)

  // Suite 5: Config Merge Integrity
  suites.push(await suiteConfigMergeIntegrity())

  // Suite 6: Score Progression
  suites.push(suiteScoreProgression(
    soloResult.score, smartResult.score, prodResult.score, fullResult.score,
  ))

  const totalSuites = suites.length
  const passedSuites = suites.filter(s => s.passed).length
  const totalChecks = suites.reduce((sum, s) => sum + s.totalChecks, 0)
  const passedChecks = suites.reduce((sum, s) =>
    sum + s.results.reduce((rSum, r) => rSum + (r.passed ? r.checks : 0), 0), 0)

  return {
    name: 'E2E: Upgrade Path',
    description: '6 suites — Solo→Smart→Production→Full + merge integrity',
    suites,
    totalSuites,
    passedSuites,
    totalChecks,
    passedChecks,
    passed: passedSuites === totalSuites,
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  try {
    const result = await runSuites()
    console.log(formatE2EOutput(result))

    if (process.argv.includes('--json')) {
      console.log('\n---JSON---')
      console.log(JSON.stringify(result, null, 2))
    }

    process.exit(result.passed ? 0 : 1)
  } catch (err) {
    console.error('╭─────────────────────────────────────────────────────────────╮')
    console.error('│      /\\___/\\                                                │')
    console.error('│     (T   T)   E2E Upgrade Path harness crashed!            │')
    console.error('│     (  =^=  )   See error below.                           │')
    console.error('│      (______)                                               │')
    console.error('╰─────────────────────────────────────────────────────────────╯')
    console.error('')
    console.error((err as Error).message)
    console.error((err as Error).stack)
    process.exit(2)
  }
}

// Run if executed directly
const isDirectRun = process.argv[1]?.endsWith('e2e-upgrade-path.js')
  || process.argv[1]?.endsWith('e2e-upgrade-path.ts')
if (isDirectRun) {
  main()
}
