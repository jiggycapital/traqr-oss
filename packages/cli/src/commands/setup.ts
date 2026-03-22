/**
 * traqr setup — Create or update global profile (~/.traqr/config.json)
 *
 * Pure CLI equivalent of the /traqr-setup slash command.
 * No MCP tools — service connections recorded as method: 'manual'.
 */

import path from 'path'
import { existsSync, readFileSync, mkdirSync, appendFileSync, copyFileSync } from 'fs'
import { execSync } from 'child_process'
import { type OrgConfig, loadOrgConfig, writeOrgConfig, generateMotd, writeShellInit } from '@traqr/core'
import { ask, confirm, select, info, closePrompts } from '../lib/prompts.js'
import { checkPrerequisites } from '../lib/checks.js'

const HOME = process.env.HOME || ''

const RAQR_WELCOME = `
    /\\___/\\
   ( o   o )   Let's set up your Traqr profile.
   (  =^=  )   This creates ~/.traqr/config.json.
    (______)
`

async function run() {
  // --help flag
  if (process.argv[3] === '--help' || process.argv[3] === '-h') {
    console.log(`
  traqr setup — Create or update global Traqr profile

  Usage: traqr setup [options]

  Creates ~/.traqr/config.json with service connections,
  preferences, and shell integration.

  Options:
    --help, -h    Show this help message
`)
    process.exit(0)
  }

  checkPrerequisites()

  // Step 1: Welcome + detect existing profile
  console.log(RAQR_WELCOME)

  const { config: existing } = loadOrgConfig()

  let base: OrgConfig = {}

  if (existing) {
    console.log('Existing profile found at ~/.traqr/config.json')
    const action = await select('What would you like to do?', [
      { label: 'Update connections', value: 'update' as const },
      { label: 'Start fresh', value: 'fresh' as const },
      { label: 'View profile & exit', value: 'view' as const },
    ])

    if (action === 'view') {
      console.log('\n' + JSON.stringify(existing, null, 2))
      closePrompts()
      process.exit(0)
    }

    if (action === 'update') {
      base = existing
    }
    // 'fresh' leaves base as empty {}
  }

  // Step 2: Service selection with guidance
  console.log('\nWhich services do you want to connect?')
  console.log('  (Say no to any — you can connect them later with "traqr setup")\n')

  info('Slack sends you notifications when PRs ship, builds fail, agents need input.')
  info('What you need: a Slack workspace with a bot token.')
  info('Setup guide: https://api.slack.com/apps → Create New App → Bot Token Scopes')
  const wantSlack = await confirm('Connect Slack?')

  info('Linear provides issue tracking. Traqr auto-creates tickets and dispatches work.')
  info('What you need: a Linear workspace.')
  info('Get your team ID: Settings → Team → General → copy the identifier')
  const wantLinear = await confirm('Connect Linear?')

  info('Supabase gives Claude project memory — it remembers decisions across sessions.')
  info('What you need: a Supabase project with the pgvector extension enabled.')
  info('Create one: https://supabase.com/dashboard → New Project')
  const wantSupabase = await confirm('Connect Supabase?')

  info('GitHub CLI provides PR creation, code search, and repo management.')
  info('What you need: gh CLI installed and authenticated (gh auth login).')
  const wantGithub = await confirm('Connect GitHub?')

  info('Vercel deploys your app automatically on every push.')
  info('What you need: a Vercel account linked to your GitHub repo.')
  const wantVercel = await confirm('Connect Vercel?')

  info('PostHog provides product analytics — track events, funnels, user behavior.')
  info('What you need: a PostHog project and API key in .env.local.')
  const wantPosthog = await confirm('Connect PostHog?')

  info('Axiom provides observability — structured logging, dashboards, alerts.')
  info('What you need: an Axiom dataset and API token in .env.local.')
  const wantAxiom = await confirm('Connect Axiom?')

  info('Sentry catches errors in production with full stack traces and context.')
  info('What you need: a Sentry project DSN (Settings → Client Keys).')
  const wantSentry = await confirm('Connect Sentry?')

  info('Resend sends transactional emails — verification, notifications, receipts.')
  info('What you need: a verified domain and API key from resend.com/api-keys.')
  const wantResend = await confirm('Connect Resend?')

  info('Cloudflare Workers runs edge compute — KV storage, cron triggers, rate limiting.')
  info('What you need: a Cloudflare account ID (dashboard → right sidebar).')
  const wantCloudflare = await confirm('Connect Cloudflare?')

  info('Firebase provides auth, Firestore, and hosting for mobile/web apps.')
  info('What you need: a Firebase project ID (console.firebase.google.com).')
  const wantFirebase = await confirm('Connect Firebase?')

  // Step 3: Collect service metadata
  const services: NonNullable<OrgConfig['services']> = {}

  if (wantSlack) {
    services.slack = {
      connected: true,
      method: 'manual' as const,
      connectedAt: new Date().toISOString(),
    }
  }

  if (wantLinear) {
    info("Where to find these:")
    info("  Team ID → linear.app → Settings → Team → General → identifier")
    info("  Workspace slug → the part after linear.app/ (e.g. 'acme' in linear.app/acme)")
    const teamId = await ask('Linear team ID')
    const workspaceSlug = await ask('Linear workspace slug')
    services.linear = {
      connected: true,
      method: 'manual' as const,
      defaultTeamId: teamId,
      workspaceSlug,
      connectedAt: new Date().toISOString(),
    }
  }

  if (wantSupabase) {
    info("Where to find this:")
    info("  Project ref → supabase.com/dashboard → Project Settings → General → Reference ID")
    const projectRef = await ask('Supabase project reference')
    services.supabase = {
      connected: true,
      method: 'manual' as const,
      projectRef,
      connectedAt: new Date().toISOString(),
    }
  }

  if (wantGithub) {
    let ghConnected = false
    try {
      execSync('gh auth status', { stdio: 'pipe' })
      info('GitHub CLI is authenticated.')
      ghConnected = true
    } catch {
      info('GitHub CLI not authenticated. Run: gh auth login')
    }
    services.github = {
      connected: ghConnected,
      method: 'manual' as const,
      connectedAt: new Date().toISOString(),
    }
  }

  if (wantVercel) {
    const projectName = await ask('Vercel project name (optional, press enter to skip)', '')
    services.vercel = {
      connected: true,
      method: 'manual' as const,
      connectedAt: new Date().toISOString(),
      ...(projectName && { projectRef: projectName }),
    }
  }

  if (wantPosthog) {
    const projectId = await ask('PostHog project ID (optional)', '')
    services.posthog = {
      connected: true,
      method: 'manual' as const,
      connectedAt: new Date().toISOString(),
      ...(projectId && { projectRef: projectId }),
    }
  }

  if (wantAxiom) {
    const dataset = await ask('Axiom dataset name (optional)', '')
    services.axiom = {
      connected: true,
      method: 'manual' as const,
      connectedAt: new Date().toISOString(),
      ...(dataset && { projectRef: dataset }),
    }
  }

  if (wantSentry) {
    const dsn = await ask('Sentry DSN or org/project (optional)', '')
    services.sentry = {
      connected: true,
      method: 'manual' as const,
      connectedAt: new Date().toISOString(),
      ...(dsn && { projectRef: dsn }),
    }
  }

  if (wantResend) {
    const domain = await ask('Resend sending domain (optional)', '')
    services.resend = {
      connected: true,
      method: 'manual' as const,
      connectedAt: new Date().toISOString(),
      ...(domain && { projectRef: domain }),
    }
  }

  if (wantCloudflare) {
    const accountId = await ask('Cloudflare account ID (optional)', '')
    services.cloudflare = {
      connected: true,
      method: 'manual' as const,
      connectedAt: new Date().toISOString(),
      ...(accountId && { projectRef: accountId }),
    }
  }

  if (wantFirebase) {
    const projectId = await ask('Firebase project ID (optional)', '')
    services.firebase = {
      connected: true,
      method: 'manual' as const,
      connectedAt: new Date().toISOString(),
      ...(projectId && { projectRef: projectId }),
    }
  }

  // Step 4: Preferences
  const coAuthor = await ask('Co-author name for commits', base.coAuthor || 'Claude Opus 4.6')
  const maxSlots = parseInt(
    await ask('Max concurrent Claude sessions', String(base.maxConcurrentSlots || 3)),
    10,
  )

  // Step 4b: Preferred stack
  console.log('\nPreferred stack defaults (applied to new projects):')
  info('These set sensible defaults when you run "traqr init" in a new project.')

  const preferredStack: NonNullable<OrgConfig['preferredStack']> = {
    errorTracking: await select('Error tracking', [
      { label: 'Sentry', value: 'sentry' as const },
      { label: 'Axiom', value: 'axiom' as const },
      { label: 'None', value: 'none' as const },
    ]),
    analytics: 'posthog' as const,
    issueTracking: await select('Issue tracking', [
      { label: 'Linear', value: 'linear' as const },
      { label: 'GitHub Issues', value: 'github-issues' as const },
    ]),
    email: await select('Transactional email', [
      { label: 'Resend', value: 'resend' as const },
      { label: 'None', value: 'none' as const },
    ]),
    uptime: await select('Uptime monitoring', [
      { label: 'Checkly', value: 'checkly' as const },
      { label: 'Better Stack', value: 'betterstack' as const },
      { label: 'Both', value: 'both' as const },
      { label: 'None', value: 'none' as const },
    ]),
    observability: await select('Observability', [
      { label: 'Axiom', value: 'axiom' as const },
      { label: 'None', value: 'none' as const },
    ]),
    edgeCompute: await select('Edge compute', [
      { label: 'Cloudflare Workers', value: 'cloudflare' as const },
      { label: 'None', value: 'none' as const },
    ]),
    auth: await select('Authentication', [
      { label: 'Firebase', value: 'firebase' as const },
      { label: 'Supabase Auth', value: 'supabase' as const },
      { label: 'Custom', value: 'custom' as const },
    ]),
    database: await select('Database', [
      { label: 'Supabase (Postgres)', value: 'supabase' as const },
      { label: 'Firestore', value: 'firestore' as const },
      { label: 'Cloudflare D1', value: 'd1' as const },
    ]),
  }

  // Step 5: Templates path detection
  let templatesPath: string | undefined
  try {
    const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim()
    const candidate = path.join(root, 'packages/core/templates')
    if (existsSync(candidate)) templatesPath = candidate
  } catch { /* not in a git repo */ }

  // Step 6: Build & write OrgConfig
  const config: OrgConfig = {
    coAuthor,
    maxConcurrentSlots: maxSlots,
    services,
    preferredStack,
    ...(templatesPath && { templatesPath }),
    ...(services.supabase?.connected && {
      memory: { provider: 'supabase' as const, crossProject: true },
    }),
    ...(services.linear?.connected && {
      issues: {
        provider: 'linear' as const,
        linearTeamId: services.linear.defaultTeamId,
        linearWorkspaceSlug: services.linear.workspaceSlug,
        planDispatch: true,
      },
    }),
    ...(services.slack?.connected && {
      notifications: { slackLevel: 'standard' as const },
    }),
    projects: base.projects || {},
  }

  writeOrgConfig(config)
  generateMotd()
  writeShellInit()

  // Step 7: Shell alias setup
  const shell = process.env.SHELL || '/bin/zsh'
  const rcFile = shell.includes('zsh') ? path.join(HOME, '.zshrc') : path.join(HOME, '.bashrc')
  const sourceLine = 'for f in ~/.traqr/aliases/*.sh(N); do [ -f "$f" ] && source "$f"; done'
  const rcContent = existsSync(rcFile) ? readFileSync(rcFile, 'utf-8') : ''

  if (!rcContent.includes('.traqr/aliases')) {
    const addIt = await confirm(`Add Traqr alias source line to ${path.basename(rcFile)}?`)
    if (addIt) {
      const motdLine = '[ -f ~/.traqr/motd.sh ] && source ~/.traqr/motd.sh'
      appendFileSync(rcFile, `\n# Traqr aliases (generated per-project by traqr init)\n${sourceLine}\n# Traqr welcome\n${motdLine}\n`)
      console.log(`  Added source line to ${path.basename(rcFile)}`)
    }
  } else if (!rcContent.includes('.traqr/motd.sh')) {
    const motdLine = '[ -f ~/.traqr/motd.sh ] && source ~/.traqr/motd.sh'
    appendFileSync(rcFile, `\n# Traqr welcome\n${motdLine}\n`)
    console.log(`  Added MOTD source line to ${path.basename(rcFile)}`)
  }

  // Step 8: Global command install (only if in Traqr source repo)
  if (templatesPath) {
    const installCommands = await confirm('Install global Traqr commands to ~/.claude/commands/?')
    if (installCommands) {
      const srcDir = path.join(path.dirname(templatesPath), '..', '..', '.claude', 'commands')
      const destDir = path.join(HOME, '.claude', 'commands')
      mkdirSync(destDir, { recursive: true })
      const globalCmds = ['traqr-init.md', 'traqr-setup.md', 'traqr-upgrade.md', 'traqr-test.md', 'traqr-projects.md']
      for (const cmd of globalCmds) {
        const src = path.join(srcDir, cmd)
        if (existsSync(src)) {
          copyFileSync(src, path.join(destDir, cmd))
          console.log(`  Installed ${cmd}`)
        }
      }
    }
  }

  // Step 9: Summary
  console.log('\nProfile saved to ~/.traqr/config.json')
  console.log(`\n  Co-author:    ${coAuthor}`)
  console.log(`  Max slots:    ${maxSlots}`)

  const svcNames = ['slack', 'linear', 'supabase', 'github', 'vercel', 'posthog', 'axiom', 'sentry', 'resend', 'cloudflare', 'firebase'] as const
  for (const name of svcNames) {
    const svc = services[name]
    const detail = svc?.projectRef ? ` (${svc.projectRef})` : svc?.workspaceSlug ? ` (${svc.workspaceSlug})` : ''
    const pad = ' '.repeat(Math.max(0, 12 - name.length))
    console.log(`  ${name}:${pad}${svc?.connected ? `connected${detail}` : 'skipped'}`)
  }

  if (templatesPath) console.log(`  Templates:    ${templatesPath}`)
  console.log(`\nNext: run "traqr init" in a project to set up Traqr.`)

  closePrompts()
}

void run()
