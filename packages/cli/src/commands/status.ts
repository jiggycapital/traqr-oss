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

  // Ping services
  console.log('')
  const pings = await Promise.all([
    pingEndpoint('http://localhost:4200/health', 'Daemon'),
    pingEndpoint('http://localhost:4100/health', 'Memory'),
  ])
  for (const p of pings) {
    console.log(`  ${p}`)
  }
}

void run()
