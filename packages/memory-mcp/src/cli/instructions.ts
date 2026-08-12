/**
 * --print-instructions — Print MEMORY_INSTRUCTIONS.md to stdout
 *
 * Users paste this into their CLAUDE.md to teach Claude
 * how to use memory proactively.
 *
 * Usage: npx traqr-memory-mcp --print-instructions
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

try {
  const content = readFileSync(join(__dirname, '..', 'MEMORY_INSTRUCTIONS.md'), 'utf-8')
  console.log(content)
} catch {
  console.error('MEMORY_INSTRUCTIONS.md not found.')
  console.error('If installed via npm, it should be at: node_modules/traqr-memory-mcp/MEMORY_INSTRUCTIONS.md')
  process.exit(1)
}
