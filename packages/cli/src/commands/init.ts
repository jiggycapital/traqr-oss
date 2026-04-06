/**
 * traqr init — Interactive project setup wizard
 *
 * Walks through project config, starter pack selection,
 * and renders all templates to disk.
 */

import path from 'path'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import { execSync } from 'child_process'
import {
  type TraqrConfig,
  type OrgConfig,
  STARTER_PACK_DEFAULTS,
  calculateAutomationScore,
  mergePreferredStack,
  renderAllTemplates,
  renderSubAppTemplates,
  loadOrgConfig,
  writeOrgConfig,
  writeAliasFile,
  registerProject,
  generateMotd,
  writeShellInit,
  detectMonorepo,
  buildSubAppChecklist,
  deriveAppChannels,
  deriveLinearTeamConfig,
  formatChecklist,
  generatePortTable,
} from '@traqr/core'
import { ask, confirm, select, info, askValidated, closePrompts } from '../lib/prompts.js'
import { writeFiles } from '../lib/writer.js'
import { checkPrerequisites } from '../lib/checks.js'

const RAQR_WELCOME = `
╭─────────────────────────────────────────────────────────────╮
│      /\\___/\\                                                │
│     ( o   o )   Hey! I'm Raqr.                              │
│     (  =^=  )   Let's set up your project.                  │
│      (______)                                               │
╰─────────────────────────────────────────────────────────────╯
`

const RAQR_SUCCESS = `
╭─────────────────────────────────────────────────────────────╮
│      /\\___/\\                                                │
│     ( ^   ^ )   You're all set!                             │
│     (  =^=  )   Time to build something amazing.            │
│      (______)                                               │
╰─────────────────────────────────────────────────────────────╯
`

const RAQR_HR = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'

// ============================================================
// Step 0 — Ensure we're in a project directory
// ============================================================

async function ensureProjectDir(): Promise<string> {
  const cwd = process.cwd()
  const home = process.env.HOME || ''
  const signals = ['.git', 'package.json', 'src', 'app', 'lib', 'pages', 'Cargo.toml', 'pyproject.toml', 'go.mod']

  let hasProject = false
  for (const s of signals) {
    try { await fs.access(path.join(cwd, s)); hasProject = true; break } catch { /* noop */ }
  }
  if (hasProject) return cwd

  console.log("  Doesn't look like you're in a project directory.\n")
  const choice = await select('What would you like to do?', [
    { label: 'Create a new project', value: 'new' as const, description: 'Pick a framework and scaffold a fresh project' },
    { label: 'Point to an existing project', value: 'navigate' as const, description: 'Enter the path to a project folder' },
    { label: 'Use this directory anyway', value: 'here' as const, description: 'Set up Traqr right here' },
  ])

  if (choice === 'here') return cwd

  if (choice === 'navigate') {
    info('Enter the full path, or drag the folder into the terminal.')
    const projectPath = await ask('Project path')
    const resolved = path.resolve(projectPath.replace(/^~/, home))
    try { await fs.access(resolved) } catch {
      console.error(`  Directory not found: ${resolved}`)
      process.exit(1)
    }
    process.chdir(resolved)
    return resolved
  }

  // 'new' — scaffold a project
  return await scaffoldNewProject()
}

async function scaffoldNewProject(): Promise<string> {
  const home = process.env.HOME || ''
  const { config: existingOrg } = loadOrgConfig()
  const suggestedRoot = existingOrg?.projectsRoot || path.join(home, 'Projects')
  const root = await ask('Where do you keep projects?', suggestedRoot)
  const resolvedRoot = path.resolve(root.replace(/^~/, home))
  await fs.mkdir(resolvedRoot, { recursive: true })

  // Save projectsRoot for next time
  if (!existingOrg?.projectsRoot) {
    writeOrgConfig({ ...existingOrg, projectsRoot: resolvedRoot })
  }

  const framework = await select('Which framework?', [
    { label: 'Next.js', value: 'nextjs' as const, description: 'React framework with App Router' },
    { label: 'Vite (React)', value: 'vite-react' as const, description: 'Fast build tool + React' },
    { label: 'Vite (Vue)', value: 'vite-vue' as const, description: 'Fast build tool + Vue' },
    { label: 'None (empty folder)', value: 'none' as const, description: 'Just git init, no framework' },
  ])

  const name = await ask('Project name')
  const projectDir = path.join(resolvedRoot, name)

  if (framework === 'none') {
    await fs.mkdir(projectDir, { recursive: true })
    execSync('git init', { cwd: projectDir, stdio: 'pipe' })
    execSync('git commit --allow-empty -m "chore: initial commit"', { cwd: projectDir, stdio: 'pipe' })
  } else {
    console.log(`\n  Scaffolding ${name}...`)
    const cmds: Record<string, string> = {
      'nextjs': `npx create-next-app@latest "${name}" --ts --tailwind --eslint --app --src-dir --use-npm`,
      'vite-react': `npm create vite@latest "${name}" -- --template react-ts`,
      'vite-vue': `npm create vite@latest "${name}" -- --template vue-ts`,
    }
    try {
      execSync(cmds[framework], { cwd: resolvedRoot, stdio: 'inherit' })
    } catch {
      console.error('  Scaffolding failed. Creating empty project instead.')
      await fs.mkdir(projectDir, { recursive: true })
    }
    // Ensure git is initialized
    if (!existsSync(path.join(projectDir, '.git'))) {
      execSync('git init', { cwd: projectDir, stdio: 'pipe' })
      execSync('git add -A && git commit -m "chore: initial scaffold"', { cwd: projectDir, stdio: 'pipe', shell: '/bin/sh' })
    }
  }

  console.log(`  Created: ${projectDir}\n`)
  process.chdir(projectDir)
  return projectDir
}

// ============================================================
// Detection helpers
// ============================================================

async function detectDefaults(): Promise<{
  repoPath: string
  ghOrgRepo: string
  packageManager: string
  framework: string
}> {
  const repoPath = process.cwd()
  let ghOrgRepo = ''
  let packageManager = 'npm'
  let framework = 'unknown'

  // Detect git remote
  try {
    const remote = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim()
    const match = remote.match(/github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/)
    if (match) ghOrgRepo = match[1]
  } catch { /* not a git repo or no remote */ }

  // Detect package manager
  try {
    await fs.access(path.join(repoPath, 'bun.lockb'))
    packageManager = 'bun'
  } catch {
    try {
      await fs.access(path.join(repoPath, 'pnpm-lock.yaml'))
      packageManager = 'pnpm'
    } catch {
      try {
        await fs.access(path.join(repoPath, 'yarn.lock'))
        packageManager = 'yarn'
      } catch { /* default: npm */ }
    }
  }

  // Detect framework
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(repoPath, 'package.json'), 'utf-8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    if (deps.next) framework = 'nextjs'
    else if (deps.nuxt) framework = 'nuxt'
    else if (deps.svelte || deps['@sveltejs/kit']) framework = 'svelte'
    else if (deps.react) framework = 'react'
    else if (deps.vue) framework = 'vue'
    else if (deps.express) framework = 'express'
    else if (deps.hono) framework = 'hono'
  } catch { /* no package.json */ }

  return { repoPath, ghOrgRepo, packageManager, framework }
}

function detectOrgServices(): {
  orgConfig: OrgConfig | null
  connectedServices: string[]
} {
  try {
    const { config } = loadOrgConfig()
    if (!config?.services) return { orgConfig: config, connectedServices: [] }
    const connectedServices = Object.entries(config.services)
      .filter(([, svc]) => svc.connected)
      .map(([name]) => name)
    return { orgConfig: config, connectedServices }
  } catch {
    return { orgConfig: null, connectedServices: [] }
  }
}

function mergeOrgDefaults(config: TraqrConfig, orgConfig: OrgConfig): TraqrConfig {
  let merged = { ...config }

  if (orgConfig.coAuthor) merged.coAuthor = orgConfig.coAuthor

  if (orgConfig.memory) {
    merged.memory = { ...merged.memory, ...orgConfig.memory } as TraqrConfig['memory']
  }

  if (orgConfig.issues) {
    merged.issues = { ...merged.issues, ...orgConfig.issues } as TraqrConfig['issues']
  }
  if (merged.issues?.provider === 'linear' && orgConfig.services?.linear) {
    const svc = orgConfig.services.linear
    if (svc.defaultTeamId) merged.issues!.linearTeamId ??= svc.defaultTeamId
    if (svc.workspaceSlug) merged.issues!.linearWorkspaceSlug ??= svc.workspaceSlug
  }

  if (orgConfig.notifications) {
    merged.notifications = { ...merged.notifications, ...orgConfig.notifications } as TraqrConfig['notifications']
  }

  if (orgConfig.daemon) {
    merged.daemon = { ...merged.daemon, ...orgConfig.daemon } as TraqrConfig['daemon']
  }
  if (orgConfig.guardian) {
    merged.guardian = { ...merged.guardian, ...orgConfig.guardian } as TraqrConfig['guardian']
  }

  // Apply preferredStack defaults for services not yet configured
  if (orgConfig.preferredStack) {
    merged = mergePreferredStack(merged, orgConfig.preferredStack)
  }

  return merged
}

// ============================================================
// Monorepo Sub-App Init
// ============================================================

async function runSubAppInit(mono: ReturnType<typeof detectMonorepo>) {
  const repoPath = process.cwd()

  // Load existing project config
  const existingConfigPath = path.join(repoPath, '.traqr', 'config.json')
  let config: TraqrConfig
  try {
    const raw = await fs.readFile(existingConfigPath, 'utf-8')
    config = JSON.parse(raw) as TraqrConfig
  } catch {
    console.error('  No .traqr/config.json found. Run traqr init first for the root project.')
    process.exit(1)
  }

  // Load org config for service connection info
  const { orgConfig } = detectOrgServices()

  // Display parent config summary
  const parentTier = config.tier
  const parentScore = config.automationScore ?? calculateAutomationScore(config)
  const sharedInfra: string[] = []
  if (config.memory?.provider === 'supabase') sharedInfra.push('Supabase')
  if (config.issues?.provider === 'linear') sharedInfra.push('Linear')
  if (config.notifications?.slackLevel && config.notifications.slackLevel !== 'none') sharedInfra.push('Slack')
  if (config.monitoring?.analytics === 'posthog') sharedInfra.push('PostHog')
  if (config.edge?.provider === 'cloudflare') sharedInfra.push('Cloudflare')
  if (config.memory?.crossProject) sharedInfra.push('Memory')

  console.log(`\n  Parent: ${config.project.displayName} (Tier ${parentTier}, Score ${parentScore}/100)`)
  if (sharedInfra.length > 0) {
    console.log(`  Shared infra: ${sharedInfra.join(', ')}`)
  }

  // App name
  const appName = await ask('App name (slug, e.g. "pokotraqr")')
  const appDisplayName = await ask('Display name', appName)
  const appDir = `apps/${appName}`

  // Check if app directory already exists
  if (existsSync(path.join(repoPath, appDir))) {
    console.error(`  Directory ${appDir} already exists.`)
    process.exit(1)
  }

  // Calculate port offset from existing app count
  const portOffset = mono.existingApps.length * 1000
  console.log(`\n  Port offset: ${portOffset} (feature1 port: ${3001 + portOffset})`)

  // Build the provisioning checklist
  const plan = buildSubAppChecklist(config, orgConfig, appName, appDisplayName)

  // Derive expected per-app resources
  const aliasGuess = appName.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 2)
  const slackChannelPrefix = await ask('Slack channel prefix (2-3 chars)', aliasGuess)
  const derivedChannels = deriveAppChannels(config, slackChannelPrefix)
  const derivedLinear = config.issues?.provider === 'linear'
    ? deriveLinearTeamConfig(config, appName)
    : null

  // Display checklist preview
  console.log(`\n  Provisioning checklist for ${appDisplayName}:`)
  console.log(formatChecklist(plan))

  // Auth provider
  const authProvider = await select('Auth provider for this app:', [
    { label: 'None', value: 'none' as const, description: 'No auth (add later)' },
    { label: 'Clerk', value: 'clerk' as const, description: 'Drop-in auth with Clerk' },
    { label: 'Firebase', value: 'firebase' as const, description: 'Firebase Authentication' },
    { label: 'Supabase Auth', value: 'supabase' as const, description: 'Supabase built-in auth' },
    { label: 'Custom', value: 'custom' as const, description: 'Roll your own' },
  ])

  // Companion data package
  const wantCompanion = await confirm('Create a companion data package?', false)
  let companionPackage: string | undefined
  let companionDir: string | undefined
  if (wantCompanion) {
    const companionName = await ask('Package name', `@${appName}/data`)
    companionPackage = companionName
    companionDir = `packages/${companionName.replace(/^@/, '').replace('/', '-')}`
  }

  // Build workspace deps
  const baseDeps = ['@traqr/core']
  if (companionPackage) baseDeps.push(companionPackage)
  const workspaceDeps = baseDeps

  // Add monorepo section if not present
  if (!config.monorepo) {
    config.monorepo = {
      enabled: true,
      appDirs: mono.existingApps.map(a => `apps/${a}`),
      apps: {},
    }
    for (let i = 0; i < mono.existingApps.length; i++) {
      const existing = mono.existingApps[i]
      config.monorepo.apps[existing] = {
        displayName: existing,
        appDir: `apps/${existing}`,
        portOffset: i * 1000,
        workspaceDeps: ['@traqr/core'],
      }
    }
  }

  // Add the new app with per-app service fields
  config.monorepo.apps[appName] = {
    displayName: appDisplayName,
    appDir: appDir,
    portOffset,
    auth: { provider: authProvider },
    framework: 'nextjs',
    workspaceDeps,
    companionPackage,
    slackChannelPrefix,
    slackChannels: derivedChannels,
    linearTeamId: derivedLinear ? undefined : undefined, // populated by Claude via MCP
    ticketPrefix: derivedLinear?.ticketPrefix,
  }
  config.monorepo.appDirs.push(appDir)

  // Update linearTeamMap if Linear is used
  if (derivedLinear && config.issues) {
    if (!config.issues.linearTeamMap) {
      config.issues.linearTeamMap = {}
      // Register parent team
      if (config.issues.ticketPrefix && config.issues.linearTeamId) {
        config.issues.linearTeamMap[config.issues.ticketPrefix] = config.issues.linearTeamId
      }
    }
    // New app entry will be populated by Claude via MCP during provisioning
  }

  // Update channelPrefixMap if Slack is used
  if (slackChannelPrefix && config.issues) {
    if (!config.issues.channelPrefixMap) {
      config.issues.channelPrefixMap = {}
      if (config.issues.ticketPrefix && config.notifications?.slackChannelPrefix) {
        config.issues.channelPrefixMap[config.issues.ticketPrefix] = config.notifications.slackChannelPrefix
      }
    }
    if (derivedLinear) {
      config.issues.channelPrefixMap[derivedLinear.ticketPrefix] = slackChannelPrefix
    }
  }

  // Preview
  console.log(`\n  Will create:`)
  console.log(`    ${appDir}/  (Next.js app)`)
  if (companionDir) console.log(`    ${companionDir}/  (data package)`)
  console.log(`    Port offset: ${portOffset}`)
  console.log(`    Auth: ${authProvider}`)
  console.log(`    Slack prefix: ${slackChannelPrefix}`)
  if (derivedLinear) console.log(`    Ticket prefix: ${derivedLinear.ticketPrefix}`)
  console.log(`    Deps: ${workspaceDeps.join(', ')}`)

  if (Object.keys(derivedChannels).length > 0) {
    console.log(`\n  Expected Slack channels:`)
    for (const [purpose, channel] of Object.entries(derivedChannels)) {
      console.log(`    ${purpose}: ${channel}`)
    }
  }

  const proceed = await confirm('\nProceed?')
  if (!proceed) {
    console.log('Aborted.')
    process.exit(0)
  }

  // Render sub-app templates
  console.log('\nRendering sub-app templates...')
  const result = await renderSubAppTemplates(config, appName)
  if (result.warnings.length > 0) {
    for (const w of result.warnings) console.log(`  Warning: ${w}`)
  }

  // Create app directory structure
  await fs.mkdir(path.join(repoPath, appDir, 'src', 'app'), { recursive: true })

  // Write rendered files
  for (const [filePath, content] of Object.entries(result.files)) {
    if (filePath === 'companion-package.json' && companionDir) {
      await fs.mkdir(path.join(repoPath, companionDir, 'src'), { recursive: true })
      await fs.writeFile(path.join(repoPath, companionDir, 'package.json'), content, 'utf-8')
      console.log(`  ${companionDir}/package.json`)

      const companionTsconfig = JSON.stringify({
        extends: '../../tsconfig.base.json',
        compilerOptions: {
          outDir: './dist',
          rootDir: './src',
          declaration: true,
        },
        include: ['src'],
        exclude: ['node_modules', 'dist'],
      }, null, 2)
      await fs.writeFile(path.join(repoPath, companionDir, 'tsconfig.json'), companionTsconfig, 'utf-8')
      console.log(`  ${companionDir}/tsconfig.json`)

      await fs.writeFile(
        path.join(repoPath, companionDir, 'src', 'index.ts'),
        `/**\n * ${appDisplayName} shared data layer\n */\n\nexport {}\n`,
        'utf-8'
      )
      console.log(`  ${companionDir}/src/index.ts`)
      continue
    }

    const absPath = path.join(repoPath, filePath)
    await fs.mkdir(path.dirname(absPath), { recursive: true })
    await fs.writeFile(absPath, content, 'utf-8')
    console.log(`  ${filePath}`)
  }

  // Create minimal src/app/page.tsx
  const pagePath = path.join(repoPath, appDir, 'src', 'app', 'page.tsx')
  if (!existsSync(pagePath)) {
    await fs.writeFile(pagePath, `export default function Home() {\n  return (\n    <main>\n      <h1>${appDisplayName}</h1>\n      <p>Powered by Traqr</p>\n    </main>\n  );\n}\n`, 'utf-8')
    console.log(`  ${appDir}/src/app/page.tsx`)
  }

  // Create minimal src/app/layout.tsx
  const layoutPath = path.join(repoPath, appDir, 'src', 'app', 'layout.tsx')
  if (!existsSync(layoutPath)) {
    await fs.writeFile(layoutPath, `export const metadata = {\n  title: '${appDisplayName}',\n  description: '${appDisplayName} — powered by Traqr',\n};\n\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (\n    <html lang="en">\n      <body>{children}</body>\n    </html>\n  );\n}\n`, 'utf-8')
    console.log(`  ${appDir}/src/app/layout.tsx`)
  }

  // Update root tsconfig.json references
  const rootTsconfigPath = path.join(repoPath, 'tsconfig.json')
  try {
    const rootTsconfig = JSON.parse(await fs.readFile(rootTsconfigPath, 'utf-8'))
    const refs: Array<{ path: string }> = rootTsconfig.references || []
    if (!refs.some(r => r.path === appDir)) {
      refs.push({ path: appDir })
      rootTsconfig.references = refs
      await fs.writeFile(rootTsconfigPath, JSON.stringify(rootTsconfig, null, 2) + '\n', 'utf-8')
      console.log(`  Updated tsconfig.json references`)
    }
    if (companionDir && !refs.some(r => r.path === companionDir)) {
      refs.push({ path: companionDir })
      rootTsconfig.references = refs
      await fs.writeFile(rootTsconfigPath, JSON.stringify(rootTsconfig, null, 2) + '\n', 'utf-8')
      console.log(`  Added ${companionDir} to tsconfig.json references`)
    }
  } catch {
    console.warn('  Warning: could not update root tsconfig.json')
  }

  // Save updated config
  await fs.writeFile(existingConfigPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
  console.log(`  Updated .traqr/config.json`)

  // Port allocation table
  console.log('\nPort allocation:')
  console.log(generatePortTable(config))

  // Summary: show what Claude should do next via the skill template
  console.log(`\nScaffolding complete! The /traqr-init skill will now guide you through`)
  console.log(`MCP-based discovery and wiring for each service.`)
  console.log(`\nRun "npm install" to wire workspace dependencies.`)
  console.log(`Worktrees are shared — no new slots needed.`)
}

// ============================================================
// Main
// ============================================================

async function run() {
  checkPrerequisites()

  console.log(RAQR_WELCOME)

  // Step 0: Ensure we're in a project directory
  await ensureProjectDir()

  const defaults = await detectDefaults()

  // Detect monorepo context
  const mono = detectMonorepo()
  if (mono.isMonorepo) {
    console.log(`  Monorepo detected! Found ${mono.existingApps.length} app(s): ${mono.existingApps.join(', ')}`)
    if (mono.existingPackages.length > 0) {
      console.log(`  Packages: ${mono.existingPackages.join(', ')}`)
    }
    console.log('')

    const monoChoice = await select('What would you like to do?', [
      { label: 'Add a new app to this monorepo', value: 'sub-app' as const, description: 'Scaffold a new app in apps/' },
      { label: 'Configure this monorepo as standalone', value: 'standalone' as const, description: 'Standard Traqr init for the root project' },
    ])

    if (monoChoice === 'sub-app') {
      await runSubAppInit(mono)
      closePrompts()
      return
    }
    // else: fall through to standard init
  }

  // Detect org profile and services
  const { orgConfig, connectedServices } = detectOrgServices()

  if (orgConfig && connectedServices.length > 0) {
    console.log(`\n  Global profile detected. These services carry over:`)
    if (orgConfig.coAuthor) console.log(`    Co-author: ${orgConfig.coAuthor}`)
    const svcDetails: string[] = []
    if (orgConfig.services?.slack?.connected) svcDetails.push('Slack')
    if (orgConfig.services?.linear?.connected) svcDetails.push(`Linear (${orgConfig.services.linear.workspaceSlug || 'connected'})`)
    if (orgConfig.services?.supabase?.connected) svcDetails.push(`Supabase (${orgConfig.services.supabase.projectRef || 'connected'})`)
    if (svcDetails.length > 0) console.log(`    Services: ${svcDetails.join(', ')}`)
    console.log('')

    const customize = await confirm('Want to change anything for this project?', false)
    if (customize) {
      console.log('  (Per-project service customization coming soon. Using global defaults.)')
    }
  }

  // Inline minimal setup if no global profile
  if (!orgConfig) {
    console.log('  No global profile found.\n')
    const coAuthor = await ask('Co-author for git commits', 'Claude Opus 4.6')
    writeOrgConfig({ coAuthor, maxConcurrentSlots: 3, projects: {} })
    console.log('  Saved to ~/.traqr/config.json\n')
  }

  // Basic project info
  const projectName = await ask('Project name', path.basename(defaults.repoPath))
  const displayName = await ask('Display name', projectName)
  const description = await ask('Description', `${displayName} — powered by Traqr`)
  const ghOrgRepo = await ask('GitHub org/repo', defaults.ghOrgRepo)

  // Prefix validation + explanation
  info('Short code for your project (used in shell commands like z1, c1).\n  Example: "nk" for NookTraqr.')
  const prefix = await askValidated(
    'Project prefix (2-6 chars)',
    projectName.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 4),
    (input) => {
      const v = input.toLowerCase()
      if (v.length < 2) return { valid: false, message: 'Must be at least 2 characters.', suggestion: projectName.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 4) }
      if (v.length > 6) return { valid: false, message: '6 characters max.', suggestion: v.slice(0, 6) }
      if (!/^[a-z][a-z0-9]*$/.test(v)) return { valid: false, message: 'Lowercase letters and numbers only, starting with a letter.', suggestion: v.replace(/[^a-z0-9]/g, '').slice(0, 6) || 'tp' }
      return { valid: true }
    },
  )

  // Starter pack selection with plain-English descriptions
  const starterPack = await select('Choose a starter pack:', [
    { label: 'Solo', value: 'solo' as const,
      description: 'Just you and Claude. Parallel workspaces, clean git workflow.' },
    { label: 'Smart', value: 'smart' as const,
      description: 'Adds project memory + issue tracking. Claude remembers past decisions.' },
    { label: 'Production', value: 'production' as const,
      description: 'Team notifications, error tracking, analytics. For apps with users.' },
    { label: 'Full', value: 'full' as const,
      description: 'Everything on. Autonomous agents, all integrations, full ops.' },
  ])

  const packDefaults = STARTER_PACK_DEFAULTS[starterPack]
  const repoPath = defaults.repoPath
  const worktreesPath = `${repoPath}/.worktrees`

  // Build the config
  let config: TraqrConfig = {
    version: '1.0.0',
    project: {
      name: projectName,
      displayName,
      description,
      repoPath,
      worktreesPath,
      ghOrgRepo,
      framework: defaults.framework,
      packageManager: defaults.packageManager,
      buildCommand: `${defaults.packageManager} run build`,
      typecheckCommand: `${defaults.packageManager} run typecheck`,
      deployPlatform: 'none',
    },
    tier: packDefaults.tier ?? 0,
    starterPack,
    slots: packDefaults.slots ?? { feature: 3, bugfix: 1, devops: 0, analysis: false },
    ports: {
      main: 3000,
      featureStart: 3001,
      bugfixStart: 3011,
      devopsStart: 3021,
      analysis: 3099,
    },
    prefix,
    shipEnvVar: `${prefix.toUpperCase()}_SHIP_AUTHORIZED`,
    sessionPrefix: prefix.toUpperCase(),
    coAuthor: 'Claude Opus 4.6',
    memory: packDefaults.memory as TraqrConfig['memory'],
    issues: packDefaults.issues as TraqrConfig['issues'],
    notifications: packDefaults.notifications as TraqrConfig['notifications'],
    monitoring: packDefaults.monitoring as TraqrConfig['monitoring'],
    email: packDefaults.email as TraqrConfig['email'],
    crons: packDefaults.crons as TraqrConfig['crons'],
    daemon: packDefaults.daemon as TraqrConfig['daemon'],
    guardian: packDefaults.guardian as TraqrConfig['guardian'],
  }

  // Custom slot counts for power users
  const customizeSlots = await confirm('Customize slot counts? (skip for defaults)', false)
  if (customizeSlots) {
    const totalRam = (() => { try { return parseInt(execSync('sysctl -n hw.memsize 2>/dev/null', { encoding: 'utf-8' }).trim()) / (1024 ** 3) } catch { return 16 } })()
    const rec = totalRam >= 128 ? 15 : totalRam >= 64 ? 10 : totalRam >= 32 ? 7 : totalRam >= 16 ? 5 : 3
    console.log(`  Your machine has ~${Math.round(totalRam)}GB RAM. Recommended: ${rec} feature slots.`)
    const featureStr = await ask(`Feature slots (${config.slots.feature}):`, String(config.slots.feature))
    const bugfixStr = await ask(`Bugfix slots (${config.slots.bugfix}):`, String(config.slots.bugfix))
    const devopsStr = await ask(`DevOps slots (${config.slots.devops}):`, String(config.slots.devops))
    config.slots.feature = Math.max(1, parseInt(featureStr) || config.slots.feature)
    config.slots.bugfix = Math.max(0, parseInt(bugfixStr) || config.slots.bugfix)
    config.slots.devops = Math.max(0, parseInt(devopsStr) || config.slots.devops)
    // Widen port ranges if slot counts exceed default gaps of 10
    const maxSlots = Math.max(config.slots.feature, config.slots.bugfix, config.slots.devops)
    if (maxSlots > 9) {
      const gap = maxSlots + 1
      config.ports.featureStart = 3001
      config.ports.bugfixStart = 3001 + gap
      config.ports.devopsStart = 3001 + gap * 2
      console.log(`  Port ranges widened: feature ${config.ports.featureStart}+, bugfix ${config.ports.bugfixStart}+, devops ${config.ports.devopsStart}+`)
    }
  }

  // Always merge org defaults if they exist
  if (orgConfig) {
    config = mergeOrgDefaults(config, orgConfig)
  }

  config.automationScore = calculateAutomationScore(config)

  // Render templates
  console.log('\nRendering templates...')
  const result = await renderAllTemplates(config)
  const fileCount = Object.keys(result.files).length
  const globalCount = Object.keys(result.globalFiles).length

  // Grouped file preview
  const categories: Record<string, string[]> = { Skills: [], Scripts: [], Config: [], Design: [], Other: [] }
  for (const fp of Object.keys(result.files).sort()) {
    if (fp.startsWith('.claude/commands/')) categories.Skills.push(fp)
    else if (fp.startsWith('scripts/')) categories.Scripts.push(fp)
    else if (fp.startsWith('src/components/') || fp.includes('globals.css') || fp.includes('tailwind')) categories.Design.push(fp)
    else if (fp.startsWith('src/') || fp.startsWith('.')) categories.Other.push(fp)
    else categories.Config.push(fp)
  }

  const verbose = process.argv.includes('--verbose')
  console.log(`\n${fileCount} project files will be generated:`)
  for (const [cat, files] of Object.entries(categories)) {
    if (files.length === 0) continue
    if (verbose) {
      console.log(`  ${cat}:`)
      for (const f of files) console.log(`    ${f}`)
    } else {
      console.log(`  ${cat}: ${files.length} file${files.length > 1 ? 's' : ''}`)
    }
  }
  if (globalCount > 0) console.log(`  Global skills: ${globalCount} files -> ~/.claude/commands/`)
  if (!verbose && fileCount > 8) console.log('  (run with --verbose to see full list)')

  if (result.warnings.length > 0) {
    console.log(`\nWarnings:`)
    for (const w of result.warnings) {
      console.log(`  ${w}`)
    }
  }

  console.log(`\nAutomation score: ${config.automationScore}/100`)
  console.log(`Starter pack: ${starterPack} (Tier ${config.tier})`)

  const proceed = await confirm('\nWrite files to disk?')
  if (!proceed) {
    console.log('Aborted.')
    closePrompts()
    process.exit(0)
  }

  // Write config
  const configDir = path.join(repoPath, '.traqr')
  await fs.mkdir(configDir, { recursive: true })
  await fs.writeFile(
    path.join(configDir, 'config.json'),
    JSON.stringify(config, null, 2),
    'utf-8'
  )
  console.log('  .traqr/config.json')

  // Write rendered files
  const writeResult = await writeFiles(result.files, repoPath, {
    force: false,
    mergeableFiles: new Set(['CLAUDE.md']),
  })

  // Write global skills to ~/.claude/commands/
  const globalEntries = Object.entries(result.globalFiles)
  if (globalEntries.length > 0) {
    const home = process.env.HOME || ''
    for (const [globalPath, content] of globalEntries) {
      const absPath = globalPath.replace(/^~/, home)
      await fs.mkdir(path.dirname(absPath), { recursive: true })
      await fs.writeFile(absPath, content, 'utf-8')
    }
    console.log(`  Global skills: ${globalEntries.length} files -> ~/.claude/commands/`)
  }

  console.log(`\nDone!`)
  console.log(`  Written: ${writeResult.written.length} files`)
  if (writeResult.skipped.length > 0) {
    console.log(`  Skipped ${writeResult.skipped.length} existing files (use --force to overwrite):`)
    for (const f of writeResult.skipped) console.log(`    ${f}`)
  }

  try {
    registerProject(projectName, {
      repoPath,
      worktreesPath,
      displayName,
      aliasPrefix: prefix,
      registeredAt: new Date().toISOString(),
    })
    console.log(`  Registered in ~/.traqr/config.json`)
  } catch {
    console.warn('  Warning: could not register project in ~/.traqr/config.json')
  }

  // Generate alias file
  const home = process.env.HOME || ''
  const { config: latestOrg } = loadOrgConfig()
  const isPrimary = !latestOrg?.primaryProject || latestOrg.primaryProject === projectName
  writeAliasFile(config, { isPrimary })
  console.log(`  Alias file written to ~/.traqr/aliases/${projectName}.sh`)

  // Generate MOTD
  generateMotd()
  console.log('  MOTD updated at ~/.traqr/motd.sh')

  // Generate shell-init.sh (single entry point)
  writeShellInit()
  console.log('  Shell init written to ~/.traqr/shell-init.sh')

  // Shell integration setup
  const shell = process.env.SHELL || '/bin/zsh'
  const rcFile = shell.includes('zsh') ? path.join(home, '.zshrc') : path.join(home, '.bashrc')
  const rcContent = await fs.readFile(rcFile, 'utf-8').catch(() => '')
  const hasShellInit = rcContent.includes('.traqr/shell-init.sh')
  const hasLegacy = rcContent.includes('worktree-aliases.sh')
  const hasOldAliases = rcContent.includes('.traqr/aliases') && !hasShellInit

  if (hasLegacy) {
    // Legacy migration: offer to replace worktree-aliases.sh with shell-init.sh
    const migrate = await confirm('Legacy shell config detected (worktree-aliases.sh). Replace with generated Traqr shell-init?')
    if (migrate) {
      // Comment out the legacy line and add the new one
      const updatedRc = rcContent
        .split('\n')
        .map(line => (line.includes('worktree-aliases.sh') && !line.startsWith('#')) ? `# ${line}  # replaced by Traqr shell-init` : line)
        .join('\n')
      // Also remove old .traqr/aliases sourcing if present (shell-init.sh handles it)
      const cleanedRc = updatedRc
        .split('\n')
        .map(line => (line.includes('.traqr/aliases') && !line.startsWith('#')) ? `# ${line}  # handled by shell-init.sh` : line)
        .join('\n')
      const finalRc = cleanedRc
        .split('\n')
        .map(line => (line.includes('.traqr/motd.sh') && !line.startsWith('#')) ? `# ${line}  # handled by shell-init.sh` : line)
        .join('\n')
      const separator = finalRc.endsWith('\n') ? '' : '\n';
      await fs.writeFile(rcFile, finalRc + separator + `\n# Traqr shell init (generated)\nsource ~/.traqr/shell-init.sh\n`, 'utf-8')
      console.log(`  Migrated ${path.basename(rcFile)}: legacy lines commented, shell-init.sh added`)
    } else {
      info('Both may conflict. Run "traqr render" after removing the legacy line.')
    }
  } else if (hasOldAliases && !hasShellInit) {
    // Old-style .traqr/aliases sourcing — upgrade to shell-init.sh
    const upgrade = await confirm('Upgrade shell config to use single shell-init.sh entry point?')
    if (upgrade) {
      const updatedRc = rcContent
        .split('\n')
        .map(line => {
          if (line.includes('.traqr/aliases') && !line.startsWith('#')) return `# ${line}  # handled by shell-init.sh`
          if (line.includes('.traqr/motd.sh') && !line.startsWith('#')) return `# ${line}  # handled by shell-init.sh`
          return line
        })
        .join('\n')
      const sep = updatedRc.endsWith('\n') ? '' : '\n';
      await fs.writeFile(rcFile, updatedRc + sep + `\n# Traqr shell init (generated)\nsource ~/.traqr/shell-init.sh\n`, 'utf-8')
      console.log(`  Upgraded ${path.basename(rcFile)} to use shell-init.sh`)
    }
  } else if (!hasShellInit) {
    const addInit = await confirm('Add Traqr shell-init to your shell?')
    if (addInit) {
      await fs.appendFile(rcFile, `\n# Traqr shell init (generated)\nsource ~/.traqr/shell-init.sh\n`)
      console.log(`  Added to ${path.basename(rcFile)}`)
    } else {
      info('Add manually later:\n  echo \'source ~/.traqr/shell-init.sh\' >> ' + path.basename(rcFile))
    }
  } else {
    console.log('  Shell init already configured.')
  }

  // Offer to create worktrees
  const createWorktrees = await confirm('Create worktrees now?')
  if (createWorktrees) {
    try {
      execSync(`bash "${path.join(repoPath, 'scripts', 'setup-worktrees.sh')}"`, { stdio: 'inherit' })
    } catch {
      console.error('  Worktree setup had an error. Run manually:')
      console.error(`  bash "${path.join(repoPath, 'scripts', 'setup-worktrees.sh')}"`)
    }
  } else {
    info(`Create worktrees later:\n  bash "${repoPath}/scripts/setup-worktrees.sh"`)
  }

  console.log(RAQR_SUCCESS)
  console.log(`Raqr · traqr init                         Traqr · ${displayName}`)
  console.log(RAQR_HR)
  console.log('')
  console.log('  Claude Code configured:')
  console.log('    .claude/settings.json — hooks + permissions')
  console.log(`    .claude/commands/     — ${globalEntries.length > 0 ? globalEntries.length + ' skills installed' : 'skills ready'}`)
  console.log(`    .traqr/config.json    — Tier ${config.tier} (${config.starterPack})`)
  console.log('    CLAUDE.md             — project intelligence')
  console.log('')
  console.log('  Next steps:')
  console.log('    1. Reload shell:       source ~/.traqr/shell-init.sh')
  console.log('    2. Open Claude Code:   claude')
  console.log('    3. Set up integrations: /alpha-onboard')
  console.log('    4. Check connections:   npx traqr verify')
  console.log('')
  console.log(RAQR_HR)

  closePrompts()
}

void run()
