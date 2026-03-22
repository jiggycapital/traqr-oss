#!/usr/bin/env node
/**
 * @traqr/core — E2E Runner
 *
 * Unified runner for both E2E harnesses:
 *   1. Two-Phase + Multi-Project (e2e-two-phase.ts)
 *   2. Upgrade Path Verification (e2e-upgrade-path.ts)
 *
 * Usage:
 *   node dist/e2e-runner.js          # Structured text output
 *   node dist/e2e-runner.js --json   # JSON output
 *
 * Exit codes: 0 = all pass, 1 = any fail, 2 = crash
 */

import { runSuites as runTwoPhase } from './e2e-two-phase.js'
import { runSuites as runUpgradePath } from './e2e-upgrade-path.js'
import {
  formatE2EOutput,
  formatE2EHeader,
  aggregateResults,
  type E2ERunResult,
} from './e2e-shared.js'

async function main() {
  try {
    console.log(formatE2EHeader(
      'E2E Integration Test Runner',
      '2 harnesses — two-phase + upgrade path',
    ))
    console.log('')

    const results: E2ERunResult[] = []

    // Run Two-Phase harness
    console.log('Running: Two-Phase + Multi-Project...')
    const twoPhaseResult = await runTwoPhase()
    results.push(twoPhaseResult)
    console.log(formatE2EOutput(twoPhaseResult))
    console.log('')

    // Run Upgrade Path harness
    console.log('Running: Upgrade Path Verification...')
    const upgradeResult = await runUpgradePath()
    results.push(upgradeResult)
    console.log(formatE2EOutput(upgradeResult))
    console.log('')

    // Aggregate
    const agg = aggregateResults(results)
    const mood = agg.allPassed ? '(^ ^)' : '(! !)'
    console.log('═══════════════════════════════════════════════════════════════')
    console.log(`E2E COMBINED ${mood}: ${agg.passedSuites}/${agg.totalSuites} suites | ${agg.passedChecks}/${agg.totalChecks} checks passed`)
    console.log('═══════════════════════════════════════════════════════════════')

    if (process.argv.includes('--json')) {
      console.log('\n---JSON---')
      console.log(JSON.stringify({
        passed: agg.allPassed,
        totalSuites: agg.totalSuites,
        passedSuites: agg.passedSuites,
        totalChecks: agg.totalChecks,
        passedChecks: agg.passedChecks,
        harnesses: results,
      }, null, 2))
    }

    process.exit(agg.allPassed ? 0 : 1)
  } catch (err) {
    console.error('╭─────────────────────────────────────────────────────────────╮')
    console.error('│      /\\___/\\                                                │')
    console.error('│     (T   T)   E2E Runner crashed!                          │')
    console.error('│     (  =^=  )   See error below.                           │')
    console.error('│      (______)                                               │')
    console.error('╰─────────────────────────────────────────────────────────────╯')
    console.error('')
    console.error((err as Error).message)
    console.error((err as Error).stack)
    process.exit(2)
  }
}

main()
