/**
 * @traqr/core — Public API
 *
 * Config schema, template engine, and configuration resolver
 * for the Traqr platform.
 */

// Config schema — types, defaults, starter packs, design flavors, automation score
export type { DaemonConfig, GuardianConfig, TraqrConfig, DesignConfig, DesignPalette, RequiredService } from './config-schema.js'
export {
  getDefaultDaemonConfig,
  DEFAULT_GUARDIAN_CONFIG,
  REQUIRED_SERVICES,
  STARTER_PACK_DEFAULTS,
  DESIGN_FLAVOR_DEFAULTS,
  BORDER_RADIUS_MAP,
  ANIMATION_PARAMS,
  DEMO_ENV_VARS,
  PROVISIONING_TIERS,
  calculateAutomationScore,
  getProvisioningOrder,
  getProvisioningPasses,
  getDemoProvisioningState,
} from './config-schema.js'

// Template engine — slot generation, template vars, rendering
export type { TemplateVars } from './template-engine.js'
export {
  generateSlots,
  buildTemplateVars,
  buildSubAppTemplateVars,
  getFeatureFlags,
  validateTemplate,
  renderTemplate,
} from './template-engine.js'

// Config resolver — org/project config loading, 5-level hierarchy, project registry
export type { OrgConfig, ResolvedConfig, ProjectRegistryEntry } from './config-resolver.js'
export {
  deepMerge,
  mergePreferredStack,
  loadOrgConfig,
  writeOrgConfig,
  loadProjectConfig,
  resolveConfig,
  printConfigSummary,
  registerProject,
  getProjectRegistry,
  detectMonorepo,
} from './config-resolver.js'

// Skill engine — frontmatter parsing, discovery, dependency validation
export type { SkillTier, SkillCategory, SkillRequirements, SkillManifest, ValidationResult } from './skill-engine.js'
export {
  parseSkillManifest,
  loadSkills,
  resolveSkill,
  getSkillsByTier,
  getSkillsByCategory,
  validateDependencies,
} from './skill-engine.js'

// Alias generator — per-project shell alias files for multi-project support
export type { AliasGeneratorOptions } from './alias-generator.js'
export { generateAliasContent, writeAliasFile } from './alias-generator.js'

// MOTD generator — project-aware terminal welcome screen
export { generateMotd, generateMotdContent } from './motd-generator.js'

// Shell init generator — single entry point replacing legacy worktree-aliases.sh
export { generateShellInitContent, writeShellInit } from './shell-init-generator.js'

// Sub-app checklist — discovery-first provisioning for monorepo apps
export type { ChecklistStatus, SubAppChecklistItem, SubAppProvisioningPlan } from './sub-app-checklist.js'
export {
  REQUIRED_LINEAR_LABELS,
  buildSubAppChecklist,
  deriveAppChannels,
  deriveLinearTeamConfig,
  formatChecklist,
  generatePortTable,
} from './sub-app-checklist.js'

// Template loader — bundled templates, tier-gating, full render pipeline
export type { RenderResult } from './template-loader.js'
export {
  getTemplatesDir,
  listTemplates,
  loadTemplate,
  templateToOutputPath,
  shouldIncludeTemplate,
  renderAllTemplates,
  renderSubAppTemplates,
} from './template-loader.js'
