/**
 * Shared prerequisites checks for CLI commands.
 * Plain English errors with install commands.
 */

import { execSync } from 'child_process'

export function checkPrerequisites(): void {
  const missing: string[] = []
  try { execSync('git --version', { stdio: 'pipe' }) } catch { missing.push('git') }
  try { execSync('node --version', { stdio: 'pipe' }) } catch { missing.push('node') }

  if (missing.length === 0) return

  console.error(`\n  Missing required tools: ${missing.join(', ')}\n`)
  if (missing.includes('git')) {
    console.error('  Git — version control (required)')
    console.error('    Mac:     brew install git')
    console.error('    Linux:   sudo apt install git')
    console.error('    Windows: https://git-scm.com/downloads\n')
  }
  if (missing.includes('node')) {
    console.error('  Node.js — JavaScript runtime (required)')
    console.error('    Install: https://nodejs.org/\n')
  }
  process.exit(1)
}

/** Check if a CLI tool is available */
export function hasCommand(cmd: string): boolean {
  try { execSync(`which ${cmd}`, { stdio: 'pipe' }); return true } catch { return false }
}
