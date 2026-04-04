/**
 * traqr link — Connect cloud services to a Traqr project
 *
 * Non-interactive-first design: every service accepts CLI flags
 * so Claude can call it programmatically. Interactive prompts
 * are the human fallback, not the primary path.
 *
 * Usage:
 *   traqr link vcs --provider=gitlab --token=glpat-xxx --url=https://gitlab.example.com --project-id=123
 *   traqr link memory --provider=supabase --url=https://xxx.supabase.co --key=xxx
 *   traqr link obsidian --path=/Users/me/Documents/Obsidian\ Vault
 *   traqr link slack --webhook=https://hooks.slack.com/xxx
 *   traqr link issues --provider=linear --key=lin_api_xxx
 *   traqr link --test          # test all configured services
 */

import fs from 'fs/promises'
import path from 'path'
import { existsSync } from 'fs'
import { loadProjectConfig, deepMerge, type TraqrConfig } from '@traqr/core'
import { ask, closePrompts } from '../lib/prompts.js'

const args = process.argv.slice(3)
const service = args[0]
const flags = parseFlags(args.slice(1))

function parseFlags(raw: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const arg of raw) {
    const match = arg.match(/^--(\w[\w-]*)=(.+)$/)
    if (match) result[match[1]] = match[2]
    else if (arg.startsWith('--')) result[arg.slice(2)] = 'true'
  }
  return result
}

async function run() {
  const { config, path: configPath } = loadProjectConfig()
  if (!config) {
    console.error('No .traqr/config.json found. Run "traqr init" first.')
    process.exit(1)
  }

  const configDir = path.dirname(configPath!)

  switch (service) {
    case 'vcs':     await linkVcs(config, configDir); break
    case 'memory':  await linkMemory(config, configDir); break
    case 'obsidian': await linkObsidian(config, configDir); break
    case 'slack':   await linkSlack(config, configDir); break
    case 'issues':  await linkIssues(config, configDir); break
    case '--test':  await testAll(config); break
    default:
      console.log(`
  traqr link — Connect cloud services

  Usage: traqr link <service> [options]

  Services:
    vcs        Git hosting (GitHub, GitLab)
    memory     Memory database (Supabase)
    obsidian   Obsidian vault path
    slack      Slack notifications
    issues     Issue tracker (Linear, GitLab)

  Options:
    --test     Test connectivity for all configured services

  Examples:
    traqr link vcs --provider=gitlab --url=https://gitlab.example.com
    traqr link obsidian --path="~/Documents/Obsidian Vault"
    traqr link --test
`)
      break
  }

  closePrompts()
}

// ============================================================
// Service Linkers
// ============================================================

async function linkVcs(config: TraqrConfig, configDir: string) {
  const provider = flags.provider || await ask('VCS provider (github/gitlab)')
  const delta: Partial<TraqrConfig> = {
    vcs: {
      provider: provider as 'github' | 'gitlab',
      ...(flags.url && { baseUrl: flags.url }),
      ...(flags['project-id'] && { projectId: flags['project-id'] }),
      ...(provider === 'gitlab' && { autoMerge: true, primedSession: true, removeSourceBranch: true }),
    },
  }
  await writeConfigDelta(config, delta, configDir)
  console.log(`  VCS linked: ${provider}${flags.url ? ` at ${flags.url}` : ''}`)
  if (provider === 'gitlab') {
    console.log('  Tip: export GITLAB_TOKEN=glpat-xxx in your shell profile')
  }
  suggestRender()
}

async function linkMemory(config: TraqrConfig, configDir: string) {
  const provider = flags.provider || await ask('Memory provider (supabase/local/none)')
  const delta: Partial<TraqrConfig> = {
    memory: {
      provider: provider as 'supabase' | 'local' | 'none',
      ...(flags.url && { apiBase: flags.url }),
    },
  }
  await writeConfigDelta(config, delta, configDir)
  console.log(`  Memory linked: ${provider}`)
  suggestRender()
}

async function linkObsidian(config: TraqrConfig, configDir: string) {
  const vaultPath = flags.path || await ask('Obsidian vault path')
  const resolved = path.resolve(vaultPath.replace(/^~/, process.env.HOME || ''))
  const delta: Partial<TraqrConfig> = {
    vault: { path: resolved },
  }
  await writeConfigDelta(config, delta, configDir)
  console.log(`  Obsidian linked: ${resolved}`)
  console.log('  Run "traqr vault init" to create the research folder structure.')
  suggestRender()
}

async function linkSlack(config: TraqrConfig, configDir: string) {
  const level = (flags.level || 'standard') as 'none' | 'basic' | 'standard' | 'full'
  const delta: Partial<TraqrConfig> = {
    notifications: {
      slackLevel: level,
      ...(flags.webhook && { slackWebhook: flags.webhook }),
    },
  }
  await writeConfigDelta(config, delta, configDir)
  console.log(`  Slack linked: level=${level}`)
  suggestRender()
}

async function linkIssues(config: TraqrConfig, configDir: string) {
  const provider = flags.provider || await ask('Issue tracker (linear/gitlab/github/none)')
  const delta: Partial<TraqrConfig> = {
    issues: {
      provider: provider as 'linear' | 'github' | 'gitlab' | 'none',
      ...(provider === 'linear' && flags['team-id'] && { linearTeamId: flags['team-id'] }),
    },
  }
  await writeConfigDelta(config, delta, configDir)
  console.log(`  Issues linked: ${provider}`)
  suggestRender()
}

// ============================================================
// Utilities
// ============================================================

async function writeConfigDelta(config: TraqrConfig, delta: Partial<TraqrConfig>, configDir: string) {
  const merged = deepMerge(config, delta) as TraqrConfig
  const configPath = path.join(configDir, 'config.json')
  await fs.writeFile(configPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8')
}

async function testAll(config: TraqrConfig) {
  console.log('  Testing configured services...\n')

  // VCS
  const vcs = config.vcs?.provider || 'github'
  console.log(`  VCS (${vcs}): ${config.vcs?.baseUrl || 'default'}`)
  console.log(`    ${config.vcs?.projectId ? 'project-id: ' + config.vcs.projectId : 'no project-id set'}`)

  // Memory
  const mem = config.memory?.provider || 'none'
  console.log(`  Memory (${mem}): ${config.memory?.apiBase || 'not configured'}`)

  // Vault
  const vault = config.vault?.path
  if (vault) {
    const exists = existsSync(vault)
    console.log(`  Obsidian: ${vault} ${exists ? '(exists)' : '(NOT FOUND)'}`)
  } else {
    console.log('  Obsidian: not configured')
  }

  // Issues
  const issues = config.issues?.provider || 'none'
  console.log(`  Issues (${issues}): ${issues === 'linear' ? 'team ' + (config.issues?.linearTeamId || 'not set') : 'configured'}`)

  // Slack
  const slack = config.notifications?.slackLevel || 'none'
  console.log(`  Slack: ${slack}`)

  console.log('\n  For full connectivity tests, run the specific service commands with --test.')
}

function suggestRender() {
  console.log('\n  Run "npx traqr render" to regenerate skills with updated config.')
}

void run()
