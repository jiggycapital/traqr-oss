/**
 * traqr scaffold — Create a new DevOS monorepo from scratch
 *
 * Non-interactive-first: Claude writes config.json and runs this.
 * Interactive prompts are the human fallback.
 *
 * Usage:
 *   traqr scaffold --preset=gitlab-team --name=my-project
 *   traqr scaffold --preset=github-pro --name=my-saas --dir=~/Projects
 *   traqr scaffold   # interactive mode
 */

import fs from 'fs/promises'
import path from 'path'
import { execSync } from 'child_process'
import {
  type TraqrConfig,
  STARTER_PACK_DEFAULTS,
  GOLDEN_PATH_DEFAULTS,
  deepMerge,
  renderAllTemplates,
  calculateAutomationScore,
} from '@traqr/core'
import { writeFiles } from '../lib/writer.js'
import { ask, select, closePrompts } from '../lib/prompts.js'

type GoldenPath = keyof typeof GOLDEN_PATH_DEFAULTS
type StarterPack = keyof typeof STARTER_PACK_DEFAULTS

const RAQR_SCAFFOLD = `
╭─────────────────────────────────────────────────────────────╮
│      /\\___/\\                                                │
│     ( o   o )   Let's build your DevOS.                     │
│     (  =^=  )   This takes about 30 seconds.                │
│      (______)                                               │
╰─────────────────────────────────────────────────────────────╯
`

const args = process.argv.slice(3)
const flags = parseFlags(args)

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
  console.log(RAQR_SCAFFOLD)

  // Resolve options from flags or interactive prompts
  const preset = (flags.preset || await selectPreset()) as GoldenPath
  const name = flags.name || await ask('Project name')
  const parentDir = path.resolve(
    (flags.dir || process.cwd()).replace(/^~/, process.env.HOME || '')
  )

  const projectDir = path.join(parentDir, name)

  // Guard: don't overwrite existing directory
  try {
    await fs.access(projectDir)
    console.error(`  Directory already exists: ${projectDir}`)
    process.exit(1)
  } catch { /* good — doesn't exist */ }

  console.log(`  Project: ${name}`)
  console.log(`  Preset:  ${preset}`)
  console.log(`  Path:    ${projectDir}`)
  console.log('')

  // 1. Create directory structure
  const dirs = [
    'apps',
    'packages',
    '.traqr',
    '.worktrees',
    'scripts',
    'docs/claude',
    '.claude/commands',
  ]
  for (const dir of dirs) {
    await fs.mkdir(path.join(projectDir, dir), { recursive: true })
  }
  console.log('  Created directory structure')

  // 2. Build config from Golden Path + Starter Pack
  const golden = GOLDEN_PATH_DEFAULTS[preset]
  const starter = STARTER_PACK_DEFAULTS[golden.starterPack as StarterPack]
  const withVcs = deepMerge(starter, golden.vcsOverrides) as TraqrConfig
  const config = deepMerge(withVcs, {
    project: {
      name,
      displayName: name.charAt(0).toUpperCase() + name.slice(1),
      repoPath: projectDir,
      ghOrgRepo: '',
    },
    prefix: name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8) || 'TRQ',
    shipEnvVar: `${name.toUpperCase().replace(/[^A-Z]/g, '')}_SHIP_AUTHORIZED`,
    sessionPrefix: name.toLowerCase().replace(/[^a-z0-9]/g, ''),
    coAuthor: 'Claude Opus 4.6',
    ports: { main: 3000 },
    monorepo: { enabled: true, apps: {} },
  } as Partial<TraqrConfig>) as TraqrConfig

  // Calculate automation score
  config.automationScore = calculateAutomationScore(config)

  // 3. Write .traqr/config.json
  const configPath = path.join(projectDir, '.traqr', 'config.json')
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
  console.log('  Wrote .traqr/config.json')

  // 4. Render all templates
  const result = await renderAllTemplates(config)
  const writeResult = await writeFiles(result.files, projectDir, { force: true })
  console.log(`  Rendered ${writeResult.written.length} template files`)

  // Write global skills too (into project .claude/commands/ for now)
  const globalWriteResult = await writeFiles(
    Object.fromEntries(
      Object.entries(result.globalFiles).map(([k, v]) => [
        k.replace(/^~\/.claude\/commands\//, '.claude/commands/'), v
      ])
    ),
    projectDir,
    { force: true }
  )
  console.log(`  Rendered ${globalWriteResult.written.length} skill files`)

  // 5. Create minimal package.json + turbo.json
  const packageJson = {
    name,
    private: true,
    workspaces: ['apps/*', 'packages/*'],
    scripts: {
      'build': 'turbo build',
      'build:packages': 'turbo build --filter=./packages/*',
      'dev': 'turbo dev',
    },
    devDependencies: {
      'turbo': '^2',
      'typescript': '^5',
    },
  }
  await fs.writeFile(
    path.join(projectDir, 'package.json'),
    JSON.stringify(packageJson, null, 2) + '\n', 'utf-8'
  )

  const turboJson = {
    $schema: 'https://turbo.build/schema.json',
    tasks: {
      build: { dependsOn: ['^build'], outputs: ['dist/**'] },
      dev: { cache: false, persistent: true },
    },
  }
  await fs.writeFile(
    path.join(projectDir, 'turbo.json'),
    JSON.stringify(turboJson, null, 2) + '\n', 'utf-8'
  )
  console.log('  Wrote package.json + turbo.json')

  // 6. Git init + initial commit
  try {
    execSync('git init', { cwd: projectDir, stdio: 'pipe' })
    execSync('git add -A', { cwd: projectDir, stdio: 'pipe' })
    execSync('git commit -m "chore: scaffold DevOS monorepo via traqr scaffold"', {
      cwd: projectDir, stdio: 'pipe'
    })
    console.log('  Initialized git repository')
  } catch {
    console.log('  Git init skipped (git not available or already initialized)')
  }

  // 7. Success output
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Your DevOS is ready: ${projectDir}

  What to do next:
    cd ${projectDir}
    npm install
    npx traqr link vcs --provider=${config.vcs?.provider || 'github'}
    npx traqr render --force   # regenerate after linking

  Or just tell Claude: "Set up Traqr for my project"
  Claude reads the config, links services, and renders everything.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)

  closePrompts()
}

async function selectPreset(): Promise<string> {
  return await select('Which environment?', [
    { label: 'GitHub Pro', value: 'github-pro' as const, description: 'GitHub + Linear + Slack (production)' },
    { label: 'GitLab Team', value: 'gitlab-team' as const, description: 'GitLab + GitLab Issues + auto-merge (corporate)' },
    { label: 'GitLab Minimal', value: 'gitlab-minimal' as const, description: 'GitLab only, no integrations (solo)' },
  ])
}

void run()
