/**
 * @traqr/core — Template Engine
 *
 * Template variable generation, slot derivation, feature flags,
 * and the render engine for {{VAR}} / {{#IF_TIER}} / {{#IF_FEATURE}} templates.
 */

import type { TraqrConfig } from './config-schema.js'
import { calculateAutomationScore, BORDER_RADIUS_MAP, ANIMATION_PARAMS, DESIGN_FLAVOR_DEFAULTS } from './config-schema.js'

/**
 * Template variables derived from TraqrConfig.
 * Used by the template engine to replace {{VAR}} placeholders.
 */
export interface TemplateVars {
  PROJECT_NAME: string;
  PROJECT_DISPLAY_NAME: string;
  PROJECT_DESCRIPTION: string;
  REPO_PATH: string;
  WORKTREES_PATH: string;
  GH_ORG_REPO: string;
  SHIP_ENV_VAR: string;
  SESSION_PREFIX: string;
  PREFIX: string;
  PREFIX_UPPER: string;
  CO_AUTHOR: string;
  TIER: string;
  STARTER_PACK: string;
  AUTOMATION_SCORE: string;
  FRAMEWORK: string;
  PACKAGE_MANAGER: string;
  BUILD_COMMAND: string;
  TYPECHECK_COMMAND: string;
  DEPLOY_PLATFORM: string;

  // Memory
  MEMORY_API_BASE: string;
  MEMORY_PROVIDER: string;
  TRAQR_PROJECT_SLUG: string;

  // Vault
  VAULT_PATH: string;

  // Multi-project isolation
  KV_PREFIX: string;
  ALIAS_PREFIX: string;

  // Derived env var names
  CRON_SECRET_VAR: string;
  INTERNAL_API_KEY_VAR: string;

  // Project API (control-center, daemon, webhooks — separate from shared memory API)
  PROJECT_API_BASE: string;
  GUARDIAN_PR_LABEL: string;
  TICKET_PREFIX: string;

  // Issues
  LINEAR_TEAM_ID: string;
  LINEAR_WORKSPACE_SLUG: string;
  ISSUE_PROVIDER: string;

  // VCS (Version Control System)
  VCS_PROVIDER: string;
  VCS_PROJECT_ID: string;
  VCS_BASE_URL: string;
  VCS_REPO_URL: string;
  VCS_MR_URL_PREFIX: string;
  VCS_PR_NOUN: string;
  VCS_PR_NOUN_LONG: string;

  // Slack (prefix + channels)
  SLACK_LEVEL: string;
  SLACK_CHANNEL_PREFIX: string;
  SLACK_DEPLOY_CHANNEL: string;
  SLACK_TRIAGE_CHANNEL: string;
  SLACK_ANALYTICS_CHANNEL: string;
  SLACK_FEEDBACK_CHANNEL: string;
  SLACK_MARKETING_CHANNEL: string;
  SLACK_ARCHIVE_CHANNEL: string;
  SLACK_IDEAS_CHANNEL: string;
  SLACK_MEMORY_CHANNEL: string;
  SLACK_SIGNUPS_CHANNEL: string;
  SLACK_CONTROL_CENTER_CHANNEL: string;
  SLACK_DASHBOARD_CHANNEL: string;

  // Monitoring
  ERROR_TRACKING: string;
  ANALYTICS_PROVIDER: string;
  UPTIME_PROVIDER: string;

  // Email
  EMAIL_PROVIDER: string;

  // Design DNA
  DESIGN_FLAVOR: string;
  DESIGN_PRIMARY: string;
  DESIGN_SECONDARY: string;
  DESIGN_ACCENT: string;
  DESIGN_BG: string;
  DESIGN_FG: string;
  DESIGN_CARD: string;
  DESIGN_BORDER: string;
  DESIGN_MUTED: string;
  DESIGN_DARK_BG: string;
  DESIGN_DARK_FG: string;
  DESIGN_DARK_CARD: string;
  DESIGN_DARK_BORDER: string;
  DESIGN_DARK_MUTED: string;
  DESIGN_FONT_SANS: string;
  DESIGN_FONT_MONO: string;
  DESIGN_GOOGLE_FONTS: string;
  DESIGN_RADIUS_SM: string;
  DESIGN_RADIUS_MD: string;
  DESIGN_RADIUS_LG: string;
  DESIGN_RADIUS_CARD: string;
  DESIGN_TRANSITION_DURATION: string;
  DESIGN_ENTRANCE_Y: string;
  DESIGN_HOVER_LIFT: string;
  DESIGN_HOVER_SCALE: string;
  DESIGN_SPRING_STIFFNESS: string;
  DESIGN_SPRING_DAMPING: string;
  DESIGN_SHADOW_LEVEL: string;
  DESIGN_APP_DISPLAY_NAME: string;

  // Co-author email (extracted from coAuthor string)
  CO_AUTHOR_EMAIL: string;

  // Demo mode
  DEMO_MODE: string;

  // Monorepo routing (root CLAUDE.md)
  MONOREPO_APP_TABLE: string;
  MONOREPO_TICKET_PREFIXES: string;

  // Monorepo sub-app variables
  IS_MONOREPO: string;
  APP_DIR: string;
  APP_NAME: string;
  APP_DISPLAY_NAME: string;
  MONOREPO_ROOT: string;
  TRANSPILE_PACKAGES: string;
  WORKSPACE_DEPS: string;
  COMPANION_PACKAGE: string;
  PORT_OFFSET: string;
  APP_PORT: string;
  AUTH_PROVIDER: string;

  // Per-app service overrides (populated for sub-app init)
  LINEAR_APP_TEAM_ID: string;
  LINEAR_APP_TICKET_PREFIX: string;
  SLACK_APP_CHANNEL_PREFIX: string;
  APP_SLACK_DEPLOY_CHANNEL: string;
  APP_SLACK_TRIAGE_CHANNEL: string;
  APP_SLACK_ANALYTICS_CHANNEL: string;

  // Branding blocks (Raqr the Raccoon — 13 moods)
  RAQR_ART_WELCOME: string;
  RAQR_ART_CELEBRATE: string;
  RAQR_ART_ALERT: string;
  RAQR_ART_STRAINING: string;
  RAQR_ART_THINKING: string;
  RAQR_ART_EXCITED: string;
  RAQR_ART_SLEEPY: string;
  RAQR_ART_DIZZY: string;
  RAQR_ART_SAD: string;
  RAQR_ART_CURIOUS: string;
  RAQR_ART_RELIEVED: string;
  RAQR_ART_GREEDY: string;
  RAQR_ART_LOVING: string;

  // Frame elements
  RAQR_FRAME_START: string;
  RAQR_FRAME_END: string;
  RAQR_HR: string;
  RAQR_HR_MEDIUM: string;

  // Progress indicators (0-7 dots, plus failure)
  RAQR_PROGRESS_0: string;
  RAQR_PROGRESS_1: string;
  RAQR_PROGRESS_2: string;
  RAQR_PROGRESS_3: string;
  RAQR_PROGRESS_4: string;
  RAQR_PROGRESS_5: string;
  RAQR_PROGRESS_6: string;
  RAQR_PROGRESS_7: string;
  RAQR_PROGRESS_FAIL: string;

  // Generated blocks (built from slot config)
  SLOT_TABLE: string;
  SLOT_TABLE_PRINTF: string;
  SLOT_BASH_ARRAY: string;
  SLOT_PATHS: string;
  PORT_TABLE: string;
  SLOT_ALIASES_JUMP: string;
  SLOT_ALIASES_CLAUDE: string;
  SLOT_PORT_EXPORTS: string;
  SLOT_PORT_CASES: string;
  SLOT_RESET_CASES: string;
  SLOT_STATUS_ROWS: string;
  SLOT_HELP_SUMMARY: string;
}

/**
 * Generate a slot list from config.
 * Returns array of { name, branch, port } for all configured slots.
 */
export function generateSlots(config: TraqrConfig): Array<{
  name: string;
  branch: string;
  port: number;
  category: 'marketing' | 'feature' | 'bugfix' | 'devops' | 'guardian' | 'analysis';
}> {
  const slots: Array<{
    name: string;
    branch: string;
    port: number;
    category: 'marketing' | 'feature' | 'bugfix' | 'devops' | 'guardian' | 'analysis';
  }> = [];

  for (let i = 1; i <= (config.slots.marketing || 0); i++) {
    slots.push({
      name: `marketing${i}`,
      branch: `marketing/slot-${i}`,
      port: (config.ports.marketingStart || 3041) + (i - 1),
      category: 'marketing',
    });
  }

  for (let i = 1; i <= config.slots.feature; i++) {
    slots.push({
      name: `feature${i}`,
      branch: `feature/slot-${i}`,
      port: config.ports.featureStart + (i - 1),
      category: 'feature',
    });
  }

  for (let i = 1; i <= config.slots.bugfix; i++) {
    slots.push({
      name: `bugfix${i}`,
      branch: `bugfix/slot-${i}`,
      port: config.ports.bugfixStart + (i - 1),
      category: 'bugfix',
    });
  }

  for (let i = 1; i <= config.slots.devops; i++) {
    slots.push({
      name: `devops${i}`,
      branch: `devops/slot-${i}`,
      port: config.ports.devopsStart + (i - 1),
      category: 'devops',
    });
  }

  if (config.slots.guardian) {
    slots.push({
      name: 'grunt',
      branch: 'main',
      port: config.ports.guardian || 3031,
      category: 'guardian',
    });
  }

  if (config.slots.analysis) {
    slots.push({
      name: 'analysis',
      branch: 'analysis/active',
      port: config.ports.analysis,
      category: 'analysis',
    });
  }

  return slots;
}

/**
 * Build template variables from a TraqrConfig.
 * This is used by the /traqr-init wizard to generate all files.
 */
export function buildTemplateVars(config: TraqrConfig): TemplateVars {
  const slots = generateSlots(config);
  const p = config.prefix || 'traqr';
  const P = p.toUpperCase();

  // Build SLOT_TABLE (markdown)
  const slotTableRows = slots
    .map((s) => `| ${s.name.padEnd(12)} | ${s.branch.padEnd(20)} | ${s.port} |`)
    .join('\n');
  const SLOT_TABLE = `| Slot         | Branch               | Port |\n|--------------|----------------------|------|\n${slotTableRows}`;

  // Build SLOT_TABLE_PRINTF (for bash printf formatting)
  const printfRows = slots
    .map((s) => `  printf "  %-12s %-20s %s\\n" "${s.name}" "${s.branch}" "${s.port}"`)
    .join('\n');
  const SLOT_TABLE_PRINTF = printfRows;

  // Build SLOT_BASH_ARRAY
  const SLOT_BASH_ARRAY = slots.map((s) => `"${s.name}:${s.branch}"`).join(' ');

  // Build SLOT_PATHS
  const SLOT_PATHS = slots
    .map(
      (s) => `  ${s.name.padEnd(12)} → .worktrees/${s.name}  (port ${s.port})`
    )
    .join('\n');

  // Build PORT_TABLE
  const portTableRows = slots
    .map((s) => `| ${s.name.padEnd(12)} | ${s.port}  | http://localhost:${s.port} |`)
    .join('\n');
  const PORT_TABLE = `| Slot         | Port  | URL                       |\n|--------------|-------|---------------------------|\n| main         | ${config.ports.main}  | http://localhost:${config.ports.main} |\n${portTableRows}`;

  // Build SLOT_ALIASES_JUMP (z aliases)
  const jumpAliases: string[] = [];
  const marketingSlots = slots.filter((s) => s.category === 'marketing');
  const featureSlots = slots.filter((s) => s.category === 'feature');
  const bugfixSlots = slots.filter((s) => s.category === 'bugfix');
  const devopsSlots = slots.filter((s) => s.category === 'devops');
  const guardianSlots = slots.filter((s) => s.category === 'guardian');

  marketingSlots.forEach((s, i) => {
    jumpAliases.push(`alias zk${i + 1}='cd "$${P}_WORKTREES/${s.name}" && pwd'`);
  });
  featureSlots.forEach((s, i) => {
    jumpAliases.push(`alias z${i + 1}='cd "$${P}_WORKTREES/${s.name}" && pwd'`);
  });
  bugfixSlots.forEach((s, i) => {
    jumpAliases.push(`alias zb${i + 1}='cd "$${P}_WORKTREES/${s.name}" && pwd'`);
  });
  devopsSlots.forEach((s, i) => {
    jumpAliases.push(`alias zd${i + 1}='cd "$${P}_WORKTREES/${s.name}" && pwd'`);
  });
  if (guardianSlots.length > 0) {
    jumpAliases.push(`alias zg='cd "$${P}_WORKTREES/grunt" && pwd'`);
  }
  if (config.slots.analysis) {
    jumpAliases.push(`alias za='cd "$${P}_WORKTREES/analysis" && pwd'`);
  }
  const SLOT_ALIASES_JUMP = jumpAliases.join('\n');

  // Build SLOT_ALIASES_CLAUDE (c aliases)
  const claudeAliases: string[] = [];
  marketingSlots.forEach((s, i) => {
    claudeAliases.push(`alias ck${i + 1}='cd "$${P}_WORKTREES/${s.name}" && claude'`);
  });
  featureSlots.forEach((s, i) => {
    claudeAliases.push(`alias c${i + 1}='cd "$${P}_WORKTREES/${s.name}" && claude'`);
  });
  bugfixSlots.forEach((s, i) => {
    claudeAliases.push(`alias cb${i + 1}='cd "$${P}_WORKTREES/${s.name}" && claude'`);
  });
  devopsSlots.forEach((s, i) => {
    claudeAliases.push(`alias cd${i + 1}='cd "$${P}_WORKTREES/${s.name}" && claude'`);
  });
  if (guardianSlots.length > 0) {
    claudeAliases.push(`alias cg='cd "$${P}_WORKTREES/grunt" && claude'`);
  }
  if (config.slots.analysis) {
    claudeAliases.push(`alias ca='cd "$${P}_WORKTREES/analysis" && claude'`);
  }
  const SLOT_ALIASES_CLAUDE = claudeAliases.join('\n');

  // Build SLOT_PORT_EXPORTS
  const portExports = [
    `export ${P}_PORT_MAIN=${config.ports.main}`,
    ...slots.map(
      (s) => `export ${P}_PORT_${s.name.toUpperCase()}=${s.port}`
    ),
  ].join('\n');
  const SLOT_PORT_EXPORTS = portExports;

  // Build SLOT_PORT_CASES (for nook-dev/prefix-dev function)
  const portCases = slots
    .map((s) => `        *${s.name}*) port=$${P}_PORT_${s.name.toUpperCase()}; slot="${s.name}" ;;`)
    .join('\n');
  const SLOT_PORT_CASES = portCases;

  // Build SLOT_RESET_CASES (for nook-reset/prefix-reset function)
  const resetCases = slots
    .map((s) => `        ${s.name}) branch="${s.branch}" ;;`)
    .join('\n');
  const SLOT_RESET_CASES = resetCases;

  // Build SLOT_STATUS_ROWS
  const statusRows = slots
    .map((s) => `"${s.name}:${s.branch}"`)
    .join(' ');
  const SLOT_STATUS_ROWS = statusRows;

  // Build SLOT_HELP_SUMMARY (dynamic help text for aliases)
  const helpParts: string[] = [];
  const helpClaudeParts: string[] = [];
  if (marketingSlots.length > 0) {
    const max = marketingSlots.length;
    helpParts.push(`zk1${max > 1 ? `-zk${max}` : ''} (marketing)`);
    helpClaudeParts.push(`ck1${max > 1 ? `-ck${max}` : ''}`);
  }
  if (featureSlots.length > 0) {
    const max = featureSlots.length;
    helpParts.push(`z1${max > 1 ? `-z${max}` : ''} (feature)`);
    helpClaudeParts.push(`c1${max > 1 ? `-c${max}` : ''}`);
  }
  if (bugfixSlots.length > 0) {
    const max = bugfixSlots.length;
    helpParts.push(`zb1${max > 1 ? `-zb${max}` : ''} (bugfix)`);
    helpClaudeParts.push(`cb1${max > 1 ? `-cb${max}` : ''}`);
  }
  if (devopsSlots.length > 0) {
    const max = devopsSlots.length;
    helpParts.push(`zd1${max > 1 ? `-zd${max}` : ''} (devops)`);
    helpClaudeParts.push(`cd1${max > 1 ? `-cd${max}` : ''}`);
  }
  if (guardianSlots.length > 0) {
    helpParts.push('zg (grunt)');
    helpClaudeParts.push('cg');
  }
  if (config.slots.analysis) {
    helpParts.push('za (analysis)');
    helpClaudeParts.push('ca');
  }
  const SLOT_HELP_SUMMARY = `Aliases: ${helpParts.join(', ')}\\n     Claude:  ${helpClaudeParts.join(', ')}`;

  // Build Raqr branding blocks (13 moods)
  const raqrBase = (eyes: string, line1: string, line2?: string) => {
    const lines = [
      '│      /\\___/\\                                                │',
      `│     ( ${eyes} )   ${(line1).padEnd(47)}│`,
      `│     (  =^=  )   ${(line2 ?? '').padEnd(47)}│`,
      '│      (______)                                               │',
    ];
    return lines.join('\n');
  };

  const RAQR_FRAME_START = '╭─────────────────────────────────────────────────────────────╮';
  const RAQR_FRAME_END =   '╰─────────────────────────────────────────────────────────────╯';

  const RAQR_ART_WELCOME = raqrBase('o   o', 'Hey! Ready to build?', 'Loading your context...');
  const RAQR_ART_CELEBRATE = raqrBase('^   ^', 'Shipped!', 'Clean build. That\'s the good stuff.');
  const RAQR_ART_ALERT = raqrBase('!   !', 'Something needs attention', 'See details below');
  const RAQR_ART_STRAINING = raqrBase('>   <', 'Working on it...', 'Give me a sec.');
  const RAQR_ART_THINKING = raqrBase('~   ~', 'Searching...', 'Checking the stash.');
  const RAQR_ART_EXCITED = raqrBase('*   *', 'First time running this!', 'Here\'s what it does.');
  const RAQR_ART_SLEEPY = raqrBase('-   -', 'All quiet...', 'Ready when you are.');
  const RAQR_ART_DIZZY = raqrBase('@   @', 'Merge conflict!', 'Let me untangle this.');
  const RAQR_ART_SAD = raqrBase('T   T', 'Build failed...', 'But I can see what\'s wrong.');
  const RAQR_ART_CURIOUS = raqrBase('?   ?', 'Quick question...', 'Need a little info first.');
  const RAQR_ART_RELIEVED = raqrBase(';   ;', 'Close call!', 'Crisis averted.');
  const RAQR_ART_GREEDY = raqrBase('$   $', 'Score going up!', 'Momentum is real.');
  const RAQR_ART_LOVING = raqrBase('\u2665   \u2665', 'I remembered this one!', 'Raccoons never forget.');

  const RAQR_HR = '\u2501'.repeat(60);
  const RAQR_HR_MEDIUM = '\u2500'.repeat(62);

  // Progress indicators
  const RAQR_PROGRESS_0 = '\u25CB \u25CB \u25CB \u25CB \u25CB \u25CB \u25CB  Starting...';
  const RAQR_PROGRESS_1 = '\u25CF \u25CB \u25CB \u25CB \u25CB \u25CB \u25CB  Gathering...';
  const RAQR_PROGRESS_2 = '\u25CF \u25CF \u25CB \u25CB \u25CB \u25CB \u25CB  Checking...';
  const RAQR_PROGRESS_3 = '\u25CF \u25CF \u25CF \u25CB \u25CB \u25CB \u25CB  Committing...';
  const RAQR_PROGRESS_4 = '\u25CF \u25CF \u25CF \u25CF \u25CB \u25CB \u25CB  Building...';
  const RAQR_PROGRESS_5 = '\u25CF \u25CF \u25CF \u25CF \u25CF \u25CB \u25CB  Pushing...';
  const RAQR_PROGRESS_6 = '\u25CF \u25CF \u25CF \u25CF \u25CF \u25CF \u25CB  Creating PR...';
  const RAQR_PROGRESS_7 = '\u25CF \u25CF \u25CF \u25CF \u25CF \u25CF \u25CF  All done!';
  const RAQR_PROGRESS_FAIL = '\u25CF \u25CF \u25CF \u2717 \u25CB \u25CB \u25CB  Failed';

  // Design DNA variables
  const designFlavor = config.design?.flavor ?? 'minimal';
  const designDefaults = designFlavor !== 'custom'
    ? DESIGN_FLAVOR_DEFAULTS[designFlavor as keyof typeof DESIGN_FLAVOR_DEFAULTS]
    : undefined;
  const design = config.design ?? designDefaults ?? DESIGN_FLAVOR_DEFAULTS.minimal;
  const radiusLevel = design.borderRadius ?? 'medium';
  const radius = BORDER_RADIUS_MAP[radiusLevel];
  const animLevel = design.animations ?? 'subtle';
  const anim = ANIMATION_PARAMS[animLevel];

  // Derive framework/package manager/build commands with sensible defaults
  const framework = config.project.framework ?? 'unknown';
  const packageManager = config.project.packageManager ?? 'npm';
  const buildCommand = config.project.buildCommand ?? `${packageManager} run build`;
  const typecheckCommand = config.project.typecheckCommand ?? `${packageManager} run typecheck`;
  const deployPlatform = config.project.deployPlatform ?? 'none';
  const chanPrefix = config.notifications?.slackChannelPrefix ?? config.aliasPrefix ?? 'dev';

  return {
    PROJECT_NAME: config.project.name,
    PROJECT_DISPLAY_NAME: config.project.displayName,
    PROJECT_DESCRIPTION: config.project.description,
    REPO_PATH: config.project.repoPath,
    WORKTREES_PATH: config.project.worktreesPath,
    GH_ORG_REPO: config.project.ghOrgRepo,
    SHIP_ENV_VAR: config.shipEnvVar,
    SESSION_PREFIX: config.sessionPrefix,
    PREFIX: p,
    PREFIX_UPPER: P,
    CO_AUTHOR: config.coAuthor,
    CO_AUTHOR_EMAIL: (config.coAuthor?.match(/<(.+?)>/) || ['', 'dev@example.com'])[1],
    TIER: String(config.tier),
    STARTER_PACK: config.starterPack ?? 'custom',
    AUTOMATION_SCORE: String(config.automationScore ?? calculateAutomationScore(config)),
    FRAMEWORK: framework,
    PACKAGE_MANAGER: packageManager,
    BUILD_COMMAND: buildCommand,
    TYPECHECK_COMMAND: typecheckCommand,
    DEPLOY_PLATFORM: deployPlatform,
    MEMORY_API_BASE: config.memory?.apiBase ?? '',
    MEMORY_PROVIDER: config.memory?.provider ?? 'none',
    TRAQR_PROJECT_SLUG: config.memory?.projectSlug ?? config.project.name,
    VAULT_PATH: config.vault?.path ?? '',
    KV_PREFIX: config.kvPrefix ?? config.project.name,
    ALIAS_PREFIX: config.aliasPrefix ?? config.prefix.slice(0, 2),
    CRON_SECRET_VAR: `${P}_CRON_SECRET`,
    INTERNAL_API_KEY_VAR: `${P}_INTERNAL_API_KEY`,
    PROJECT_API_BASE: config.daemon?.apiBase || config.memory?.apiBase || 'http://localhost:3000/api',
    GUARDIAN_PR_LABEL: config.guardian?.prLabel || 'daemon-pr',
    TICKET_PREFIX: config.issues?.ticketPrefix || config.project.name.toUpperCase().slice(0, 3) || 'TRQ',
    LINEAR_TEAM_ID: config.issues?.linearTeamId ?? '',
    LINEAR_WORKSPACE_SLUG: config.issues?.linearWorkspaceSlug ?? '',
    ISSUE_PROVIDER: config.issues?.provider ?? 'none',

    // VCS
    VCS_PROVIDER: config.vcs?.provider ?? 'github',
    VCS_PROJECT_ID: config.vcs?.projectId ?? '',
    VCS_BASE_URL: config.vcs?.baseUrl ?? (config.vcs?.provider === 'gitlab' ? 'https://gitlab.com' : 'https://github.com'),
    VCS_REPO_URL: config.vcs?.provider === 'gitlab'
      ? `${config.vcs?.baseUrl ?? 'https://gitlab.com'}/${config.project.ghOrgRepo}`
      : `https://github.com/${config.project.ghOrgRepo}`,
    VCS_MR_URL_PREFIX: config.vcs?.provider === 'gitlab'
      ? `${config.vcs?.baseUrl ?? 'https://gitlab.com'}/${config.project.ghOrgRepo}/-/merge_requests/`
      : `https://github.com/${config.project.ghOrgRepo}/pull/`,
    VCS_PR_NOUN: config.vcs?.provider === 'gitlab' ? 'MR' : 'PR',
    VCS_PR_NOUN_LONG: config.vcs?.provider === 'gitlab' ? 'merge request' : 'pull request',

    SLACK_LEVEL: config.notifications?.slackLevel ?? 'none',
    SLACK_CHANNEL_PREFIX: config.notifications?.slackChannelPrefix ?? config.aliasPrefix ?? 'dev',
    SLACK_DEPLOY_CHANNEL: config.notifications?.slackDeployChannel ?? `${chanPrefix}-deployments`,
    SLACK_TRIAGE_CHANNEL: config.notifications?.slackTriageChannel ?? `${chanPrefix}-dev-triage`,
    SLACK_ANALYTICS_CHANNEL: config.notifications?.slackAnalyticsChannel ?? `${chanPrefix}-analytics`,
    SLACK_FEEDBACK_CHANNEL: config.notifications?.slackFeedbackChannel ?? `${chanPrefix}-dev-triage`,
    SLACK_MARKETING_CHANNEL: config.notifications?.slackMarketingChannel ?? `${chanPrefix}-marketing`,
    SLACK_ARCHIVE_CHANNEL: config.notifications?.slackArchiveChannel ?? 'dev-archive',
    SLACK_IDEAS_CHANNEL: config.notifications?.slackIdeasChannel ?? `${chanPrefix}-dev-ideas`,
    SLACK_MEMORY_CHANNEL: config.notifications?.slackMemoryChannel ?? 'memory',
    SLACK_SIGNUPS_CHANNEL: config.notifications?.slackSignupsChannel ?? `${chanPrefix}-analytics`,
    SLACK_CONTROL_CENTER_CHANNEL: config.notifications?.slackControlCenterChannel ?? 'control-center',
    SLACK_DASHBOARD_CHANNEL: config.notifications?.slackDashboardChannel ?? `${chanPrefix}-analytics`,
    ERROR_TRACKING: config.monitoring?.errorTracking ?? 'none',
    ANALYTICS_PROVIDER: config.monitoring?.analytics ?? 'none',
    UPTIME_PROVIDER: config.monitoring?.uptime ?? 'none',
    EMAIL_PROVIDER: config.email?.provider ?? 'none',
    DEMO_MODE: config.demo ? 'true' : 'false',
    MONOREPO_APP_TABLE: (() => {
      if (!config.monorepo?.enabled || !config.monorepo.apps) return '';
      const apps = config.monorepo.apps;
      const rows = Object.entries(apps)
        .map(([slug, app]) => `| ${(app.displayName ?? slug).padEnd(18)} | ${(app.ticketPrefix ?? '—').padEnd(8)} | \`${app.appDir}\`${' '.repeat(Math.max(0, 20 - app.appDir.length))} | ${app.auth?.provider ?? 'none'} |`)
        .join('\n');
      return `| App                | Prefix   | Directory              | Auth |\n|--------------------|---------:|------------------------|------|\n${rows}`;
    })(),
    MONOREPO_TICKET_PREFIXES: (() => {
      if (!config.monorepo?.enabled || !config.monorepo.apps) return '';
      return Object.values(config.monorepo.apps)
        .map(app => app.ticketPrefix)
        .filter(Boolean)
        .join(', ');
    })(),
    IS_MONOREPO: config.monorepo?.enabled ? 'true' : 'false',
    APP_DIR: '',
    APP_NAME: '',
    APP_DISPLAY_NAME: '',
    MONOREPO_ROOT: config.project.repoPath,
    TRANSPILE_PACKAGES: '',
    WORKSPACE_DEPS: '',
    COMPANION_PACKAGE: '',
    PORT_OFFSET: '0',
    APP_PORT: String(config.ports.main),
    AUTH_PROVIDER: config.auth?.provider ?? 'none',
    LINEAR_APP_TEAM_ID: '',
    LINEAR_APP_TICKET_PREFIX: '',
    SLACK_APP_CHANNEL_PREFIX: '',
    APP_SLACK_DEPLOY_CHANNEL: '',
    APP_SLACK_TRIAGE_CHANNEL: '',
    APP_SLACK_ANALYTICS_CHANNEL: '',
    DESIGN_FLAVOR: design.flavor,
    DESIGN_PRIMARY: design.palette.primary,
    DESIGN_SECONDARY: design.palette.secondary,
    DESIGN_ACCENT: design.palette.accent,
    DESIGN_BG: design.palette.background,
    DESIGN_FG: design.palette.foreground,
    DESIGN_CARD: design.palette.card,
    DESIGN_BORDER: design.palette.border,
    DESIGN_MUTED: design.palette.muted,
    DESIGN_DARK_BG: design.darkPalette?.background ?? design.palette.background,
    DESIGN_DARK_FG: design.darkPalette?.foreground ?? design.palette.foreground,
    DESIGN_DARK_CARD: design.darkPalette?.card ?? design.palette.card,
    DESIGN_DARK_BORDER: design.darkPalette?.border ?? design.palette.border,
    DESIGN_DARK_MUTED: design.darkPalette?.muted ?? design.palette.muted,
    DESIGN_FONT_SANS: design.fonts.sans,
    DESIGN_FONT_MONO: design.fonts.mono,
    DESIGN_GOOGLE_FONTS: design.fonts.googleFonts.join(', '),
    DESIGN_RADIUS_SM: radius.sm,
    DESIGN_RADIUS_MD: radius.md,
    DESIGN_RADIUS_LG: radius.lg,
    DESIGN_RADIUS_CARD: radius.card,
    DESIGN_TRANSITION_DURATION: anim.transitionDuration,
    DESIGN_ENTRANCE_Y: anim.entranceY,
    DESIGN_HOVER_LIFT: anim.hoverLift,
    DESIGN_HOVER_SCALE: anim.hoverScale,
    DESIGN_SPRING_STIFFNESS: anim.springStiffness,
    DESIGN_SPRING_DAMPING: anim.springDamping,
    DESIGN_SHADOW_LEVEL: design.shadows,
    DESIGN_APP_DISPLAY_NAME: design.appDisplayName ?? config.project.displayName,
    RAQR_ART_WELCOME,
    RAQR_ART_CELEBRATE,
    RAQR_ART_ALERT,
    RAQR_ART_STRAINING,
    RAQR_ART_THINKING,
    RAQR_ART_EXCITED,
    RAQR_ART_SLEEPY,
    RAQR_ART_DIZZY,
    RAQR_ART_SAD,
    RAQR_ART_CURIOUS,
    RAQR_ART_RELIEVED,
    RAQR_ART_GREEDY,
    RAQR_ART_LOVING,
    RAQR_FRAME_START,
    RAQR_FRAME_END,
    RAQR_HR,
    RAQR_HR_MEDIUM,
    RAQR_PROGRESS_0,
    RAQR_PROGRESS_1,
    RAQR_PROGRESS_2,
    RAQR_PROGRESS_3,
    RAQR_PROGRESS_4,
    RAQR_PROGRESS_5,
    RAQR_PROGRESS_6,
    RAQR_PROGRESS_7,
    RAQR_PROGRESS_FAIL,
    SLOT_TABLE,
    SLOT_TABLE_PRINTF,
    SLOT_BASH_ARRAY,
    SLOT_PATHS,
    PORT_TABLE,
    SLOT_ALIASES_JUMP,
    SLOT_ALIASES_CLAUDE,
    SLOT_PORT_EXPORTS,
    SLOT_PORT_CASES,
    SLOT_RESET_CASES,
    SLOT_STATUS_ROWS,
    SLOT_HELP_SUMMARY,
  };
}

/**
 * Feature flags derived from config — used for {{#IF_FEATURE}} conditionals.
 */
export function getFeatureFlags(config: TraqrConfig): Record<string, boolean> {
  return {
    GITHUB: config.vcs?.provider === 'github' || !config.vcs?.provider,
    GITLAB: config.vcs?.provider === 'gitlab',
    GITLAB_ISSUES: config.issues?.provider === 'gitlab',
    VCS_AUTO_MERGE: config.vcs?.autoMerge === true,
    VCS_PRIMED_SESSION: config.vcs?.primedSession === true,
    VCS_REMOVE_SOURCE_BRANCH: config.vcs?.removeSourceBranch === true,
    OBSIDIAN: !!config.vault?.path,
    SLACK: (config.notifications?.slackLevel ?? 'none') !== 'none',
    MEMORY: (config.memory?.provider ?? 'none') !== 'none',
    MEMORY_FULL: config.memory?.provider === 'supabase',
    LINEAR: config.issues?.provider === 'linear',
    GITHUB_ISSUES: config.issues?.provider === 'github',
    ISSUES: (config.issues?.provider ?? 'none') !== 'none',
    POSTHOG: config.monitoring?.analytics === 'posthog',
    SENTRY: config.monitoring?.errorTracking === 'sentry',
    CHECKLY: config.monitoring?.uptime === 'checkly' || config.monitoring?.uptime === 'both',
    BETTERSTACK: config.monitoring?.uptime === 'betterstack' || config.monitoring?.uptime === 'both',
    EMAIL: (config.email?.provider ?? 'none') !== 'none',
    RESEND: config.email?.provider === 'resend',
    FEEDBACK_LOOP: config.email?.feedbackLoop === true,
    FEEDBACK_WIDGET: config.monitoring?.feedbackWidget === true,
    DEV_INBOX: config.notifications?.devInbox === true,
    VIBE_CHAT: config.notifications?.vibeChat === true,
    CRONS: config.crons !== undefined,
    VOICE_PROFILES: config.memory?.voiceProfiles === true,
    CROSS_PROJECT: config.memory?.crossProject === true,
    PLAN_DISPATCH: config.issues?.planDispatch === true,
    DAEMON: config.daemon !== undefined,
    GUARDIAN: config.guardian?.enabled === true,
    GUARDIAN_DRY_RUN: config.guardian?.dryRun === true,
    CONTROL_CENTER: config.daemon !== undefined,
    MAILBOX: config.daemon !== undefined && config.issues?.provider === 'linear',
    SCRIPTS_TYPECHECK: false,
    DEMO: config.demo === true,
    MONOREPO: config.monorepo?.enabled === true,
    AUTH_CLERK: config.auth?.provider === 'clerk',
    AUTH_FIREBASE: config.auth?.provider === 'firebase',
    AUTH_SUPABASE: config.auth?.provider === 'supabase',
    DESIGN: config.design !== undefined,
    DESIGN_DARK_MODE: config.design?.darkMode === true,
    DESIGN_FRAMER_MOTION: config.design?.useFramerMotion === true,
    DESIGN_ANIMATIONS: (config.design?.animations ?? 'none') !== 'none',
    DESIGN_SHADOWS_NONE: config.design?.shadows === 'none',
    DESIGN_SHADOWS_SOFT: config.design?.shadows === 'soft',
    DESIGN_SHADOWS_MEDIUM: config.design?.shadows === 'medium',
    DESIGN_SHADOWS_DRAMATIC: config.design?.shadows === 'dramatic',
  };
}

/**
 * Scan a template for {{VAR}} placeholders that aren't in the known TemplateVars keys.
 * Returns unknown var names so callers can surface warnings.
 */
export function validateTemplate(
  template: string,
  vars: TemplateVars
): { unknownVars: string[] } {
  const varPattern = /\{\{([A-Z_]+)\}\}/g;
  const knownKeys = new Set(Object.keys(vars));
  const unknownVars: string[] = [];
  let match;
  while ((match = varPattern.exec(template)) !== null) {
    if (!knownKeys.has(match[1])) {
      unknownVars.push(match[1]);
    }
  }
  return { unknownVars: Array.from(new Set(unknownVars)) };
}

/**
 * Replace all {{VAR}} placeholders, {{#IF_TIER_N+}}...{{/IF_TIER_N+}} conditionals,
 * and {{#IF_FEATURE}}...{{/IF_FEATURE}} feature conditionals in a template.
 *
 * Pass an optional `warnings` array to collect unknown variable names
 * instead of silently passing them through.
 */
export function renderTemplate(
  template: string,
  vars: TemplateVars,
  tier: number,
  featureFlags?: Record<string, boolean>,
  warnings?: string[]
): string {
  let result = template;

  // Process tier conditionals first (before variable replacement)
  for (let t = 0; t <= 4; t++) {
    const regex = new RegExp(`\\{\\{#IF_TIER_${t}\\+\\}\\}([\\s\\S]*?)\\{\\{/IF_TIER_${t}\\+\\}\\}`, 'g');
    result = result.replace(regex, (_match, content) => {
      return tier >= t ? content : '';
    });
  }

  // Process feature conditionals: {{#IF_SLACK}}...{{/IF_SLACK}}
  if (featureFlags) {
    for (const [flag, enabled] of Object.entries(featureFlags)) {
      const regex = new RegExp(`\\{\\{#IF_${flag}\\}\\}([\\s\\S]*?)\\{\\{/IF_${flag}\\}\\}`, 'g');
      result = result.replace(regex, (_match, content) => {
        return enabled ? content : '';
      });
    }

    // Process negated feature conditionals: {{^IF_SLACK}}...{{/IF_SLACK}}
    for (const [flag, enabled] of Object.entries(featureFlags)) {
      const negRegex = new RegExp(`\\{\\{\\^IF_${flag}\\}\\}([\\s\\S]*?)\\{\\{/IF_${flag}\\}\\}`, 'g');
      result = result.replace(negRegex, (_match, content) => {
        return enabled ? '' : content;
      });
    }
  }

  // Replace all {{VAR}} placeholders
  const knownKeys = new Set(Object.keys(vars));
  result = result.replace(/\{\{([A-Z_]+)\}\}/g, (_match, varName) => {
    if (!knownKeys.has(varName) && warnings) {
      warnings.push(`Unknown template variable: {{${varName}}}`);
    }
    return (vars as unknown as Record<string, string>)[varName] ?? `{{${varName}}}`;
  });

  return result;
}

/**
 * Build template variables for a monorepo sub-app.
 * Overlays app-specific values on top of the base config's template vars.
 */
export function buildSubAppTemplateVars(
  config: TraqrConfig,
  appSlug: string,
): TemplateVars {
  const baseVars = buildTemplateVars(config);
  const appConfig = config.monorepo?.apps?.[appSlug];
  if (!appConfig) return baseVars;

  const portOffset = appConfig.portOffset ?? 0;
  const workspaceDeps = appConfig.workspaceDeps ?? [];

  const appChanPrefix = appConfig.slackChannelPrefix ?? '';
  const appChannels = appConfig.slackChannels ?? {};

  return {
    ...baseVars,
    IS_MONOREPO: 'true',
    APP_DIR: appConfig.appDir,
    APP_NAME: appSlug,
    APP_DISPLAY_NAME: appConfig.displayName,
    MONOREPO_ROOT: config.project.repoPath,
    TRANSPILE_PACKAGES: workspaceDeps.map(d => `'${d}'`).join(', '),
    WORKSPACE_DEPS: workspaceDeps.map(d => `    "${d}": "*"`).join(',\n'),
    COMPANION_PACKAGE: appConfig.companionPackage ?? '',
    PORT_OFFSET: String(portOffset),
    APP_PORT: String(config.ports.main + portOffset),
    AUTH_PROVIDER: appConfig.auth?.provider ?? config.auth?.provider ?? 'none',
    LINEAR_APP_TEAM_ID: appConfig.linearTeamId ?? '',
    LINEAR_APP_TICKET_PREFIX: appConfig.ticketPrefix ?? '',
    SLACK_APP_CHANNEL_PREFIX: appChanPrefix,
    APP_SLACK_DEPLOY_CHANNEL: appChannels.deploy ?? (appChanPrefix ? `${appChanPrefix}-deployments` : ''),
    APP_SLACK_TRIAGE_CHANNEL: appChannels.triage ?? (appChanPrefix ? `${appChanPrefix}-dev-triage` : ''),
    APP_SLACK_ANALYTICS_CHANNEL: appChannels.analytics ?? (appChanPrefix ? `${appChanPrefix}-analytics` : ''),
  };
}
