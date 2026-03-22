/**
 * traqr projects — List and manage registered Traqr projects
 *
 * Usage:
 *   traqr projects              List all registered projects
 *   traqr projects primary <s>  Switch primary project
 */

import {
  loadOrgConfig,
  writeOrgConfig,
  generateMotd,
} from '@traqr/core'

const subcommand = process.argv[3]
const arg = process.argv[4]

async function run() {
  const { config: orgConfig } = loadOrgConfig()

  if (!orgConfig || !orgConfig.projects || Object.keys(orgConfig.projects).length === 0) {
    console.log(`
  No projects registered yet.

  Get started:
    traqr init       Set up Traqr in any project
    traqr setup      Create your global profile
`)
    return
  }

  const projects = orgConfig.projects
  const primarySlug = orgConfig.primaryProject
  const slugs = Object.keys(projects)

  if (subcommand === 'primary') {
    if (!arg) {
      console.error('  Usage: traqr projects primary <slug>')
      console.error(`  Available: ${slugs.join(', ')}`)
      process.exit(1)
    }
    if (!projects[arg]) {
      console.error(`  Unknown project: ${arg}`)
      console.error(`  Available: ${slugs.join(', ')}`)
      process.exit(1)
    }
    orgConfig.primaryProject = arg
    writeOrgConfig(orgConfig)
    generateMotd()
    console.log(`
  Primary project set to: ${projects[arg].displayName} (${arg})
  MOTD regenerated. Run: source ~/.zshrc
`)
    return
  }

  if (subcommand && subcommand !== 'list') {
    console.error(`  Unknown subcommand: ${subcommand}`)
    console.error('  Usage: traqr projects [primary <slug>]')
    process.exit(1)
  }

  // List projects
  console.log('')
  console.log('  Traqr Projects')
  console.log('')

  // Header
  const slugWidth = Math.max(14, ...slugs.map(s => s.length + 2))
  const nameWidth = Math.max(16, ...slugs.map(s => projects[s].displayName.length + 2))

  console.log(
    `  ${'Slug'.padEnd(slugWidth)}${'Display Name'.padEnd(nameWidth)}${'Prefix'.padEnd(10)}Primary`
  )
  console.log(
    `  ${'─'.repeat(slugWidth)}${'─'.repeat(nameWidth)}${'─'.repeat(10)}${'─'.repeat(7)}`
  )

  for (const slug of slugs) {
    const proj = projects[slug]
    const isPrimary = slug === primarySlug ? '*' : ''
    console.log(
      `  ${slug.padEnd(slugWidth)}${proj.displayName.padEnd(nameWidth)}${proj.aliasPrefix.padEnd(10)}${isPrimary}`
    )
  }

  // Paths
  console.log('')
  console.log('  Paths:')
  for (const slug of slugs) {
    const proj = projects[slug]
    const displayPath = proj.repoPath.replace(process.env.HOME || '', '~')
    console.log(`    ${slug}:  ${displayPath}`)
  }

  console.log('')
  console.log('  traqr projects primary <slug>   Switch primary project')
  console.log('')
}

void run()
