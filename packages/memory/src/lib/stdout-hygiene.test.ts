/**
 * stdout-hygiene — ban stdout-writing calls in MCP-reachable code.
 *
 * The memory MCP serves JSON-RPC over stdio: STDOUT is the protocol channel.
 * A single non-JSON line on stdout desyncs framing — the client logs
 * "Ignoring non-JSON line on stdout" and can drop the connection (TD-927's
 * recurring manual-reconnect symptom). #2510 fixed four such calls in
 * src/lib by routing them to stderr; this test is the durable version of
 * that fix — the class can't recur unnoticed.
 *
 * Scope (code reachable from the stdio MCP process):
 *   - packages/memory/src/lib/**        (excluding *.test.ts)
 *   - packages/memory/src/vectordb/**   (excluding *.test.ts)
 *   - packages/memory/src/index.ts
 *   - packages/memory-mcp/src/**        (excluding cli/ and *.test.ts)
 *
 * Deliberately OUT of scope (stdout is the correct stream there):
 *   server.ts + routes/ (HTTP surface), migrate.ts (CLI), memory-mcp/src/cli/.
 *
 * Banned: console.log / console.info / console.debug (all alias to stdout in
 * Node) and process.stdout.write. console.error / console.warn go to stderr
 * and are the correct diagnostics channel. A deliberate pre-transport stdout
 * write (e.g. a --help/--print-* CLI early-exit block) is allowed with an
 * inline `stdout-ok` comment naming why.
 *
 * The scanner also asserts it scanned a sane number of files — a moved
 * directory or path typo must FAIL this test, not green it ("scanned 0
 * files" is the Total:0≠empty proxy trap).
 *
 * Run: npx tsx packages/memory/src/lib/stdout-hygiene.test.ts
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const memorySrc = join(__dirname, '..') // packages/memory/src
const packagesRoot = join(memorySrc, '..', '..') // packages/
const mcpSrc = join(packagesRoot, 'memory-mcp', 'src')

const BANNED = /\b(?:console\.(?:log|info|debug)|process\.stdout\.write)\s*\(/

interface Violation {
  file: string
  line: number
  text: string
}

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, files)
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(full)
    }
  }
  return files
}

function scanFile(file: string, violations: Violation[]): void {
  const lines = readFileSync(file, 'utf-8').split('\n')
  lines.forEach((line, i) => {
    const trimmed = line.trim()
    // Skip comment lines (doc examples like encryption.ts's key-gen one-liner)
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
    if (!BANNED.test(line)) return
    if (line.includes('stdout-ok')) return
    violations.push({ file, line: i + 1, text: trimmed.slice(0, 100) })
  })
}

// Collect scope
const targets: string[] = []
targets.push(...walk(join(memorySrc, 'lib')))
targets.push(...walk(join(memorySrc, 'vectordb')))
targets.push(join(memorySrc, 'index.ts'))
if (existsSync(mcpSrc)) {
  for (const entry of readdirSync(mcpSrc, { withFileTypes: true })) {
    const full = join(mcpSrc, entry.name)
    if (entry.isDirectory() && entry.name !== 'cli') {
      walk(full, targets)
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      targets.push(full)
    }
  }
}

const violations: Violation[] = []
for (const file of targets) scanFile(file, violations)

let passed = 0
let failed = 0

function assert(label: string, condition: boolean) {
  if (condition) {
    console.log(`  PASS  ${label}`)
    passed++
  } else {
    console.log(`  FAIL  ${label}`)
    failed++
  }
}

console.log(`[stdout-hygiene] scanned ${targets.length} files`)

assert(`scanned a sane file count (${targets.length} >= 20 — path typo would shrink this)`, targets.length >= 20)
assert(
  `zero stdout-writing calls in MCP-reachable code (found ${violations.length})`,
  violations.length === 0
)

if (violations.length > 0) {
  console.log('\n  Offending lines (route diagnostics to console.error, or mark deliberate')
  console.log('  pre-transport CLI writes with an inline `stdout-ok` comment):')
  for (const v of violations) {
    console.log(`    ${relative(packagesRoot, v.file)}:${v.line}  ${v.text}`)
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
