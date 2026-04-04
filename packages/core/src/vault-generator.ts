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

  // Create top-level vault dirs
  for (const dir of ['Projects', 'Templates']) {
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

  // Copy bundled template files
  try {
    const templateFiles = await listFiles(join(bundledDir, 'Templates'))
    for (const file of templateFiles) {
      const target = join(absVault, 'Templates', file)
      const source = join(bundledDir, 'Templates', file)

      if (existsSync(target)) {
        result.skipped.push(`Templates/${file}`)
      } else {
        if (!options?.dryRun) {
          await mkdir(dirname(target), { recursive: true })
          const content = await readFile(source, 'utf-8')
          await writeFile(target, content, 'utf-8')
        }
        result.created.push(`Templates/${file}`)
      }
    }
  } catch (err) {
    result.errors.push(`Templates: ${err instanceof Error ? err.message : String(err)}`)
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
