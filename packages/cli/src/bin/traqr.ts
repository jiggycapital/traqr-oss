#!/usr/bin/env node

/**
 * @traqr/cli — Entry Point
 *
 * Subcommand router. Dynamic imports keep startup fast —
 * only the command you run gets loaded.
 *
 * Universal commands only — runtime commands (daemon, memory, guardian)
 * are project-level scripts, not CLI subcommands.
 *
 * Usage:
 *   traqr init          Interactive project setup wizard
 *   traqr new           Alias for init (scaffold a new project)
 *   traqr setup         Create or update global profile (~/.traqr/config.json)
 *   traqr projects      List and manage registered projects
 *   traqr render         Render templates from .traqr/config.json
 *   traqr status         Show config summary + health
 */

const command = process.argv[2]

async function main() {
  switch (command) {
    case 'init':
    case 'new':
      await import('../commands/init.js')
      break
    case 'projects':
      await import('../commands/projects.js')
      break
    case 'setup':
      await import('../commands/setup.js')
      break
    case 'render':
      await import('../commands/render.js')
      break
    case 'link':
      await import('../commands/link.js')
      break
    case 'scaffold':
      await import('../commands/scaffold.js')
      break
    case 'status':
      await import('../commands/status.js')
      break
    case 'verify':
      await import('../commands/verify.js')
      break
    case '--help':
    case '-h':
      printUsage()
      break
    case undefined: {
      try {
        const { loadOrgConfig } = await import('@traqr/core')
        const { config } = loadOrgConfig()
        if (!config) {
          console.log(`
  Welcome to Traqr!

  Get started:
    traqr init       Set up Traqr in any project
    traqr setup      Create your global profile (optional, init can do this)
    traqr --help     See all commands
`)
          break
        }
      } catch { /* core not available, fall through */ }
      printUsage()
      break
    }
    case '--version':
    case '-v':
      console.log('0.0.1')
      break
    default:
      console.error(`Unknown command: ${command}`)
      console.error('')
      printUsage()
      process.exit(1)
  }
}

function printUsage() {
  console.log(`
  @traqr/cli v0.0.1

  Usage: traqr <command> [options]

  Commands:
    init          Interactive project setup wizard
    new           Alias for init (scaffold a new project)
    scaffold      Create a new DevOS monorepo from scratch
    link          Connect cloud services (VCS, memory, Slack, etc.)
    setup         Create or update global profile (~/.traqr/config.json)
    projects      List and manage registered projects
    render        Render templates from .traqr/config.json
    verify        Post-setup health check (config, render, memory, VCS)
    status        Show config summary + health

  Options:
    --help, -h    Show this help message
    --version, -v Show version

  Examples:
    npx traqr init
    npx traqr render --dry-run
    npx traqr status
`)
}

// Suppress unhandled rejection noise
process.on('unhandledRejection', (err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})

void main()
