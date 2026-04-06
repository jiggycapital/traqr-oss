/**
 * traqr status — Show config summary + health
 *
 * Loads .traqr/config.json and prints a summary.
 * Optionally pings daemon/memory endpoints if running.
 */

import {
  loadProjectConfig,
  resolveConfig,
  printConfigSummary,
  calculateAutomationScore,
  type ResolvedConfig,
} from '@traqr/core'

async function pingEndpoint(url: string, label: string): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
    if (res.ok) return `${label}: UP`
    return `${label}: DOWN (${res.status})`
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    return `${label}: DOWN (${msg})`
  }
}

async function run() {
  const { config, path: configPath } = loadProjectConfig()

  if (!config) {
    console.log('No .traqr/config.json found.')
    console.log('Run "traqr init" to create a project config.')
    process.exit(0)
  }

  const resolved = resolveConfig() as ResolvedConfig
  const score = config.automationScore ?? calculateAutomationScore(config)

  console.log(`Project: ${config.project.displayName}`)
  console.log(`Config:  ${configPath}`)
  console.log(`Tier:    ${config.tier} (${config.starterPack || 'custom'})`)
  console.log(`Score:   ${score}/100`)
  console.log('')
  console.log(printConfigSummary(resolved))

  // Check services — prefer MCP check over HTTP ping
  console.log('')

  // Memory: check if traqr-memory MCP is registered (user-level stdio is the default)
  try {
    const { execSync } = await import('child_process')
    const mcpOutput = execSync('claude mcp get traqr-memory 2>&1', { encoding: 'utf-8', timeout: 5000 })
    if (mcpOutput.includes('Connected')) {
      console.log('  Memory: UP (user-level stdio MCP)')
    } else if (mcpOutput.includes('traqr-memory')) {
      console.log('  Memory: REGISTERED but not connected (restart Claude Code to activate)')
    } else {
      // Fallback to HTTP check if MCP not found
      const httpResult = await pingEndpoint(`${resolved.daemon.apiBase}/memory/health`, 'Memory')
      console.log(`  ${httpResult}`)
    }
  } catch {
    // claude mcp command not available — try HTTP
    const httpResult = await pingEndpoint(`${resolved.daemon.apiBase}/memory/health`, 'Memory')
    console.log(`  ${httpResult}`)
  }

  // Daemon: only check if daemon is expected for this config
  if (config.guardian?.enabled || config.heartbeat?.enabled) {
    const daemonResult = await pingEndpoint(`${resolved.daemon.apiBase}/daemon/health`, 'Daemon')
    console.log(`  ${daemonResult}`)
  } else {
    console.log('  Daemon: not configured (Guardian/Heartbeat disabled)')
  }
}

void run()
