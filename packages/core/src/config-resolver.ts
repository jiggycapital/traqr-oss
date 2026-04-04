/**
 * @traqr/core — Configuration Resolver
 *
 * Resolves configuration from a 5-level hierarchy (highest priority wins):
 *   1. Environment variables (TRAQR_*, GUARDIAN_*)
 *   2. Slot-level overrides (runtime context)
 *   3. Project config (.traqr/config.json)
 *   4. Organization config (~/.traqr/config.json)
 *   5. Built-in defaults
 *
 * Used by the daemon at startup and by CLI commands.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import type {
  TraqrConfig,
  DaemonConfig,
  GuardianConfig,
} from './config-schema.js'
import {
  getDefaultDaemonConfig,
  DEFAULT_GUARDIAN_CONFIG,
} from './config-schema.js'

// ============================================================
// Types
// ============================================================

/**
 * Registry entry for a Traqr-initialized project.
 * Stored in ~/.traqr/config.json under the `projects` map.
 */
export interface ProjectRegistryEntry {
  /** Absolute path to the project's main repo */
  repoPath: string;
  /** Absolute path to the project's worktrees directory */
  worktreesPath: string;
  /** Display name, e.g. "NookTraqr" */
  displayName: string;
  /** 2-char alias prefix for shell aliases, e.g. "nk" */
  aliasPrefix: string;
  /** ISO timestamp of when the project was registered */
  registeredAt: string;
}

/**
 * Organization-level config stored at ~/.traqr/config.json.
 * Shared defaults across all projects for one developer/team.
 */
export interface OrgConfig {
  /** Default co-author line for commits */
  coAuthor?: string;

  /** Registry of all Traqr-initialized projects, keyed by project slug */
  projects?: Record<string, ProjectRegistryEntry>;

  /** Slug of the primary project (gets generic z1/c1 aliases) */
  primaryProject?: string;

  /** Max concurrent Claude Code sessions across all projects */
  maxConcurrentSlots?: number;

  /** Default memory settings for new projects */
  memory?: Partial<NonNullable<TraqrConfig['memory']>>;

  /** Default issue tracker settings */
  issues?: Partial<NonNullable<TraqrConfig['issues']>>;

  /** Default notification settings */
  notifications?: Partial<NonNullable<TraqrConfig['notifications']>>;

  /** Default daemon configuration */
  daemon?: Partial<DaemonConfig>;

  /** Default guardian configuration */
  guardian?: Partial<GuardianConfig>;

  /** Default root directory for new projects (e.g., ~/Projects) */
  projectsRoot?: string;

  /** Absolute path to the traqr platform repo (e.g., ~/Traqr-Enterprises/traqr) */
  traqrRepoPath?: string;

  /** Absolute path to Traqr template directory (packages/core/templates) */
  templatesPath?: string;

  /** Service connection state recorded during /traqr-setup */
  services?: Record<string, {
    connected: boolean;
    method: 'mcp' | 'manual' | 'demo';
    connectedAt?: string;
    defaultTeamId?: string;
    workspaceSlug?: string;
    projectRef?: string;
  }>;

  /**
   * Owner's preferred stack — pre-fills alternative selections in /traqr-init.
   * Category-based: each maps to a config section. Projects inherit by default,
   * can override individually.
   */
  preferredStack?: {
    errorTracking: 'sentry' | 'axiom' | 'none';
    analytics: 'posthog';
    issueTracking: 'linear' | 'github-issues';
    email: 'resend' | 'none';
    uptime: 'checkly' | 'betterstack' | 'both' | 'none';
    observability: 'axiom' | 'none';
    edgeCompute: 'cloudflare' | 'none';
    auth: 'firebase' | 'supabase' | 'clerk' | 'custom';
    database: 'supabase' | 'firestore' | 'd1';
  };
}

/**
 * Fully resolved configuration with daemon and guardian guaranteed present.
 * This is what the daemon and CLI commands consume.
 */
export interface ResolvedConfig extends TraqrConfig {
  daemon: DaemonConfig;
  guardian: GuardianConfig;

  /** Resolution metadata — tracks where values came from */
  _resolution: {
    orgConfigPath: string | null;
    projectConfigPath: string | null;
    envOverrides: string[];
  };
}

// ============================================================
// Deep Merge Utility
// ============================================================

/**
 * Deep merge source into target, preserving target defaults for missing keys.
 * Arrays are replaced (not merged). Null/undefined source values are skipped.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function deepMerge<T extends Record<string, any>>(
  target: T,
  source: Partial<T>
): T {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sourceVal = (source as Record<string, unknown>)[key];
    if (sourceVal === undefined || sourceVal === null) continue;

    const targetVal = (result as Record<string, unknown>)[key];
    if (
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      typeof targetVal === 'object' &&
      targetVal !== null &&
      !Array.isArray(targetVal)
    ) {
      // Recurse into nested objects
      (result as Record<string, unknown>)[key] = deepMerge(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        targetVal as Record<string, any>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sourceVal as Record<string, any>
      );
    } else {
      (result as Record<string, unknown>)[key] = sourceVal;
    }
  }

  return result;
}

// ============================================================
// Config Loaders
// ============================================================

/**
 * Load organization-level config from ~/.traqr/config.json.
 * Returns null config if file doesn't exist or can't be parsed.
 */
export function loadOrgConfig(): { config: OrgConfig | null; path: string } {
  const orgPath = path.join(process.env.HOME || '', '.traqr', 'config.json');
  try {
    if (fs.existsSync(orgPath)) {
      const raw = fs.readFileSync(orgPath, 'utf-8');
      return { config: JSON.parse(raw) as OrgConfig, path: orgPath };
    }
  } catch (e) {
    console.warn(`[traqr-config] Failed to load org config from ${orgPath}:`, e);
  }
  return { config: null, path: orgPath };
}

/**
 * Write organization-level config to ~/.traqr/config.json.
 * Creates the ~/.traqr/ directory if it doesn't exist.
 */
export function writeOrgConfig(config: OrgConfig): void {
  const orgDir = path.join(process.env.HOME || '', '.traqr');
  const orgPath = path.join(orgDir, 'config.json');
  if (!fs.existsSync(orgDir)) {
    fs.mkdirSync(orgDir, { recursive: true });
  }
  fs.writeFileSync(orgPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/**
 * Register a project in the org-level registry (~/.traqr/config.json).
 * Creates the file and directory if they don't exist.
 * Upserts: if the project slug already exists, it is updated.
 */
export function registerProject(
  slug: string,
  entry: ProjectRegistryEntry,
): void {
  const { config: orgConfig } = loadOrgConfig();
  const updated: OrgConfig = orgConfig || {};
  if (!updated.projects) {
    updated.projects = {};
  }
  updated.projects[slug] = entry;
  writeOrgConfig(updated);
}

/**
 * Get the org-level project registry.
 */
export function getProjectRegistry(): Record<string, ProjectRegistryEntry> {
  const { config } = loadOrgConfig();
  return config?.projects || {};
}

/**
 * Load project-level config from .traqr/config.json.
 * Searches from projectRoot (or cwd) upward.
 */
export function loadProjectConfig(projectRoot?: string): {
  config: TraqrConfig | null;
  path: string;
} {
  const root = projectRoot || process.cwd();
  const configPath = path.join(root, '.traqr', 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      return { config: JSON.parse(raw) as TraqrConfig, path: configPath };
    }
  } catch (e) {
    console.warn(`[traqr-config] Failed to load project config from ${configPath}:`, e);
  }
  return { config: null, path: configPath };
}

// ============================================================
// Preferred Stack Merge
// ============================================================

/**
 * Apply owner's preferredStack to a project config as defaults.
 * Only fills in sections that aren't already set by the project.
 */
export function mergePreferredStack(
  config: TraqrConfig,
  preferredStack: NonNullable<OrgConfig['preferredStack']>,
): TraqrConfig {
  const merged = { ...config };

  // Error tracking → monitoring.errorTracking
  if (!merged.monitoring) {
    merged.monitoring = { errorTracking: 'none', analytics: 'none', uptime: 'none', feedbackWidget: false };
  }
  if (merged.monitoring.errorTracking === 'none' && preferredStack.errorTracking !== 'none') {
    merged.monitoring = { ...merged.monitoring, errorTracking: preferredStack.errorTracking };
  }

  // Analytics → monitoring.analytics (always posthog)
  if (merged.monitoring.analytics === 'none') {
    merged.monitoring = { ...merged.monitoring, analytics: preferredStack.analytics };
  }

  // Observability → monitoring.observability
  if (!merged.monitoring.observability && preferredStack.observability !== 'none') {
    merged.monitoring = { ...merged.monitoring, observability: preferredStack.observability };
  }

  // Uptime → monitoring.uptime
  if (merged.monitoring.uptime === 'none' && preferredStack.uptime !== 'none') {
    merged.monitoring = { ...merged.monitoring, uptime: preferredStack.uptime };
  }

  // Issue tracking → issues.provider
  if (!merged.issues) {
    const provider = preferredStack.issueTracking === 'github-issues' ? 'github' : preferredStack.issueTracking;
    merged.issues = { provider, planDispatch: true, autoLabels: true };
  }

  // Email → email.provider
  if (!merged.email && preferredStack.email !== 'none') {
    merged.email = { provider: preferredStack.email, templates: [], feedbackLoop: false };
  }

  // Edge → edge.provider
  if (!merged.edge && preferredStack.edgeCompute !== 'none') {
    merged.edge = { provider: preferredStack.edgeCompute };
  }

  // Auth → auth.provider
  if (!merged.auth) {
    merged.auth = { provider: preferredStack.auth };
  }

  return merged;
}

// ============================================================
// Environment Variable Resolution
// ============================================================

/**
 * Apply environment variable overrides to daemon config.
 * Convention: TRAQR_DAEMON_* for daemon, GUARDIAN_* for guardian.
 */
function applyDaemonEnvOverrides(config: DaemonConfig): {
  config: DaemonConfig;
  overrides: string[];
} {
  const overrides: string[] = [];
  const result = structuredClone(config);

  // API base — explicit env var, or auto-detect from app URL
  if (process.env.NOOK_API_URL || process.env.TRAQR_API_BASE) {
    result.apiBase = process.env.TRAQR_API_BASE || process.env.NOOK_API_URL || result.apiBase;
    overrides.push('daemon.apiBase');
  } else if (result.apiBase === 'http://localhost:3000/api') {
    // Default is localhost — auto-detect production URL if available
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
      || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
    if (appUrl) {
      result.apiBase = `${appUrl.replace(/\/$/, '')}/api`;
      overrides.push('daemon.apiBase (auto-detected)');
    }
  }

  // Concurrency
  if (process.env.TRAQR_MAX_CONCURRENT) {
    const val = parseInt(process.env.TRAQR_MAX_CONCURRENT, 10);
    if (!isNaN(val) && val > 0) {
      result.concurrency.maxTasks = val;
      overrides.push('daemon.concurrency.maxTasks');
    }
  }

  // Poll interval
  if (process.env.TRAQR_POLL_INTERVAL) {
    const val = parseInt(process.env.TRAQR_POLL_INTERVAL, 10);
    if (!isNaN(val) && val >= 1000) {
      result.intervals.poll = val;
      overrides.push('daemon.intervals.poll');
    }
  }

  // Guardian interval
  if (process.env.TRAQR_GUARDIAN_INTERVAL) {
    const val = parseInt(process.env.TRAQR_GUARDIAN_INTERVAL, 10);
    if (!isNaN(val) && val >= 5000) {
      result.intervals.guardian = val;
      overrides.push('daemon.intervals.guardian');
    }
  }

  // Implementation timeout
  if (process.env.TRAQR_IMPLEMENTATION_TIMEOUT) {
    const val = parseInt(process.env.TRAQR_IMPLEMENTATION_TIMEOUT, 10);
    if (!isNaN(val) && val >= 60_000) {
      result.timeouts.implementation = val;
      overrides.push('daemon.timeouts.implementation');
    }
  }

  return { config: result, overrides };
}

/**
 * Apply environment variable overrides to guardian config.
 */
function applyGuardianEnvOverrides(config: GuardianConfig): {
  config: GuardianConfig;
  overrides: string[];
} {
  const overrides: string[] = [];
  const result = structuredClone(config);

  if (process.env.GUARDIAN_ENABLED !== undefined) {
    result.enabled = process.env.GUARDIAN_ENABLED === 'true';
    overrides.push('guardian.enabled');
  }

  if (process.env.GUARDIAN_DRY_RUN !== undefined) {
    result.dryRun = process.env.GUARDIAN_DRY_RUN === 'true';
    overrides.push('guardian.dryRun');
  }

  if (process.env.GUARDIAN_PR_LABEL) {
    result.prLabel = process.env.GUARDIAN_PR_LABEL;
    overrides.push('guardian.prLabel');
  }

  return { config: result, overrides };
}

// ============================================================
// Main Resolver
// ============================================================

/**
 * Build a minimal TraqrConfig shell when no project config exists.
 * Used as the base for org-only or defaults-only resolution.
 */
function buildMinimalConfig(): TraqrConfig {
  return {
    version: '1.0.0',
    project: {
      name: '',
      displayName: '',
      description: '',
      repoPath: process.cwd(),
      worktreesPath: '',
      ghOrgRepo: '',
    },
    tier: 0,
    slots: { marketing: 1, feature: 5, bugfix: 5, devops: 5, guardian: true, analysis: false },
    ports: {
      main: 3000,
      marketingStart: 3041,
      featureStart: 3001,
      bugfixStart: 3011,
      devopsStart: 3021,
      guardian: 3031,
      analysis: 3099,
    },
    prefix: '',
    shipEnvVar: '',
    sessionPrefix: '',
    coAuthor: 'Claude Opus 4.6',
  };
}

/**
 * VCS detection result from git remote analysis.
 */
export interface VcsDetection {
  provider: 'github' | 'gitlab' | 'codecommit' | 'unknown';
  remoteUrl: string;
  orgRepo: string;
  hostname: string;
  selfHosted: boolean;
  protocol: 'ssh' | 'https' | 'unknown';
  ciConfigDetected: string | null;
}

/**
 * Corporate environment detection signals.
 */
export interface CorporateDetection {
  isLikelyCorporate: boolean;
  signals: string[];
  awsProfile: string | null;
  awsRegion: string | null;
}

/**
 * Auto-detect VCS provider from git remote origin URL.
 * Handles GitHub, GitLab (cloud + self-hosted), and CodeCommit.
 * Falls back to GitHub detection for backward compatibility.
 *
 *   https://github.com/org/repo.git        →  github, org/repo
 *   git@github.com:org/repo.git            →  github, org/repo
 *   https://gitlab.com/group/project.git   →  gitlab, group/project
 *   git@gitlab.aws.dev:group/project.git   →  gitlab (self-hosted), group/project
 *   https://git-codecommit.us-east-1...    →  codecommit
 */
export function detectVcsProvider(projectRoot?: string): VcsDetection {
  const result: VcsDetection = {
    provider: 'unknown',
    remoteUrl: '',
    orgRepo: '',
    hostname: '',
    selfHosted: false,
    protocol: 'unknown',
    ciConfigDetected: null,
  };

  try {
    const cwd = projectRoot || process.cwd();
    const url = execSync('git remote get-url origin', { cwd, timeout: 5000 })
      .toString().trim();
    result.remoteUrl = url;
    result.protocol = url.startsWith('http') ? 'https' : url.includes('@') ? 'ssh' : 'unknown';

    // GitHub (cloud)
    const githubMatch = url.match(/github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
    if (githubMatch) {
      result.provider = 'github';
      result.orgRepo = githubMatch[1];
      result.hostname = 'github.com';
      return result;
    }

    // GitLab (cloud)
    const gitlabCloudMatch = url.match(/gitlab\.com[/:](.+?)(?:\.git)?$/);
    if (gitlabCloudMatch) {
      result.provider = 'gitlab';
      result.orgRepo = gitlabCloudMatch[1];
      result.hostname = 'gitlab.com';
      return result;
    }

    // CodeCommit
    const codecommitMatch = url.match(/git-codecommit\.([\w-]+)\.amazonaws\.com.*\/(.+?)(?:\.git)?$/);
    if (codecommitMatch) {
      result.provider = 'codecommit';
      result.orgRepo = codecommitMatch[2];
      result.hostname = `git-codecommit.${codecommitMatch[1]}.amazonaws.com`;
      return result;
    }

    // GitLab (self-hosted) — detect by .gitlab-ci.yml presence or URL pattern
    // Extract hostname and path from SSH or HTTPS URL
    const sshMatch = url.match(/git@([\w.-]+):(.+?)(?:\.git)?$/);
    const httpsMatch = url.match(/https?:\/\/([\w.-]+)\/(.+?)(?:\.git)?$/);
    const hostMatch = sshMatch || httpsMatch;

    if (hostMatch) {
      const hostname = hostMatch[1];
      const orgRepo = hostMatch[2];

      // Check for .gitlab-ci.yml as a signal
      try {
        const ciPath = path.join(cwd, '.gitlab-ci.yml');
        if (fs.existsSync(ciPath)) {
          result.provider = 'gitlab';
          result.orgRepo = orgRepo;
          result.hostname = hostname;
          result.selfHosted = true;
          result.ciConfigDetected = '.gitlab-ci.yml';
          return result;
        }
      } catch { /* ignore */ }

      // Check for hostname containing 'gitlab' (e.g., gitlab.aws.dev, gitlab.company.com)
      if (hostname.includes('gitlab')) {
        result.provider = 'gitlab';
        result.orgRepo = orgRepo;
        result.hostname = hostname;
        result.selfHosted = hostname !== 'gitlab.com';
        return result;
      }

      // Fallback — unknown provider but we have the URL parsed
      result.orgRepo = orgRepo;
      result.hostname = hostname;
    }

    // Check for CI config files as additional signals
    try {
      const cwd2 = projectRoot || process.cwd();
      if (fs.existsSync(path.join(cwd2, '.gitlab-ci.yml'))) {
        result.ciConfigDetected = '.gitlab-ci.yml';
      } else if (fs.existsSync(path.join(cwd2, '.github', 'workflows'))) {
        result.ciConfigDetected = '.github/workflows';
      }
    } catch { /* ignore */ }

  } catch {
    // Not in a git repo or no remote
  }

  return result;
}

/**
 * Detect corporate environment signals.
 * Checks for AWS profiles, scoped npm registries, and VPN indicators.
 */
export function detectCorporateEnvironment(): CorporateDetection {
  const signals: string[] = [];
  let awsProfile: string | null = null;
  let awsRegion: string | null = null;

  // Check AWS profile
  if (process.env.AWS_PROFILE) {
    signals.push(`AWS_PROFILE=${process.env.AWS_PROFILE}`);
    awsProfile = process.env.AWS_PROFILE;
  }
  if (process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION) {
    awsRegion = process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || null;
    signals.push(`AWS_REGION=${awsRegion}`);
  }

  // Check for scoped npm registry (corporate artifact proxy)
  try {
    const npmrcPath = path.join(process.env.HOME || '', '.npmrc');
    if (fs.existsSync(npmrcPath)) {
      const npmrc = fs.readFileSync(npmrcPath, 'utf-8');
      if (npmrc.includes('registry=') && !npmrc.includes('registry.npmjs.org')) {
        signals.push('Custom npm registry detected');
      }
    }
  } catch { /* ignore */ }

  // Check for AWS config file
  try {
    const awsConfigPath = path.join(process.env.HOME || '', '.aws', 'config');
    if (fs.existsSync(awsConfigPath)) {
      signals.push('AWS config file present');
    }
  } catch { /* ignore */ }

  return {
    isLikelyCorporate: signals.length >= 2,
    signals,
    awsProfile,
    awsRegion,
  };
}

/**
 * Backward-compatible wrapper — returns org/repo string from VCS detection.
 * Used by existing code that calls detectGhOrgRepo().
 */
function detectGhOrgRepo(projectRoot?: string): string {
  return detectVcsProvider(projectRoot).orgRepo;
}

/**
 * Resolve full configuration from all sources.
 *
 * Priority (highest wins):
 *   1. Environment variables
 *   2. Slot-level overrides (passed at runtime)
 *   3. Project config (.traqr/config.json)
 *   4. Organization config (~/.traqr/config.json)
 *   5. Built-in defaults
 */
export function resolveConfig(options?: {
  projectRoot?: string;
  slotOverrides?: {
    daemon?: Partial<DaemonConfig>;
    guardian?: Partial<GuardianConfig>;
  };
}): ResolvedConfig {
  // 5. Start with built-in defaults
  const projectConfig = loadProjectConfig(options?.projectRoot);
  const projectName = projectConfig.config?.project?.name || '';
  let daemon = getDefaultDaemonConfig(projectName);
  let guardian = structuredClone(DEFAULT_GUARDIAN_CONFIG);

  // 4. Apply organization config
  const orgConfig = loadOrgConfig();
  if (orgConfig.config?.daemon) {
    daemon = deepMerge(daemon, orgConfig.config.daemon as Partial<DaemonConfig>);
  }
  if (orgConfig.config?.guardian) {
    guardian = deepMerge(guardian, orgConfig.config.guardian as Partial<GuardianConfig>);
  }

  // Also apply org-level TraqrConfig fields
  const base: TraqrConfig = projectConfig.config || buildMinimalConfig();

  // Fill in runtime-detected paths (not stored in committed config)
  if (!base.project.repoPath && options?.projectRoot) {
    base.project.repoPath = path.resolve(options.projectRoot);
  }
  if (!base.project.worktreesPath && base.project.repoPath) {
    base.project.worktreesPath = path.join(base.project.repoPath, '.worktrees');
  }

  if (orgConfig.config) {
    if (orgConfig.config.coAuthor && !base.coAuthor) {
      base.coAuthor = orgConfig.config.coAuthor;
    }
    if (orgConfig.config.memory && !base.memory) {
      base.memory = orgConfig.config.memory as TraqrConfig['memory'];
    }
    if (orgConfig.config.issues && !base.issues) {
      base.issues = orgConfig.config.issues as TraqrConfig['issues'];
    }
    if (orgConfig.config.notifications && !base.notifications) {
      base.notifications = orgConfig.config.notifications as TraqrConfig['notifications'];
    }
  }

  // Auto-detect ghOrgRepo from git remote if not set by config
  if (!base.project.ghOrgRepo) {
    const detected = detectGhOrgRepo(options?.projectRoot);
    if (detected) base.project.ghOrgRepo = detected;
  }

  // 3. Apply project-level daemon/guardian config
  if (projectConfig.config?.daemon) {
    daemon = deepMerge(daemon, projectConfig.config.daemon as Partial<DaemonConfig>);
  }
  if (projectConfig.config?.guardian) {
    guardian = deepMerge(guardian, projectConfig.config.guardian as Partial<GuardianConfig>);
  }

  // 2. Apply slot-level overrides
  if (options?.slotOverrides?.daemon) {
    daemon = deepMerge(daemon, options.slotOverrides.daemon as Partial<DaemonConfig>);
  }
  if (options?.slotOverrides?.guardian) {
    guardian = deepMerge(guardian, options.slotOverrides.guardian as Partial<GuardianConfig>);
  }

  // 1. Apply environment variable overrides (highest priority)
  const daemonEnv = applyDaemonEnvOverrides(daemon);
  daemon = daemonEnv.config;

  const guardianEnv = applyGuardianEnvOverrides(guardian);
  guardian = guardianEnv.config;

  const allOverrides = [...daemonEnv.overrides, ...guardianEnv.overrides];

  return {
    ...base,
    daemon,
    guardian,
    _resolution: {
      orgConfigPath: orgConfig.config ? orgConfig.path : null,
      projectConfigPath: projectConfig.config ? projectConfig.path : null,
      envOverrides: allOverrides,
    },
  } as ResolvedConfig;
}

/**
 * Print a human-readable summary of resolved config sources.
 * Useful for daemon startup logging.
 */
export function printConfigSummary(config: ResolvedConfig): string {
  const lines: string[] = [
    'Configuration resolved:',
    `  Project: ${config.project.name || '(none)'}`,
    `  Org config: ${config._resolution.orgConfigPath || '(none)'}`,
    `  Project config: ${config._resolution.projectConfigPath || '(none)'}`,
  ];

  if (config._resolution.envOverrides.length > 0) {
    lines.push(`  Env overrides: ${config._resolution.envOverrides.join(', ')}`);
  }

  lines.push(`  Daemon API: ${config.daemon.apiBase}`);
  lines.push(`  Guardian: ${config.guardian.enabled ? (config.guardian.dryRun ? 'DRY-RUN' : 'LIVE') : 'disabled'}`);
  lines.push(`  Max concurrent: ${config.daemon.concurrency.maxTasks}`);

  return lines.join('\n');
}

// ============================================================
// Monorepo Detection
// ============================================================

/**
 * Detect if the current project is a monorepo with workspace support.
 * Checks for package.json with `workspaces` field and an `apps/` directory.
 */
export function detectMonorepo(root?: string): {
  isMonorepo: boolean;
  existingApps: string[];
  existingPackages: string[];
  workspacesGlobs: string[];
} {
  const projectRoot = root || process.cwd();
  const result = {
    isMonorepo: false,
    existingApps: [] as string[],
    existingPackages: [] as string[],
    workspacesGlobs: [] as string[],
  };

  try {
    const pkgPath = path.join(projectRoot, 'package.json');
    if (!fs.existsSync(pkgPath)) return result;

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const workspaces: string[] = Array.isArray(pkg.workspaces)
      ? pkg.workspaces
      : pkg.workspaces?.packages || [];

    if (workspaces.length === 0) return result;

    // Check for apps/ directory
    const appsDir = path.join(projectRoot, 'apps');
    const hasAppsDir = fs.existsSync(appsDir) && fs.statSync(appsDir).isDirectory();
    const hasAppsWorkspace = workspaces.some(w => w.startsWith('apps'));

    if (!hasAppsDir || !hasAppsWorkspace) return result;

    result.isMonorepo = true;
    result.workspacesGlobs = workspaces;

    // List existing apps
    const appEntries = fs.readdirSync(appsDir, { withFileTypes: true });
    result.existingApps = appEntries
      .filter(e => e.isDirectory() && fs.existsSync(path.join(appsDir, e.name, 'package.json')))
      .map(e => e.name);

    // List existing packages
    const packagesDir = path.join(projectRoot, 'packages');
    if (fs.existsSync(packagesDir)) {
      const pkgEntries = fs.readdirSync(packagesDir, { withFileTypes: true });
      result.existingPackages = pkgEntries
        .filter(e => e.isDirectory() && fs.existsSync(path.join(packagesDir, e.name, 'package.json')))
        .map(e => e.name);
    }
  } catch {
    // Not a monorepo or can't read
  }

  return result;
}
