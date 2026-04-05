/**
 * Vault Generator — Obsidian Vault Initialization
 *
 * Creates the base vault structure (Projects/, Templates/) from
 * config-driven vault.path. Bundles Obsidian templates for research
 * docs, vision docs, and MOC (Map of Content) files.
 *
 * The vault templates use Obsidian Templater syntax ({{title}}, etc.)
 * — not Traqr template engine syntax ({{VAR}}).
 */

import { readdir, readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ============================================================
// Types
// ============================================================

export interface VaultInitResult {
  /** Files and directories created */
  created: string[]
  /** Files skipped (already exist) */
  skipped: string[]
  /** Errors encountered */
  errors: string[]
}

// ============================================================
// Template Directory Resolution
// ============================================================

/**
 * Returns absolute path to the bundled vault templates directory.
 * Resolves relative to this file's location — works from both
 * src/ (dev) and dist/ (compiled).
 */
function getVaultTemplatesDir(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url))
  return resolve(thisDir, '..', 'templates', 'vault')
}

// ============================================================
// Public API
// ============================================================

/**
 * Initialize an Obsidian vault with the Traqr research structure.
 *
 * Creates:
 * - Projects/           — research project folders (one per /einstein run)
 * - Templates/          — Obsidian templates for research docs, visions, MOCs
 *
 * Skips files that already exist to preserve user customizations.
 */
export async function initVault(
  vaultPath: string,
  options?: { dryRun?: boolean }
): Promise<VaultInitResult> {
  const result: VaultInitResult = { created: [], skipped: [], errors: [] }
  const absVault = resolve(vaultPath)
  const bundledDir = getVaultTemplatesDir()

  // Create PARA-style vault directories + CRM structure
  const dirs = [
    // PARA-style numbered folders
    '00 Inbox',
    '00 Inbox/Briefs',
    '00 Inbox/Clips',
    '00 Inbox/Research',
    '00 Inbox/Calls',
    '10 Wiki',
    '10 Wiki/Projects',
    '10 Wiki/Decisions',
    '10 Wiki/Learnings',
    '20 Reference',
    '20 Reference/APIs',
    '20 Reference/Architecture',
    '80 Canvas',
    '90 Bases',
    // CRM structure (for consulting pipeline)
    'CRM',
    'CRM/Clients',
    'CRM/Contacts',
    'CRM/Call Logs',
    'CRM/Projects',
    'CRM/Proposals',
    // Original directories (preserved)
    'Projects',
    'Templates',
  ]
  for (const dir of dirs) {
    const target = join(absVault, dir)
    if (!existsSync(target)) {
      if (!options?.dryRun) {
        await mkdir(target, { recursive: true })
      }
      result.created.push(dir + '/')
    } else {
      result.skipped.push(dir + '/')
    }
  }

  // Copy bundled template files from each subdirectory
  const templateDirs = ['Templates', 'Bases']
  for (const tmplDir of templateDirs) {
    try {
      const files = await listFiles(join(bundledDir, tmplDir))
      for (const file of files) {
        const vaultDir = tmplDir === 'Bases' ? '90 Bases' : tmplDir
        const target = join(absVault, vaultDir, file)
        const source = join(bundledDir, tmplDir, file)

        if (existsSync(target)) {
          result.skipped.push(`${vaultDir}/${file}`)
        } else {
          if (!options?.dryRun) {
            await mkdir(dirname(target), { recursive: true })
            const content = await readFile(source, 'utf-8')
            await writeFile(target, content, 'utf-8')
          }
          result.created.push(`${vaultDir}/${file}`)
        }
      }
    } catch (err) {
      result.errors.push(`${tmplDir}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Copy root-level vault templates (AGENTS.md, etc.)
  try {
    const rootFiles = await listFiles(bundledDir)
    for (const file of rootFiles) {
      const target = join(absVault, file)
      const source = join(bundledDir, file)

      if (existsSync(target)) {
        result.skipped.push(file)
      } else {
        if (!options?.dryRun) {
          const content = await readFile(source, 'utf-8')
          await writeFile(target, content, 'utf-8')
        }
        result.created.push(file)
      }
    }
  } catch (err) {
    result.errors.push(`Root templates: ${err instanceof Error ? err.message : String(err)}`)
  }

  return result
}

/**
 * List .md files in a directory (non-recursive).
 */
async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir)
    return entries.filter(f => f.endsWith('.md'))
  } catch {
    return []
  }
}
