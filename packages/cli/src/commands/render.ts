/**
 * traqr render — Non-interactive template render
 *
 * Reads .traqr/config.json from cwd and renders all templates.
 * Useful for CI/CD or re-rendering after config changes.
 *
 * Flags:
 *   --dry-run    Print rendered files to stdout instead of writing
 *   --force      Overwrite existing files
 */

import fs from 'fs/promises'
import path from 'path'
import { loadProjectConfig, renderAllTemplates } from '@traqr/core'
import { writeFiles } from '../lib/writer.js'

const args = process.argv.slice(3)
const dryRun = args.includes('--dry-run')
const force = args.includes('--force')

async function run() {
  const { config, path: configPath } = loadProjectConfig()

  if (!config) {
    console.error('No .traqr/config.json found in current directory.')
    console.error('Run "traqr init" first to create a project config.')
    process.exit(1)
  }

  console.log(`Config: ${configPath}`)
  console.log(`Project: ${config.project.name} (Tier ${config.tier})`)
  console.log('')

  const result = await renderAllTemplates(config)
  const fileCount = Object.keys(result.files).length

  if (dryRun) {
    console.log(`--- Dry run: ${fileCount} files ---\n`)
  }

  const MERGEABLE_FILES = new Set(['CLAUDE.md'])

  const writeResult = await writeFiles(result.files, process.cwd(), {
    dryRun,
    force,
    mergeableFiles: force ? undefined : MERGEABLE_FILES,
  })

  if (!dryRun) {
    console.log(`Written: ${writeResult.written.length} files`)
    if (writeResult.merged.length > 0) {
      console.log(`Merged:  ${writeResult.merged.length} files (Traqr sections updated, user content preserved)`)
      for (const f of writeResult.merged) {
        console.log(`  ${f}`)
      }
    }
    if (writeResult.skipped.length > 0) {
      console.log(`Skipped: ${writeResult.skipped.length} files (use --force to overwrite)`)
      for (const f of writeResult.skipped) {
        console.log(`  ${f}`)
      }
    }
  }

  // Write global skills to ~/.claude/commands/
  const globalEntries = Object.entries(result.globalFiles)
  if (globalEntries.length > 0) {
    const home = process.env.HOME || ''
    if (dryRun) {
      console.log(`\n--- Dry run: ${globalEntries.length} global skills ---`)
      for (const [globalPath, content] of globalEntries) {
        console.log(`\n=== ${globalPath} ===`)
        console.log(content)
      }
    } else {
      for (const [globalPath, content] of globalEntries) {
        const absPath = globalPath.replace(/^~/, home)
        const exists = await fs.access(absPath).then(() => true).catch(() => false)
        if (exists && !force) {
          console.log(`Skipped global: ${globalPath} (use --force to overwrite)`)
          continue
        }
        await fs.mkdir(path.dirname(absPath), { recursive: true })
        await fs.writeFile(absPath, content as string, 'utf-8')
      }
      console.log(`Global:  ${globalEntries.length} skills -> ~/.claude/commands/`)
    }
  }

  if (result.warnings.length > 0) {
    console.log(`\nWarnings:`)
    for (const w of result.warnings) {
      console.log(`  ${w}`)
    }
  }
}

void run()
