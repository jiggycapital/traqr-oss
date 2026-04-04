/**
 * @traqr/core — Template Loader
 *
 * Bundles template discovery, loading, path mapping, tier-gating,
 * and the full render pipeline into a portable module.
 *
 * Extracted from src/app/api/traqr/render/route.ts so that
 * @traqr/cli and other consumers can render templates without Next.js.
 */

import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import type { TraqrConfig } from './config-schema.js'
import { buildTemplateVars, buildSubAppTemplateVars, getFeatureFlags, renderTemplate } from './template-engine.js'

// ============================================================
// Template Directory Resolution
// ============================================================

/**
 * Returns absolute path to the bundled templates/ directory.
 * Works from both src/ (dev) and dist/ (compiled) because templates/
 * lives at the package root, one level above either directory.
 */
export function getTemplatesDir(): string {
  const thisDir = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(thisDir, '..', 'templates')
}

// ============================================================
// Template Discovery
// ============================================================

/**
 * Recursively list all .tmpl files in a directory.
 * Returns relative paths like "commands/ship.md.tmpl".
 */
export async function listTemplates(dir?: string): Promise<string[]> {
  const templatesDir = dir || getTemplatesDir()
  return getTemplateFiles(templatesDir)
}

async function getTemplateFiles(dir: string, base: string = ''): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const relative = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(...await getTemplateFiles(path.join(dir, entry.name), relative))
    } else if (entry.name.endsWith('.tmpl')) {
      files.push(relative)
    }
  }

  return files
}

/**
 * Read a single template by relative path.
 */
export async function loadTemplate(relativePath: string, dir?: string): Promise<string> {
  const templatesDir = dir || getTemplatesDir()
  return fs.readFile(path.join(templatesDir, relativePath), 'utf-8')
}

// ============================================================
// Global vs Project-Local Classification
// ============================================================

/**
 * Skills that should be installed globally (~/.claude/commands/)
 * so they work across all Traqr projects.
 */
const GLOBAL_SKILLS = new Set([
  'commands/ship.md.tmpl',
  'commands/sync.md.tmpl',
  'commands/resync.md.tmpl',
  'commands/inbox.md.tmpl',
  'commands/alpha-onboard.md.tmpl',
])

/**
 * Check if a template should be rendered as a global skill.
 */
export function isGlobalSkill(templatePath: string): boolean {
  return GLOBAL_SKILLS.has(templatePath)
}

// ============================================================
// Path Mapping
// ============================================================

/**
 * Map template relative path to output path.
 * e.g. "commands/ship.md.tmpl" -> ".claude/commands/ship.md"
 *
 * For global skills, use templateToGlobalOutputPath() instead.
 */
export function templateToOutputPath(templatePath: string, prefix: string, appDir?: string): string {
  // Remove .tmpl extension
  let output = templatePath.replace(/\.tmpl$/, '')

  // Monorepo templates: strip monorepo/ prefix, output relative to appDir
  if (output.startsWith('monorepo/')) {
    const stripped = output.replace('monorepo/', '')
    if (stripped === 'companion-package.json') {
      // Companion package is handled separately
      return stripped
    }
    return appDir ? `${appDir}/${stripped}` : stripped
  }

  // scripts/aliases.sh -> scripts/<prefix>-aliases.sh
  if (output === 'scripts/aliases.sh') {
    output = `scripts/${prefix}-aliases.sh`
  }

  // Design templates -> project source
  if (output.startsWith('design/')) {
    if (output === 'design/globals.css') return 'src/app/globals.css'
    if (output === 'design/tailwind.config.ts') return 'tailwind.config.ts'
    if (output.startsWith('design/components/')) return `src/${output.replace('design/', '')}`
    return output.replace('design/', '')
  }

  // env.local.tmpl → .env.local.example
  if (output === 'env.local') return '.env.local.example'

  // schema.sql → .traqr/schema.sql
  if (output === 'schema.sql') return '.traqr/schema.sql'

  // Prefix output paths for config files
  if (output === 'CLAUDE.md' || output === 'settings.json') {
    if (output === 'settings.json') output = '.claude/settings.json'
  } else if (output.startsWith('commands/')) {
    output = `.claude/${output}`
  } else if (output.startsWith('agents/')) {
    output = `.claude/${output}`
  }

  return output
}

/**
 * Map a global skill template to its output path under ~/.claude/commands/.
 * e.g. "commands/ship.md.tmpl" -> "~/.claude/commands/ship.md"
 */
export function templateToGlobalOutputPath(templatePath: string): string {
  const output = templatePath.replace(/\.tmpl$/, '').replace(/^commands\//, '')
  return path.join('~', '.claude', 'commands', output)
}

// ============================================================
// Tier Gating
// ============================================================

/**
 * Determine if a template should be included based on tier and feature flags.
 *
 * Post-audit skill catalog (13 skills):
 * - Global (4): ship, sync, resync, inbox
 * - Project-local (4): status, analyze, slack, doctor (validate-config)
 * - Traqr infra (5): traqr-init, traqr-setup, traqr-test, traqr-upgrade, bootstrap-skills
 *
 * Removed (replaced by MCP tools / plan mode):
 * startup, context, memory, think, dispatch, draft, verify
 */
export function shouldIncludeTemplate(
  templatePath: string,
  tier: number,
  flags: Record<string, boolean>
): boolean {
  // Monorepo templates: gated on MONOREPO feature flag
  if (templatePath.startsWith('monorepo/')) {
    return flags.MONOREPO === true
  }

  // Design templates: gated on DESIGN feature flag
  if (templatePath.startsWith('design/')) {
    return flags.DESIGN === true
  }

  // Core files: always included (Tier 0+)
  const coreTemplates = [
    'commands/ship.md.tmpl',
    'commands/sync.md.tmpl',
    'commands/resync.md.tmpl',
    'commands/traqr-init.md.tmpl',
    'commands/traqr-upgrade.md.tmpl',
    'commands/traqr-setup.md.tmpl',
    'commands/traqr-test.md.tmpl',
    'commands/nextphase.md.tmpl',
    'scripts/setup-worktrees.sh.tmpl',
    'scripts/aliases.sh.tmpl',
    'scripts/pre-push-guardrail.sh.tmpl',
    'CLAUDE.md.tmpl',
    'settings.json.tmpl',
    'env.local.tmpl',
  ]
  if (coreTemplates.includes(templatePath)) return true

  // Tier 1+ (memory required)
  const tier1Memory = [
    'commands/analyze.md.tmpl',
    'commands/status.md.tmpl',
    'commands/validate-config.md.tmpl',
    'schema.sql.tmpl',
  ]
  if (tier1Memory.includes(templatePath)) return tier >= 1 && flags.MEMORY

  if (templatePath === 'commands/bootstrap-skills.md.tmpl') return tier >= 1 && flags.MEMORY_FULL

  // Tier 3+ (integrations)
  const tier3Templates: Record<string, string> = {
    'commands/slack.md.tmpl': 'SLACK',
    'commands/inbox.md.tmpl': 'SLACK',
  }
  if (tier3Templates[templatePath]) return tier >= 3 && flags[tier3Templates[templatePath]]

  // Templates not explicitly mapped: include if they exist (forward-compat)
  return true
}

// ============================================================
// Full Render Pipeline
// ============================================================

/** Result of rendering all templates for a config */
export interface RenderResult {
  /** Output path -> rendered content (project-local files) */
  files: Record<string, string>
  /** Output path -> rendered content (global ~/.claude/commands/ files) */
  globalFiles: Record<string, string>
  /** Warnings about unknown template variables, etc. */
  warnings: string[]
}

/**
 * Full render pipeline: config -> rendered files.
 *
 * Takes a TraqrConfig, discovers all templates, applies tier-gating,
 * renders each template with config-derived variables, and returns
 * the complete set of output files split into project-local and global.
 */
export async function renderAllTemplates(
  config: TraqrConfig,
  templatesDir?: string
): Promise<RenderResult> {
  const dir = templatesDir || getTemplatesDir()
  const vars = buildTemplateVars(config)
  const flags = getFeatureFlags(config)
  const tier = config.tier
  const warnings: string[] = []
  const templatePaths = await listTemplates(dir)
  const files: Record<string, string> = {}
  const globalFiles: Record<string, string> = {}

  for (const templatePath of templatePaths) {
    if (!shouldIncludeTemplate(templatePath, tier, flags)) continue
    const raw = await fs.readFile(path.join(dir, templatePath), 'utf-8')
    const rendered = renderTemplate(raw, vars, tier, flags, warnings)

    if (isGlobalSkill(templatePath)) {
      globalFiles[templateToGlobalOutputPath(templatePath)] = rendered
    } else {
      files[templateToOutputPath(templatePath, config.prefix)] = rendered
    }
  }

  return { files, globalFiles, warnings: [...new Set(warnings)] }
}

/**
 * Render only monorepo sub-app templates for a specific app.
 * Uses buildSubAppTemplateVars for per-app variable resolution.
 * Returns files keyed by output path relative to monorepo root.
 */
export async function renderSubAppTemplates(
  config: TraqrConfig,
  appSlug: string,
  templatesDir?: string,
): Promise<{ files: Record<string, string>; warnings: string[] }> {
  const dir = templatesDir || getTemplatesDir()
  const appConfig = config.monorepo?.apps?.[appSlug]
  if (!appConfig) {
    return { files: {}, warnings: [`No monorepo app config found for "${appSlug}"`] }
  }

  const vars = buildSubAppTemplateVars(config, appSlug)
  const flags = getFeatureFlags(config)
  // Enable MONOREPO flag for sub-app rendering
  flags.MONOREPO = true
  const tier = config.tier
  const warnings: string[] = []
  const templatePaths = await listTemplates(dir)
  const files: Record<string, string> = {}

  for (const templatePath of templatePaths) {
    // Only process monorepo/ templates
    if (!templatePath.startsWith('monorepo/')) continue
    if (!shouldIncludeTemplate(templatePath, tier, flags)) continue

    // Skip companion-package.json if no companion package configured
    if (templatePath.includes('companion-package') && !appConfig.companionPackage) continue

    const raw = await fs.readFile(path.join(dir, templatePath), 'utf-8')
    const rendered = renderTemplate(raw, vars, tier, flags, warnings)
    const outputPath = templateToOutputPath(templatePath, config.prefix, appConfig.appDir)
    files[outputPath] = rendered
  }

  return { files, warnings: [...new Set(warnings)] }
}
