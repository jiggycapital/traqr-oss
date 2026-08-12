#!/usr/bin/env node
/**
 * @traqr/core — E2E Test: Two-Phase Profile + Multi-Project
 *
 * Exercises the full two-phase setup→init flow:
 *   1. Create org profile (writeOrgConfig)
 *   2. Init Project Alpha (Solo tier)
 *   3. Init Project Beta (Production tier)
 *   4. Verify multi-project registry
 *   5. Verify alias generation (primary vs non-primary)
 *   6. Verify cross-project isolation
 *
 * All filesystem writes go to a sandboxed /tmp directory.
 *
 * Usage: node dist/e2e-two-phase.js [--json]
 */

import * as fs from 'fs'
import * as path from 'path'
import {
  createSandbox,
  cleanupSandbox,
  buildProjectConfig,
  formatE2EOutput,
  type Sandbox,
  type TestCheck,
  type SuiteResult,
  type E2ERunResult,
} from './e2e-shared.js'
import { writeOrgConfig, loadOrgConfig, registerProject, getProjectRegistry } from './config-resolver.js'
import type { OrgConfig } from './config-resolver.js'
import { renderAllTemplates } from './template-loader.js'
import { generateSlots, buildTemplateVars, getFeatureFlags } from './template-engine.js'
import { generateAliasContent, writeAliasFile } from './alias-generator.js'
import type { TraqrConfig } from './config-schema.js'

// ============================================================
// Test Data
// ============================================================

const ALPHA_CONFIG = buildProjectConfig({
  name: 'alpha',
  displayName: 'Project Alpha',
  description: 'Alpha test project',
  prefix: 'alpha',
  aliasPrefix: 'al',
  kvPrefix: 'alpha-kv',
  pack: 'solo',
  ports: { main: 3000, featureStart: 3001, bugfixStart: 3011, devopsStart: 3021, analysis: 3099 },
})

const BETA_CONFIG = buildProjectConfig({
  name: 'beta',
  displayName: 'Project Beta',
  description: 'Beta test project',
  prefix: 'beta',
  aliasPrefix: 'bt',
  kvPrefix: 'beta-kv',
  pack: 'production',
  ports: { main: 4000, featureStart: 4001, bugfixStart: 4011, devopsStart: 4021, analysis: 4099 },
})

// ============================================================
// Suite 1: Org Profile
// ============================================================

function suiteOrgProfile(sandbox: Sandbox): SuiteResult {
  const results: TestCheck[] = []
  let checks = 0

  // Write org config
  const orgConfig: OrgConfig = {
    coAuthor: 'Claude Opus 4.6 <noreply@anthropic.com>',
    maxConcurrentSlots: 4,
  }

  try {
    writeOrgConfig(orgConfig)
    checks++
    results.push({
      name: 'writeOrgConfig',
      passed: true,
      details: 'writeOrgConfig() succeeded',
      checks: 1,
    })
  } catch (err) {
    checks++
    results.push({
      name: 'writeOrgConfig',
      passed: false,
      details: `writeOrgConfig() threw: ${(err as Error).message}`,
      checks: 1,
    })
  }

  // File exists
  const configPath = path.join(sandbox.home, '.traqr', 'config.json')
  const exists = fs.existsSync(configPath)
  checks++
  results.push({
    name: 'configFileExists',
    passed: exists,
    details: exists ? `exists at ${configPath}` : `MISSING at ${configPath}`,
    checks: 1,
  })

  // Read it back
  const { config: loaded } = loadOrgConfig()
  const readBack = loaded !== null && loaded.coAuthor === orgConfig.coAuthor
  checks++
  results.push({
    name: 'loadOrgConfig',
    passed: readBack,
    details: readBack
      ? `coAuthor=${loaded?.coAuthor}`
      : `loadOrgConfig returned ${JSON.stringify(loaded)}`,
    checks: 1,
  })

  return {
    suite: '1. Org Profile',
    passed: results.every(r => r.passed),
    results,
    totalChecks: checks,
  }
}

// ============================================================
// Suite 2: Project A (Solo)
// ============================================================

async function suiteProjectAlpha(): Promise<SuiteResult> {
  const results: TestCheck[] = []
  let checks = 0

  // Render templates
  const renderResult = await renderAllTemplates(ALPHA_CONFIG)
  const fileCount = Object.keys(renderResult.files).length

  checks++
  results.push({
    name: 'renderFileCount',
    passed: fileCount >= 15 && fileCount <= 30,
    details: `${fileCount} files rendered (expected 15-30)`,
    checks: 1,
  })

  // Core files present
  const coreFiles = ['CLAUDE.md', 'commands/ship.md']
  const missingCore = coreFiles.filter(f => {
    return !Object.keys(renderResult.files).some(k => k.endsWith(f))
  })
  checks++
  results.push({
    name: 'coreFilesPresent',
    passed: missingCore.length === 0,
    details: missingCore.length === 0
      ? `${coreFiles.length} core files present`
      : `MISSING: ${missingCore.join(', ')}`,
    checks: 1,
  })

  // Memory files absent (Solo has no memory)
  const memoryFiles = ['commands/analyze.md']
  const presentMemory = memoryFiles.filter(f => {
    return Object.keys(renderResult.files).some(k => k.endsWith(f))
  })
  checks++
  results.push({
    name: 'memoryFilesAbsent',
    passed: presentMemory.length === 0,
    details: presentMemory.length === 0
      ? 'memory files correctly absent (Solo tier)'
      : `SHOULD NOT EXIST: ${presentMemory.join(', ')}`,
    checks: 1,
  })

  // Register project
  try {
    registerProject('alpha', {
      repoPath: ALPHA_CONFIG.project.repoPath,
      worktreesPath: ALPHA_CONFIG.project.worktreesPath,
      displayName: ALPHA_CONFIG.project.displayName,
      aliasPrefix: 'al',
      registeredAt: new Date().toISOString(),
    })
    checks++
    results.push({
      name: 'registerProject',
      passed: true,
      details: 'registerProject("alpha") succeeded',
      checks: 1,
    })
  } catch (err) {
    checks++
    results.push({
      name: 'registerProject',
      passed: false,
      details: `registerProject threw: ${(err as Error).message}`,
      checks: 1,
    })
  }

  return {
    suite: '2. Project Alpha (Solo)',
    passed: results.every(r => r.passed),
    results,
    totalChecks: checks,
  }
}

// ============================================================
// Suite 3: Project B (Production)
// ============================================================

async function suiteProjectBeta(alphaFileCount: number): Promise<SuiteResult> {
  const results: TestCheck[] = []
  let checks = 0

  // Render templates
  const renderResult = await renderAllTemplates(BETA_CONFIG)
  const fileCount = Object.keys(renderResult.files).length

  // More files than Solo
  checks++
  results.push({
    name: 'moreFilesThanSolo',
    passed: fileCount > alphaFileCount,
    details: `${fileCount} files (Solo had ${alphaFileCount})`,
    checks: 1,
  })

  // Memory + Slack commands present
  const expectedFiles = ['commands/analyze.md', 'commands/slack.md']
  const missingExpected = expectedFiles.filter(f => {
    return !Object.keys(renderResult.files).some(k => k.endsWith(f))
  })
  checks++
  results.push({
    name: 'prodFilesPresent',
    passed: missingExpected.length === 0,
    details: missingExpected.length === 0
      ? `${expectedFiles.length} production files present`
      : `MISSING: ${missingExpected.join(', ')}`,
    checks: 1,
  })

  // Analytics absent (tier 3 < 4)
  const analyticsFiles = ['commands/analytics.md']
  const presentAnalytics = analyticsFiles.filter(f => {
    return Object.keys(renderResult.files).some(k => k.endsWith(f))
  })
  checks++
  results.push({
    name: 'analyticsAbsent',
    passed: presentAnalytics.length === 0,
    details: presentAnalytics.length === 0
      ? 'analytics files correctly absent (tier 3)'
      : `SHOULD NOT EXIST: ${presentAnalytics.join(', ')}`,
    checks: 1,
  })

  // Register project
  try {
    registerProject('beta', {
      repoPath: BETA_CONFIG.project.repoPath,
      worktreesPath: BETA_CONFIG.project.worktreesPath,
      displayName: BETA_CONFIG.project.displayName,
      aliasPrefix: 'bt',
      registeredAt: new Date().toISOString(),
    })

    // Verify registry has both
    const registry = getProjectRegistry()
    const hasBoth = 'alpha' in registry && 'beta' in registry
    checks++
    results.push({
      name: 'registryHasBoth',
      passed: hasBoth,
      details: hasBoth
        ? `registry has ${Object.keys(registry).length} projects: ${Object.keys(registry).join(', ')}`
        : `registry keys: ${Object.keys(registry).join(', ')}`,
      checks: 1,
    })
  } catch (err) {
    checks++
    results.push({
      name: 'registryHasBoth',
      passed: false,
      details: `registerProject threw: ${(err as Error).message}`,
      checks: 1,
    })
  }

  return {
    suite: '3. Project Beta (Production)',
    passed: results.every(r => r.passed),
    results,
    totalChecks: checks,
  }
}

// ============================================================
// Suite 4: Multi-Project Registry
// ============================================================

function suiteMultiProjectRegistry(): SuiteResult {
  const results: TestCheck[] = []
  let checks = 0

  const registry = getProjectRegistry()

  // Count
  const count = Object.keys(registry).length
  checks++
  results.push({
    name: 'registryCount',
    passed: count === 2,
    details: `${count} entries (expected 2)`,
    checks: 1,
  })

  // Alpha entry
  const alpha = registry['alpha']
  const alphaOk = alpha !== undefined
    && alpha.aliasPrefix === 'al'
    && alpha.displayName === 'Project Alpha'
    && typeof alpha.registeredAt === 'string'
  checks++
  results.push({
    name: 'alphaEntry',
    passed: alphaOk,
    details: alphaOk
      ? `aliasPrefix=${alpha.aliasPrefix}, displayName=${alpha.displayName}`
      : `alpha entry: ${JSON.stringify(alpha)}`,
    checks: 1,
  })

  // Beta entry
  const beta = registry['beta']
  const betaOk = beta !== undefined
    && beta.aliasPrefix === 'bt'
    && beta.displayName === 'Project Beta'
    && typeof beta.registeredAt === 'string'
  checks++
  results.push({
    name: 'betaEntry',
    passed: betaOk,
    details: betaOk
      ? `aliasPrefix=${beta.aliasPrefix}, displayName=${beta.displayName}`
      : `beta entry: ${JSON.stringify(beta)}`,
    checks: 1,
  })

  return {
    suite: '4. Multi-Project Registry',
    passed: results.every(r => r.passed),
    results,
    totalChecks: checks,
  }
}

// ============================================================
// Suite 5: Alias Generation
// ============================================================

function suiteAliasGeneration(sandbox: Sandbox): SuiteResult {
  const results: TestCheck[] = []
  let checks = 0

  // Primary project (Alpha) — should have generic + prefixed aliases
  const primaryContent = generateAliasContent(ALPHA_CONFIG, { isPrimary: true })

  // Generic aliases present
  const hasGenericJump = primaryContent.includes("alias zm=") && primaryContent.includes("alias z1=")
  checks++
  results.push({
    name: 'primaryGenericAliases',
    passed: hasGenericJump,
    details: hasGenericJump
      ? 'generic aliases (zm, z1) present in primary'
      : 'MISSING generic aliases in primary content',
    checks: 1,
  })

  // Prefixed aliases present
  const hasPrefixedJump = primaryContent.includes("alias alm=") && primaryContent.includes("alias al1=")
  checks++
  results.push({
    name: 'primaryPrefixedAliases',
    passed: hasPrefixedJump,
    details: hasPrefixedJump
      ? 'prefixed aliases (alm, al1) present in primary'
      : 'MISSING prefixed aliases in primary content',
    checks: 1,
  })

  // Non-primary project (Beta) — only prefixed, no generic
  const nonPrimaryContent = generateAliasContent(BETA_CONFIG, { isPrimary: false })

  const hasBetaPrefixed = nonPrimaryContent.includes("alias btm=") && nonPrimaryContent.includes("alias bt1=")
  checks++
  results.push({
    name: 'nonPrimaryPrefixed',
    passed: hasBetaPrefixed,
    details: hasBetaPrefixed
      ? 'prefixed aliases (btm, bt1) present in non-primary'
      : 'MISSING prefixed aliases in non-primary content',
    checks: 1,
  })

  const hasNoGeneric = !nonPrimaryContent.includes("alias zm=") && !nonPrimaryContent.includes("alias z1=")
  checks++
  results.push({
    name: 'nonPrimaryNoGeneric',
    passed: hasNoGeneric,
    details: hasNoGeneric
      ? 'no generic aliases in non-primary (correct)'
      : 'FOUND generic aliases in non-primary content (should be absent)',
    checks: 1,
  })

  // writeAliasFile creates files at correct paths
  const aliasDir = path.join(sandbox.home, '.traqr', 'aliases')
  try {
    const alphaPath = writeAliasFile(ALPHA_CONFIG, { isPrimary: true })
    const betaPath = writeAliasFile(BETA_CONFIG, { isPrimary: false })
    const alphaExists = fs.existsSync(alphaPath)
    const betaExists = fs.existsSync(betaPath)
    checks++
    results.push({
      name: 'aliasFilesWritten',
      passed: alphaExists && betaExists,
      details: alphaExists && betaExists
        ? `alpha.sh and beta.sh written to ${aliasDir}`
        : `alpha=${alphaExists}, beta=${betaExists}`,
      checks: 1,
    })
  } catch (err) {
    checks++
    results.push({
      name: 'aliasFilesWritten',
      passed: false,
      details: `writeAliasFile threw: ${(err as Error).message}`,
      checks: 1,
    })
  }

  return {
    suite: '5. Alias Generation',
    passed: results.every(r => r.passed),
    results,
    totalChecks: checks,
  }
}

// ============================================================
// Suite 6: Cross-Project Isolation
// ============================================================

async function suiteCrossProjectIsolation(): Promise<SuiteResult> {
  const results: TestCheck[] = []
  let checks = 0

  // Port ranges don't overlap
  const alphaPorts = [ALPHA_CONFIG.ports.main, ALPHA_CONFIG.ports.featureStart, ALPHA_CONFIG.ports.bugfixStart, ALPHA_CONFIG.ports.devopsStart, ALPHA_CONFIG.ports.analysis]
  const betaPorts = [BETA_CONFIG.ports.main, BETA_CONFIG.ports.featureStart, BETA_CONFIG.ports.bugfixStart, BETA_CONFIG.ports.devopsStart, BETA_CONFIG.ports.analysis]
  const overlap = alphaPorts.some(p => betaPorts.includes(p))
  checks++
  results.push({
    name: 'portIsolation',
    passed: !overlap,
    details: !overlap
      ? `alpha ports [${alphaPorts.join(',')}] vs beta [${betaPorts.join(',')}] — no overlap`
      : 'PORT OVERLAP detected',
    checks: 1,
  })

  // Different slot counts per tier
  const alphaSlots = generateSlots(ALPHA_CONFIG)
  const betaSlots = generateSlots(BETA_CONFIG)
  const differentCounts = alphaSlots.length !== betaSlots.length
  checks++
  results.push({
    name: 'slotCountsDiffer',
    passed: differentCounts,
    details: `alpha=${alphaSlots.length} slots, beta=${betaSlots.length} slots`,
    checks: 1,
  })

  // Rendered CLAUDE.md contains correct project name
  const alphaRender = await renderAllTemplates(ALPHA_CONFIG)
  const betaRender = await renderAllTemplates(BETA_CONFIG)

  const alphaClaudeMd = Object.entries(alphaRender.files).find(([k]) => k.endsWith('CLAUDE.md'))?.[1] || ''
  const betaClaudeMd = Object.entries(betaRender.files).find(([k]) => k.endsWith('CLAUDE.md'))?.[1] || ''

  const alphaHasName = alphaClaudeMd.includes('Project Alpha') || alphaClaudeMd.includes('alpha')
  const betaHasName = betaClaudeMd.includes('Project Beta') || betaClaudeMd.includes('beta')
  checks++
  results.push({
    name: 'claudeMdProjectName',
    passed: alphaHasName && betaHasName,
    details: `alpha CLAUDE.md has project name: ${alphaHasName}, beta: ${betaHasName}`,
    checks: 1,
  })

  // kvPrefix differs
  const alphaKv = ALPHA_CONFIG.kvPrefix
  const betaKv = BETA_CONFIG.kvPrefix
  const kvDiffer = alphaKv !== betaKv
  checks++
  results.push({
    name: 'kvPrefixIsolation',
    passed: kvDiffer,
    details: `alpha kvPrefix="${alphaKv}", beta="${betaKv}"`,
    checks: 1,
  })

  return {
    suite: '6. Cross-Project Isolation',
    passed: results.every(r => r.passed),
    results,
    totalChecks: checks,
  }
}

// ============================================================
// Runner
// ============================================================

export async function runSuites(): Promise<E2ERunResult> {
  const sandbox = createSandbox('two-phase')
  const suites: SuiteResult[] = []

  try {
    // Suite 1: Org Profile
    suites.push(suiteOrgProfile(sandbox))

    // Suite 2: Project Alpha (Solo)
    const alphaResult = await suiteProjectAlpha()
    suites.push(alphaResult)

    // Get alpha file count for comparison
    const alphaRender = await renderAllTemplates(ALPHA_CONFIG)
    const alphaFileCount = Object.keys(alphaRender.files).length

    // Suite 3: Project Beta (Production)
    suites.push(await suiteProjectBeta(alphaFileCount))

    // Suite 4: Multi-Project Registry
    suites.push(suiteMultiProjectRegistry())

    // Suite 5: Alias Generation
    suites.push(suiteAliasGeneration(sandbox))

    // Suite 6: Cross-Project Isolation
    suites.push(await suiteCrossProjectIsolation())
  } finally {
    cleanupSandbox(sandbox)
  }

  const totalSuites = suites.length
  const passedSuites = suites.filter(s => s.passed).length
  const totalChecks = suites.reduce((sum, s) => sum + s.totalChecks, 0)
  const passedChecks = suites.reduce((sum, s) =>
    sum + s.results.reduce((rSum, r) => rSum + (r.passed ? r.checks : 0), 0), 0)

  return {
    name: 'E2E: Two-Phase + Multi-Project',
    description: '6 suites — org profile, 2 projects, registry, aliases, isolation',
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
    console.error('│     (T   T)   E2E Two-Phase harness crashed!               │')
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
const isDirectRun = process.argv[1]?.endsWith('e2e-two-phase.js')
  || process.argv[1]?.endsWith('e2e-two-phase.ts')
if (isDirectRun) {
  main()
}
