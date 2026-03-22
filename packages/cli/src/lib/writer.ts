/**
 * File writer with directory creation and dry-run support.
 */

import fs from 'fs/promises'
import path from 'path'

export interface WriteOptions {
  /** Print files instead of writing them */
  dryRun?: boolean
  /** Overwrite existing files */
  force?: boolean
}

export interface WriteResult {
  written: string[]
  skipped: string[]
}

/**
 * Write rendered files to disk.
 *
 * @param files - Map of relative output path -> content
 * @param baseDir - Base directory to write files into
 * @param options - dry-run and force flags
 */
export async function writeFiles(
  files: Record<string, string>,
  baseDir: string,
  options?: WriteOptions
): Promise<WriteResult> {
  const written: string[] = []
  const skipped: string[] = []

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
    try {
      await fs.access(fullPath)
      if (!options?.force) {
        skipped.push(relativePath)
        continue
      }
    } catch {
      // File doesn't exist — proceed with write
    }

    // Create parent directories
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, content, 'utf-8')
    written.push(relativePath)
  }

  return { written, skipped }
}
