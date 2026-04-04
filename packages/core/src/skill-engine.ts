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
  /** Where this skill was discovered from (set by loadAllSkills) */
  source?: 'platform' | 'workspace'
}

/**
 * Extended manifest for composable system skills (traqr-system-*.md).
 * Adds system identity, config ownership, and mode capabilities.
 */
export interface SystemSkillManifest extends SkillManifest {
  /** Config section key this system manages (e.g., 'config', 'worktrees') */
  system: string
  /** Which TraqrConfig key this skill reads/writes */
  configSection: string
  /** Supported execution modes */
  capabilities: {
    setup: boolean
    audit: boolean
    upgrade: boolean
  }
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
 * Load skills from multiple directories with workspace-wins-on-collision merging.
 * Platform skills (.claude/commands/) are loaded first, then workspace skills
 * (workspaces/<name>/skills/) override on name collision.
 *
 * This enables SalesOS skills to coexist with Traqr platform skills
 * in the same monorepo, with workspace-specific skills taking precedence.
 */
export async function loadAllSkills(options: {
  platformDir: string
  workspaceDirs?: string[]
}): Promise<SkillManifest[]> {
  // Load platform skills
  const platform = await loadSkills(options.platformDir)
  for (const s of platform) s.source = 'platform'

  // Load workspace skills
  const workspace: SkillManifest[] = []
  for (const dir of options.workspaceDirs ?? []) {
    try {
      const skills = await loadSkills(dir)
      for (const s of skills) s.source = 'workspace'
      workspace.push(...skills)
    } catch {
      // Skip missing workspace dirs — not all workspaces have skills
    }
  }

  // Merge: workspace wins on name collision
  const byName = new Map<string, SkillManifest>()
  for (const s of platform) byName.set(s.name, s)
  for (const s of workspace) byName.set(s.name, s)

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
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

// ============================================================
// System Skill Discovery (traqr-system-*.md)
// ============================================================

/**
 * Parse a SystemSkillManifest from raw file content.
 * Returns null if the file isn't a valid system skill (missing frontmatter
 * or category !== 'system').
 */
export function parseSystemSkillManifest(content: string): SystemSkillManifest | null {
  const base = parseSkillManifest(content)
  if (!base) return null
  if (base.category !== 'system') return null

  // Re-parse frontmatter to extract system-specific fields
  const match = content.match(FRONTMATTER_RE)
  if (!match) return null
  const raw = parseFrontmatterBlock(match[1])

  const caps = (raw.capabilities ?? {}) as Record<string, unknown>

  return {
    ...base,
    system: String(raw.system ?? ''),
    configSection: String(raw.configSection ?? ''),
    capabilities: {
      setup: caps.setup === true,
      audit: caps.audit === true,
      upgrade: caps.upgrade === true,
    },
  }
}

/**
 * Load all system skill manifests from a directory.
 * Discovers files matching `traqr-system-*.md` and parses their frontmatter.
 */
export async function loadSystemSkills(skillsDir: string): Promise<SystemSkillManifest[]> {
  const entries = await readdir(skillsDir)
  const systemFiles = entries.filter(f => f.startsWith('traqr-system-') && f.endsWith('.md'))

  const manifests: SystemSkillManifest[] = []
  for (const file of systemFiles) {
    const filePath = join(skillsDir, file)
    const content = await readFile(filePath, 'utf-8')
    const manifest = parseSystemSkillManifest(content)
    if (manifest) {
      manifest.filePath = filePath
      manifests.push(manifest)
    }
  }

  return manifests.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Topologically sort system skills by their dependency graph.
 * Skills with no dependencies come first. If a skill depends on another,
 * the dependency is guaranteed to appear earlier in the result.
 */
export function topologicalSort(skills: SystemSkillManifest[]): SystemSkillManifest[] {
  const nameMap = new Map(skills.map(s => [s.name, s]))
  const visited = new Set<string>()
  const result: SystemSkillManifest[] = []

  function visit(name: string) {
    if (visited.has(name)) return
    visited.add(name)
    const skill = nameMap.get(name)
    if (!skill) return
    for (const dep of skill.dependencies) {
      visit(dep)
    }
    result.push(skill)
  }

  for (const skill of skills) {
    visit(skill.name)
  }

  return result
}
