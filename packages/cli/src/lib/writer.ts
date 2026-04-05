/**
 * File writer with directory creation, dry-run support, and additive merge.
 */

import fs from 'fs/promises'
import path from 'path'
import { mergeMarkedSections } from './section-merger.js'

export interface WriteOptions {
  /** Print files instead of writing them */
  dryRun?: boolean
  /** Overwrite existing files */
  force?: boolean
  /** Files that support additive merge via section markers (e.g. CLAUDE.md) */
  mergeableFiles?: Set<string>
}

export interface WriteResult {
  written: string[]
  skipped: string[]
  /** Files that were merged (Traqr sections updated, user content preserved) */
  merged: string[]
}

/**
 * Write rendered files to disk.
 *
 * For mergeable files (like CLAUDE.md), if the file already exists,
 * Traqr-managed sections (delimited by <!-- traqr:start/end --> markers)
 * are replaced while user content between markers is preserved.
 *
 * @param files - Map of relative output path -> content
 * @param baseDir - Base directory to write files into
 * @param options - dry-run, force, and merge flags
 */
export async function writeFiles(
  files: Record<string, string>,
  baseDir: string,
  options?: WriteOptions
): Promise<WriteResult> {
  const written: string[] = []
  const skipped: string[] = []
  const merged: string[] = []

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = path.join(baseDir, relativePath)

    if (options?.dryRun) {
      console.log(`--- ${relativePath} ---`)
      console.log(content)
      console.log('')
      written.push(relativePath)
      continue
    }

    // Check if file exists
    let fileExists = false
    try {
      await fs.access(fullPath)
      fileExists = true
    } catch {
      // File doesn't exist
    }

    if (!fileExists) {
      // New file — write it
      await fs.mkdir(path.dirname(fullPath), { recursive: true })
      await fs.writeFile(fullPath, content, 'utf-8')
      written.push(relativePath)
      continue
    }

    // File exists — check merge vs skip vs force
    if (options?.force) {
      await fs.writeFile(fullPath, content, 'utf-8')
      written.push(relativePath)
      continue
    }

    if (options?.mergeableFiles?.has(relativePath)) {
      // Additive merge: preserve user content, update Traqr sections
      const existingContent = await fs.readFile(fullPath, 'utf-8')
      const result = mergeMarkedSections(existingContent, content)
      await fs.writeFile(fullPath, result.content, 'utf-8')
      merged.push(relativePath)
      continue
    }

    // Default: skip existing
    skipped.push(relativePath)
  }

  return { written, skipped, merged }
}
