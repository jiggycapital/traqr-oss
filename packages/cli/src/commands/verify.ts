/**
 * traqr verify — Post-setup health check
 *
 * Validates config, render output, memory setup, VCS, and team readiness.
 * Designed to run after `traqr render` to confirm everything is wired up.
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — critical failures (missing config, broken render)
 *   2 — warnings only (missing optional components)
 */

import fs from 'fs/promises'
import path from 'path'
import { loadProjectConfig, calculateAutomationScore } from '@traqr/core'
import type { TraqrConfig } from '@traqr/core'

interface CheckResult {
  category: string
  label: string
  status: 'pass' | 'warn' | 'fail'
  message: string
}

const results: CheckResult[] = []

function check(category: string, label: string, status: 'pass' | 'warn' | 'fail', message: string) {
  results.push({ category, label, status, message })
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function checkConfig(cwd: string): Promise<TraqrConfig | null> {
  const configPath = path.join(cwd, '.traqr', 'config.json')
  if (!await fileExists(configPath)) {
    check('config', 'config.json', 'fail', '.traqr/config.json not found — run npx traqr render')
    return null
  }

  try {
    const raw = await fs.readFile(configPath, 'utf-8')
    const config = JSON.parse(raw) as TraqrConfig

    check('config', 'config.json', 'pass', `.traqr/config.json found (v${config.version})`)

    // Check required fields
    if (!config.project?.name) {
      check('config', 'project.name', 'fail', 'Missing project.name in config')
    }
    if (config.tier === undefined) {
      check('config', 'tier', 'fail', 'Missing tier in config')
    }

    // Determine golden path
    const vcs = config.vcs?.provider || 'unknown'
    const issueProvider = config.issues?.provider || 'none'
    let goldenPath = 'custom'
    if (vcs === 'github' && issueProvider === 'linear') goldenPath = 'github-pro'
    else if (vcs === 'gitlab' && issueProvider === 'gitlab') goldenPath = 'gitlab-team'
    else if (vcs === 'gitlab' && issueProvider === 'none') goldenPath = 'gitlab-minimal'

    check('config', 'golden-path', 'pass', `Golden Path: ${goldenPath} (tier ${config.tier})`)

    return config
  } catch (e) {
    check('config', 'parse', 'fail', `Invalid JSON in config.json: ${(e as Error).message}`)
    return null
  }
}

async function checkRender(cwd: string) {
  // Check CLAUDE.md
  const claudePath = path.join(cwd, 'CLAUDE.md')
  if (await fileExists(claudePath)) {
    const content = await fs.readFile(claudePath, 'utf-8')
    const markerCount = (content.match(/<!-- traqr:start:/g) || []).length
    if (markerCount > 0) {
      check('render', 'CLAUDE.md', 'pass', `CLAUDE.md exists — ${markerCount} Traqr sections`)
    } else {
      check('render', 'CLAUDE.md', 'warn', 'CLAUDE.md exists but has no Traqr section markers — run npx traqr render')
    }

    // Check for unresolved template vars
    const unresolvedVars = content.match(/\{\{[A-Z_]+\}\}/g)
    if (unresolvedVars && unresolvedVars.length > 0) {
      check('render', 'template-vars', 'warn', `${unresolvedVars.length} unresolved template variables: ${unresolvedVars.slice(0, 3).join(', ')}`)
    }
  } else {
    check('render', 'CLAUDE.md', 'fail', 'CLAUDE.md not found — run npx traqr render')
  }

  // Check ONBOARDING.md
  const onboardingPath = path.join(cwd, '.traqr', 'ONBOARDING.md')
  if (await fileExists(onboardingPath)) {
    check('render', 'ONBOARDING.md', 'pass', 'ONBOARDING.md exists')
  } else {
    check('render', 'ONBOARDING.md', 'warn', '.traqr/ONBOARDING.md not found — run npx traqr render')
  }
}

async function checkMemory(cwd: string, config: TraqrConfig) {
  const memoryProvider = config.memory?.provider
  if (!memoryProvider || memoryProvider === 'none') {
    check('memory', 'provider', 'pass', 'No memory configured (tier 0)')
    return
  }

  check('memory', 'provider', 'pass', `Provider: ${memoryProvider}`)

  // Check for MCP config
  const mcpPaths = [
    path.join(cwd, '.claude', 'mcp.json'),
    path.join(process.env.HOME || '', '.claude', 'mcp.json'),
    path.join(process.env.HOME || '', '.claude.json'),
  ]

  let mcpFound = false
  for (const mcpPath of mcpPaths) {
    if (await fileExists(mcpPath)) {
      try {
        const raw = await fs.readFile(mcpPath, 'utf-8')
        const mcpConfig = JSON.parse(raw)
        const servers = mcpConfig.mcpServers || mcpConfig
        if (servers['traqr-memory']) {
          check('memory', 'mcp-config', 'pass', `MCP config: found in ${path.basename(mcpPath)}`)
          mcpFound = true
          break
        }
      } catch {
        // Invalid JSON, try next
      }
    }
  }

  if (!mcpFound) {
    check('memory', 'mcp-config', 'warn', 'No traqr-memory MCP config found — run npx traqr-memory-mcp --install')
  }
}

async function checkVcs(cwd: string, config: TraqrConfig) {
  const vcsProvider = config.vcs?.provider
  if (!vcsProvider) {
    check('vcs', 'provider', 'warn', 'No VCS provider configured')
    return
  }

  check('vcs', 'provider', 'pass', `Provider: ${vcsProvider}`)

  // Check git remote
  try {
    const { execSync } = await import('child_process')
    const remote = execSync('git config --get remote.origin.url', { cwd, encoding: 'utf-8' }).trim()
    if (vcsProvider === 'github' && remote.includes('github.com')) {
      check('vcs', 'remote', 'pass', `Remote: ${config.project?.ghOrgRepo || remote}`)
    } else if (vcsProvider === 'gitlab' && (remote.includes('gitlab') || config.vcs?.baseUrl)) {
      check('vcs', 'remote', 'pass', `Remote: ${remote}`)
    } else {
      check('vcs', 'remote', 'warn', `Remote ${remote} may not match provider ${vcsProvider}`)
    }
  } catch {
    check('vcs', 'remote', 'warn', 'No git remote configured')
  }
}

async function checkTeam(cwd: string, config: TraqrConfig) {
  if (config.tier < 2) {
    check('team', 'tier', 'pass', 'Solo tier — team features not required')
    return
  }

  const onboardingPath = path.join(cwd, '.traqr', 'ONBOARDING.md')
  if (await fileExists(onboardingPath)) {
    check('team', 'onboarding', 'pass', 'Onboarding guide: present')
  } else {
    check('team', 'onboarding', 'warn', 'No onboarding guide — run npx traqr render to generate')
  }
}

async function run() {
  const cwd = process.cwd()

  console.log('TraqrOS Verify\n')

  // 1. Config
  const config = await checkConfig(cwd)
  if (!config) {
    printResults()
    process.exit(1)
  }

  // 2. Render output
  await checkRender(cwd)

  // 3. Memory
  await checkMemory(cwd, config)

  // 4. VCS
  await checkVcs(cwd, config)

  // 5. Team
  await checkTeam(cwd, config)

  // 6. Score
  const score = calculateAutomationScore(config)
  check('score', 'automation', 'pass', `Automation: ${score}/100`)

  printResults()

  // Exit code
  const hasFail = results.some(r => r.status === 'fail')
  const hasWarn = results.some(r => r.status === 'warn')
  if (hasFail) process.exit(1)
  if (hasWarn) process.exit(2)
  process.exit(0)
}

function printResults() {
  for (const r of results) {
    const icon = r.status === 'pass' ? '\x1b[32m✓\x1b[0m' : r.status === 'warn' ? '\x1b[33m!\x1b[0m' : '\x1b[31m✗\x1b[0m'
    console.log(`${icon} [${r.category}]  ${r.message}`)
  }

  const fails = results.filter(r => r.status === 'fail').length
  const warns = results.filter(r => r.status === 'warn').length
  const passes = results.filter(r => r.status === 'pass').length

  console.log('')
  if (fails > 0) {
    console.log(`\x1b[31m${fails} failed\x1b[0m, ${warns} warnings, ${passes} passed`)
  } else if (warns > 0) {
    console.log(`\x1b[33m${warns} warnings\x1b[0m, ${passes} passed`)
  } else {
    console.log(`\x1b[32mAll ${passes} checks passed.\x1b[0m`)
  }
}

void run()
