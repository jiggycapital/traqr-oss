/**
 * Skill Generator — Dual-Interface View Generation
 *
 * Converts canonical .claude/commands/ skills to .kiro/skills/ views
 * using the agentskills.io SKILL.md standard (60k+ projects).
 * Also generates AGENTS.md from CLAUDE.md.
 *
 * The canonical source is .claude/commands/ (Traqr frontmatter).
 * Generated views (.kiro/skills/, AGENTS.md) are derived — never edit them directly.
 * Pre-commit hook ensures zero drift between canonical and generated.
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { existsSync } from 'node:fs'

// ============================================================
// Types
// ============================================================

export interface GenerateResult {
  generated: string[]
  skipped: string[]
  errors: string[]
}

export interface GenerateOptions {
  /** Source directory (.claude/commands/) */
  sourceDir: string
  /** Output directory for Kiro skills (.kiro/skills/) */
  kiroSkillsDir: string
  /** Output directory for Kiro steering (.kiro/steering/) */
  kiroSteeringDir: string
  /** CLAUDE.md path → generates AGENTS.md alongside it */
  claudeMdPath?: string
  /** Dry run — report what would change without writing */
  dryRun?: boolean
}

// ============================================================
// Frontmatter Stripping
// ============================================================

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/

/** Traqr-specific frontmatter keys that don't exist in agentskills.io */
const TRAQR_ONLY_KEYS = new Set([
  'tier', 'category', 'autoInvoked', 'dependencies',
  'relatedSkills', 'requirements',
])

/**
 * Convert Traqr skill frontmatter to agentskills.io SKILL.md format.
 * Keeps: name, description (universal).
 * Strips: tier, category, dependencies, relatedSkills, requirements (Traqr-specific).
 */
function convertToAgentSkill(content: string): string {
  const fmMatch = content.match(FRONTMATTER_RE)
  if (!fmMatch) return content // no frontmatter, pass through

  const fmBlock = fmMatch[1]
  const body = content.slice(fmMatch[0].length)

  // Parse frontmatter lines, keep only universal keys
  const keptLines: string[] = []
  for (const line of fmBlock.split('\n')) {
    const keyMatch = line.match(/^(\w+):/)
    if (keyMatch && TRAQR_ONLY_KEYS.has(keyMatch[1])) continue
    keptLines.push(line)
  }

  // Rebuild with minimal frontmatter
  const newFm = keptLines.join('\n').trim()
  return newFm ? `---\n${newFm}\n---\n${body}` : body
}

// ============================================================
// Generator
// ============================================================

/**
 * Generate Kiro skill views from Claude Code commands.
 * Each .md in sourceDir becomes a .md in kiroSkillsDir with stripped frontmatter.
 */
export async function generateSkillViews(options: GenerateOptions): Promise<GenerateResult> {
  const result: GenerateResult = { generated: [], skipped: [], errors: [] }

  // Ensure output directories exist
  if (!options.dryRun) {
    await mkdir(options.kiroSkillsDir, { recursive: true })
    await mkdir(options.kiroSteeringDir, { recursive: true })
  }

  // Process skill files
  try {
    const entries = await readdir(options.sourceDir)
    const mdFiles = entries.filter(f => f.endsWith('.md'))

    for (const file of mdFiles) {
      try {
        const srcPath = join(options.sourceDir, file)
        const content = await readFile(srcPath, 'utf-8')
        const converted = convertToAgentSkill(content)

        const outPath = join(options.kiroSkillsDir, file)
        if (!options.dryRun) {
          await writeFile(outPath, converted, 'utf-8')
        }
        result.generated.push(file)
      } catch (err) {
        result.errors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } catch (err) {
    result.errors.push(`sourceDir: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Generate AGENTS.md from CLAUDE.md
  if (options.claudeMdPath && existsSync(options.claudeMdPath)) {
    try {
      const claudeMd = await readFile(options.claudeMdPath, 'utf-8')
      const agentsMd = convertClaudeToAgents(claudeMd)
      const agentsPath = join(
        options.claudeMdPath.replace(/CLAUDE\.md$/, ''),
        'AGENTS.md'
      )
      if (!options.dryRun) {
        await writeFile(agentsPath, agentsMd, 'utf-8')
      }
      result.generated.push('AGENTS.md')
    } catch (err) {
      result.errors.push(`AGENTS.md: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return result
}

/**
 * Convert CLAUDE.md to AGENTS.md (agentskills.io standard).
 * Extracts sections relevant to agent behavior, strips Traqr-internal sections.
 */
function convertClaudeToAgents(claudeMd: string): string {
  // For now: pass through with a header comment
  // Future: intelligent section extraction
  return `# AGENTS.md\n\n> Auto-generated from CLAUDE.md. Do not edit directly.\n> Regenerate with: traqr generate skills\n\n${claudeMd}`
}
