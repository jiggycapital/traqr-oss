/**
 * @traqr/core — E2E Shared Utilities
 *
 * Sandbox management, types, and formatters shared by both E2E harnesses.
 * Provides temp-dir isolation via HOME override so filesystem-touching
 * functions (writeOrgConfig, registerProject, writeAliasFile) write to
 * a sandboxed directory instead of the real ~/.traqr/.
 */

import * as fs from 'fs'
import * as path from 'path'
import type { TraqrConfig } from './config-schema.js'
import { STARTER_PACK_DEFAULTS, calculateAutomationScore } from './config-schema.js'

// ============================================================
// Types (matching test-harness.ts output format)
// ============================================================

export interface TestCheck {
  name: string
  passed: boolean
  details: string
  checks: number
}

export interface SuiteResult {
  suite: string
  passed: boolean
  results: TestCheck[]
  totalChecks: number
}

export interface E2ERunResult {
  name: string
  description: string
  suites: SuiteResult[]
  totalSuites: number
  passedSuites: number
  totalChecks: number
  passedChecks: number
  passed: boolean
}

// ============================================================
// Sandbox
// ============================================================

export interface Sandbox {
  /** Root temp directory, e.g. /tmp/traqr-e2e-two-phase-12345/ */
  root: string
  /** Fake HOME inside the sandbox */
  home: string
  /** The real HOME, to be restored in cleanup */
  originalHome: string
}

/**
 * Create a sandboxed temp directory and override process.env.HOME.
 * All ~/.traqr/ writes will land inside the sandbox.
 */
export function createSandbox(name: string): Sandbox {
  const root = path.join('/tmp', `traqr-e2e-${name}-${process.pid}`)
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })

  const originalHome = process.env.HOME || ''
  process.env.HOME = home

  return { root, home, originalHome }
}

/**
 * Restore HOME and remove the sandbox directory.
 */
export function cleanupSandbox(sandbox: Sandbox): void {
  process.env.HOME = sandbox.originalHome
  try {
    fs.rmSync(sandbox.root, { recursive: true, force: true })
  } catch {
    // Best-effort cleanup
  }
}

// ============================================================
// Config Builder
// ============================================================

export interface ProjectConfigOptions {
  name: string
  displayName: string
  description?: string
  prefix: string
  aliasPrefix: string
  kvPrefix?: string
  pack: 'solo' | 'smart' | 'production' | 'full'
  ports: {
    main: number
    featureStart: number
    bugfixStart: number
    devopsStart: number
    analysis: number
  }
  repoPath?: string
  worktreesPath?: string
}

/**
 * Build a complete TraqrConfig from project details + starter pack defaults.
 */
export function buildProjectConfig(opts: ProjectConfigOptions): TraqrConfig {
  const defaults = STARTER_PACK_DEFAULTS[opts.pack]
  const config: TraqrConfig = {
    version: '1.0.0',
    project: {
      name: opts.name,
      displayName: opts.displayName,
      description: opts.description || `${opts.displayName} project`,
      repoPath: opts.repoPath || `/projects/${opts.name}`,
      worktreesPath: opts.worktreesPath || `${opts.repoPath || `/projects/${opts.name}`}/.worktrees`,
      ghOrgRepo: `test-org/${opts.name}`,
      framework: 'nextjs',
      packageManager: 'npm',
      deployPlatform: 'vercel',
    },
    ...defaults,
    ports: opts.ports,
    prefix: opts.prefix,
    aliasPrefix: opts.aliasPrefix,
    kvPrefix: opts.kvPrefix || opts.name,
    shipEnvVar: `${opts.name.toUpperCase()}_SHIP_AUTHORIZED`,
    sessionPrefix: opts.name,
    coAuthor: 'Claude Opus 4.6 <noreply@anthropic.com>',
  } as TraqrConfig

  config.automationScore = calculateAutomationScore(config)
  return config
}

// ============================================================
// Formatters
// ============================================================

/**
 * ASCII art header for E2E output.
 */
export function formatE2EHeader(title: string, desc: string): string {
  const lines: string[] = []
  lines.push('╭─────────────────────────────────────────────────────────────╮')
  lines.push('│      /\\___/\\                                                │')
  lines.push(`│     (^ ^)   ${title.padEnd(45)}│`)
  lines.push(`│     (  =^=  )   ${desc.padEnd(41)}│`)
  lines.push('│      (______)                                               │')
  lines.push('╰─────────────────────────────────────────────────────────────╯')
  return lines.join('\n')
}

/**
 * Summary line with Raqr mood.
 */
export function formatE2ESummary(result: E2ERunResult): string {
  const mood = result.passed ? '(^ ^)' : '(! !)'
  return `${result.name} ${mood}: ${result.passedSuites}/${result.totalSuites} suites | ${result.passedChecks}/${result.totalChecks} checks passed`
}

/**
 * Full formatted output for an E2E run.
 */
export function formatE2EOutput(result: E2ERunResult): string {
  const lines: string[] = []

  lines.push(formatE2EHeader(result.name, result.description))
  lines.push('')

  for (const suite of result.suites) {
    const icon = suite.passed ? '[pass]' : '[FAIL]'
    lines.push(`  ${icon} ${suite.suite}`)
    for (const check of suite.results) {
      const ci = check.passed ? '  +' : '  !'
      lines.push(`    ${ci} ${check.name}: ${check.details}`)
    }
  }

  lines.push('')
  lines.push(formatE2ESummary(result))

  return lines.join('\n')
}

/**
 * Aggregate multiple E2ERunResults into a combined summary.
 */
export function aggregateResults(results: E2ERunResult[]): {
  allPassed: boolean
  totalSuites: number
  passedSuites: number
  totalChecks: number
  passedChecks: number
} {
  let totalSuites = 0
  let passedSuites = 0
  let totalChecks = 0
  let passedChecks = 0

  for (const r of results) {
    totalSuites += r.totalSuites
    passedSuites += r.passedSuites
    totalChecks += r.totalChecks
    passedChecks += r.passedChecks
  }

  return {
    allPassed: results.every(r => r.passed),
    totalSuites,
    passedSuites,
    totalChecks,
    passedChecks,
  }
}
