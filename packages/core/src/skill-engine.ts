/**
 * Skill Engine — Machine-Readable Skill Discovery & Validation
 *
 * Parses YAML frontmatter from .claude/commands/*.md skill files,
 * providing programmatic discovery, dependency validation, and
 * tier/category filtering.
 *
 * Uses regex-based parsing (no js-yaml dependency).
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

// ============================================================
// Types
// ============================================================

export type SkillTier = 'any' | '1' | '2' | '3'

export type SkillCategory =
  | 'core-workflow'
  | 'planning'
  | 'memory'
  | 'verification'
  | 'communication'
  | 'analysis'
  | 'system'
  | 'documentation'
  | 'infrastructure'

export interface SkillRequirements {
  env: string[]
  integrations: string[]
}

export interface SkillManifest {
  name: string
  description: string
  tier: SkillTier
  category: SkillCategory
  autoInvoked: boolean | 'cron'
  dependencies: string[]
  relatedSkills: string[]
  requirements: SkillRequirements
  /** Original file path (set by loadSkills) */
  filePath?: string
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

// ============================================================
// Frontmatter Parser (regex-based, no js-yaml dep)
// ============================================================

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/

/**
 * Parse a single YAML value — handles strings, arrays, booleans, numbers.
 * Arrays use bracket syntax: [a, b, c]
 */
function parseYamlValue(raw: string): string | boolean | string[] | number {
  const trimmed = raw.trim()

  // Boolean
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false

  // Array: [item1, item2]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim()
    if (inner === '') return []
    return inner.split(',').map(s => s.trim())
  }

  // Number
  if (/^\d+$/.test(trimmed)) return Number(trimmed)

  // String (strip optional quotes)
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

/**
 * Parse YAML frontmatter from skill file content into a flat key-value map.
 * Handles nested keys (e.g., `requirements:\n  env: [...]`) one level deep.
 */
function parseFrontmatterBlock(block: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = block.split('\n')

  let currentParent: string | null = null
  let currentNested: Record<string, unknown> = {}

  for (const line of lines) {
    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith('#')) continue

    // Nested key (2-space indent): `  env: [...]`
    const nestedMatch = line.match(/^ {2}(\w[\w-]*):\s*(.+)$/)
    if (nestedMatch && currentParent) {
      currentNested[nestedMatch[1]] = parseYamlValue(nestedMatch[2])
      continue
    }

    // Top-level key: `name: ship`
    const topMatch = line.match(/^(\w[\w-]*):\s*(.*)$/)
    if (topMatch) {
      // Flush previous nested block
      if (currentParent && Object.keys(currentNested).length > 0) {
        result[currentParent] = currentNested
      }

      const key = topMatch[1]
      const val = topMatch[2].trim()

      if (val === '' || val === undefined) {
        // Start of nested block
        currentParent = key
        currentNested = {}
      } else {
        // Flush any open parent
        if (currentParent && Object.keys(currentNested).length > 0) {
          result[currentParent] = currentNested
          currentParent = null
          currentNested = {}
        } else {
          currentParent = null
          currentNested = {}
        }
        result[key] = parseYamlValue(val)
      }
    }
  }

  // Flush final nested block
  if (currentParent && Object.keys(currentNested).length > 0) {
    result[currentParent] = currentNested
  }

  return result
}

// ============================================================
// Public API
// ============================================================

/**
 * Parse a SkillManifest from raw file content.
 * Returns null if no valid frontmatter is found.
 */
export function parseSkillManifest(content: string): SkillManifest | null {
  const match = content.match(FRONTMATTER_RE)
  if (!match) return null

  const raw = parseFrontmatterBlock(match[1])

  // Required fields
  if (!raw.name || !raw.description || !raw.tier || !raw.category) {
    return null
  }

  const req = (raw.requirements ?? {}) as Record<string, unknown>

  return {
    name: String(raw.name),
    description: String(raw.description),
    tier: String(raw.tier) as SkillTier,
    category: String(raw.category) as SkillCategory,
    autoInvoked: raw.autoInvoked === 'cron' ? 'cron' : raw.autoInvoked === true,
    dependencies: Array.isArray(raw.dependencies) ? raw.dependencies.map(String) : [],
    relatedSkills: Array.isArray(raw.relatedSkills) ? raw.relatedSkills.map(String) : [],
    requirements: {
      env: Array.isArray(req.env) ? req.env.map(String) : [],
      integrations: Array.isArray(req.integrations) ? req.integrations.map(String) : [],
    },
  }
}

/**
 * Load all skill manifests from a directory of .md files.
 */
export async function loadSkills(skillsDir: string): Promise<SkillManifest[]> {
  const entries = await readdir(skillsDir)
  const mdFiles = entries.filter(f => f.endsWith('.md'))

  const manifests: SkillManifest[] = []

  for (const file of mdFiles) {
    const filePath = join(skillsDir, file)
    const content = await readFile(filePath, 'utf-8')
    const manifest = parseSkillManifest(content)
    if (manifest) {
      manifest.filePath = filePath
      manifests.push(manifest)
    }
  }

  return manifests.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Resolve a skill by name from a loaded manifest list.
 */
export function resolveSkill(
  name: string,
  skills: SkillManifest[],
): SkillManifest | undefined {
  return skills.find(s => s.name === name)
}

/**
 * Filter skills by tier. Returns skills available at the given tier.
 * 'any' tier skills are always included. Numeric tiers include skills
 * at that tier or lower.
 */
export function getSkillsByTier(
  skills: SkillManifest[],
  tier: SkillTier,
): SkillManifest[] {
  if (tier === 'any') return [...skills]

  const tierNum = Number(tier)
  return skills.filter(s => {
    if (s.tier === 'any') return true
    return Number(s.tier) <= tierNum
  })
}

/**
 * Filter skills by category.
 */
export function getSkillsByCategory(
  skills: SkillManifest[],
  category: SkillCategory,
): SkillManifest[] {
  return skills.filter(s => s.category === category)
}

/**
 * Validate that all skill dependencies and relatedSkills reference
 * existing skills in the manifest set.
 */
export function validateDependencies(skills: SkillManifest[]): ValidationResult {
  const names = new Set(skills.map(s => s.name))
  const errors: string[] = []

  for (const skill of skills) {
    for (const dep of skill.dependencies) {
      if (!names.has(dep)) {
        errors.push(`${skill.name}: dependency '${dep}' not found`)
      }
    }
    for (const rel of skill.relatedSkills) {
      if (!names.has(rel)) {
        errors.push(`${skill.name}: relatedSkill '${rel}' not found`)
      }
    }
  }

  return { valid: errors.length === 0, errors }
}
