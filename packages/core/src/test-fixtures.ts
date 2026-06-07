/**
 * @traqr/core — Test Fixtures
 *
 * Complete TraqrConfig objects for each starter pack,
 * used by the test harness to validate the template engine.
 */

import type { TraqrConfig } from './config-schema.js'
import { STARTER_PACK_DEFAULTS, calculateAutomationScore } from './config-schema.js'

/** Synthetic project data shared across all fixtures */
const BASE_PROJECT = {
  name: 'testproject',
  displayName: 'Test Project',
  description: 'Traqr test validation project',
  repoPath: '/tmp/traqr-test/testproject',
  worktreesPath: '/tmp/traqr-test/testproject/.worktrees',
  ghOrgRepo: 'test-org/testproject',
  framework: 'nextjs',
  packageManager: 'npm',
  deployPlatform: 'vercel',
} as const

/** Shared base fields present in all configs */
const BASE_CONFIG = {
  version: '1.0.0' as const,
  project: { ...BASE_PROJECT },
  ports: {
    main: 3000,
    featureStart: 3001,
    bugfixStart: 3011,
    devopsStart: 3021,
    analysis: 3099,
  },
  prefix: 'tp',
  aliasPrefix: 'tp',
  kvPrefix: 'testproject',
  shipEnvVar: 'TESTPROJECT_SHIP_AUTHORIZED',
  sessionPrefix: 'testproject',
  coAuthor: 'Claude Opus 4.6 <noreply@anthropic.com>',
}

/**
 * Build a complete TraqrConfig from a starter pack name.
 * Merges base project data with pack defaults.
 */
function buildFixture(pack: 'solo' | 'smart' | 'production' | 'full'): TraqrConfig {
  const defaults = STARTER_PACK_DEFAULTS[pack]
  const config: TraqrConfig = {
    ...BASE_CONFIG,
    ...defaults,
    project: { ...BASE_PROJECT },
  } as TraqrConfig

  config.automationScore = calculateAutomationScore(config)
  return config
}

/** Solo Dev (Tier 0) — minimal, no services */
export const SOLO_FIXTURE = buildFixture('solo')

/** Smart Dev (Tier 2) — memory + GitHub Issues */
export const SMART_FIXTURE = buildFixture('smart')

/** Production (Tier 3) — Linear, Slack, PostHog, daemon */
export const PRODUCTION_FIXTURE = buildFixture('production')

/** Full (Tier 4) — everything enabled */
export const FULL_FIXTURE = buildFixture('full')

/** GitLab Team (Tier 2) — GitLab VCS, GitLab Issues, no Slack, no daemon */
export const GITLAB_TEAM_FIXTURE: TraqrConfig = {
  ...BASE_CONFIG,
  ...STARTER_PACK_DEFAULTS['smart'],
  starterPack: 'gitlab-team' as any,
  project: {
    ...BASE_PROJECT,
    ghOrgRepo: 'acme-team/acme-platform',
  },
  vcs: {
    provider: 'gitlab',
    projectId: '152559',
    baseUrl: 'https://gitlab.example.com',
    mergeStrategy: 'fast-forward',
    autoMerge: true,
    primedSession: true,
    removeSourceBranch: true,
  },
  issues: {
    provider: 'gitlab',
    planDispatch: true,
    autoLabels: true,
  },
  notifications: {
    slackLevel: 'none' as const,
  },
  automationScore: 0,
} as TraqrConfig
GITLAB_TEAM_FIXTURE.automationScore = calculateAutomationScore(GITLAB_TEAM_FIXTURE)

/** All fixtures indexed by pack name */
export const ALL_FIXTURES: Record<string, TraqrConfig> = {
  solo: SOLO_FIXTURE,
  smart: SMART_FIXTURE,
  production: PRODUCTION_FIXTURE,
  full: FULL_FIXTURE,
  'gitlab-team': GITLAB_TEAM_FIXTURE,
}

/** Pack display names for output */
export const PACK_DISPLAY_NAMES: Record<string, string> = {
  solo: 'SOLO DEV (Tier 0)',
  smart: 'SMART DEV (Tier 2)',
  production: 'PRODUCTION (Tier 3)',
  full: 'FULL PLATFORM (Tier 4)',
  'gitlab-team': 'GITLAB TEAM (Tier 2 — GitLab VCS)',
}

// ============================================================
// Content Expectations (Suite 7)
// ============================================================

export interface ContentExpectation {
  requiredFiles: string[]
  forbiddenFiles: string[]
  contentChecks: Array<{
    file: string
    mustContain: string[]
    mustNotContain: string[]
  }>
}

// --- Shared file lists ---
//
// Keys match the merged renderAllTemplates() output: project-local files
// keyed by their `.claude/...` path, global skills keyed by their
// `~/.claude/commands/...` path. Lists below reflect the templates that
// ACTUALLY exist and render — verified against renderAllTemplates() output.

/** Files rendered in EVERY pack (tier 0+) — project-local + global skills */
const CORE_REQUIRED = [
  // Project-local core
  'CLAUDE.md',
  '.claude/settings.json',
  '.traqr/ONBOARDING.md',
  '.claude/agents/advisor.md',
  '.claude/commands/traqr-init.md',
  '.claude/commands/traqr-setup.md',
  '.claude/commands/traqr-test.md',
  '.claude/commands/nextphase.md',
  '.claude/commands/debate.md',
  'scripts/tp-aliases.sh',
  'scripts/setup-worktrees.sh',
  'scripts/pre-push-guardrail.sh',
  '.env.local.example',
  // Global skills (rendered to ~/.claude/commands/)
  '~/.claude/commands/ship.md',
  '~/.claude/commands/sync.md',
  '~/.claude/commands/resync.md',
  '~/.claude/commands/alpha-onboard.md',
]

/** Memory-gated files added at Tier 2 (memory provider enabled) */
const TIER2_MEMORY_FILES = [
  '.claude/commands/analyze.md',
  '.claude/commands/status.md',
  '.claude/commands/validate-config.md',
  '.claude/commands/bootstrap-skills.md',
  '.claude/commands/bethesda.md',
  '.claude/commands/call.md',
  '.claude/commands/deepreflect.md',
  '.claude/commands/documentary.md',
  '.claude/commands/gamedev.md',
  '.claude/commands/lore.md',
  '.claude/commands/rally.md',
]

/** Tier 3 files — integrations (Slack + issues + control-center) */
const TIER3_FILES = [
  '.claude/commands/slack.md',
  '.claude/commands/rounds.md',
  '.claude/commands/einstein.md',
  '.claude/commands/cos.md',
  '~/.claude/commands/inbox.md',
]

/** Command files that must NOT render below their tier (solo pack) */
const SOLO_FORBIDDEN = [
  '.claude/commands/analyze.md',   // tier 1+ MEMORY
  '.claude/commands/bethesda.md',  // tier 2+ MEMORY
  '.claude/commands/slack.md',     // tier 3+ SLACK
  '.claude/commands/einstein.md',  // tier 3+ ISSUES
  '.claude/commands/rounds.md',    // tier 1+ SLACK
  '~/.claude/commands/inbox.md',   // tier 3+ SLACK
]

/** Command files that must NOT render at tier 2 (smart / gitlab-team) */
const TIER2_FORBIDDEN = [
  '.claude/commands/slack.md',     // tier 3+ SLACK
  '.claude/commands/einstein.md',  // tier 3+ ISSUES
  '.claude/commands/cos.md',       // tier 3+ CONTROL_CENTER
  '.claude/commands/rounds.md',    // tier 1+ SLACK (no Slack at tier 2 fixtures)
  '~/.claude/commands/inbox.md',   // tier 3+ SLACK
]

/** Design templates — DESIGN=false for all test fixtures */
const DESIGN_FORBIDDEN = [
  'src/app/globals.css',
  'tailwind.config.ts',
  'src/components/Providers.tsx',
]

/**
 * Per-pack content expectations for rendered output validation.
 * Validated against the merged {files, globalFiles} output of
 * renderAllTemplates().
 */
export const CONTENT_EXPECTATIONS: Record<string, ContentExpectation> = {
  solo: {
    requiredFiles: [...CORE_REQUIRED],
    forbiddenFiles: [...SOLO_FORBIDDEN, ...DESIGN_FORBIDDEN],
    contentChecks: [
      {
        file: 'CLAUDE.md',
        mustContain: ['Test Project', 'tp', 'testproject'],
        mustNotContain: ['TRAQR_SUPABASE_URL', '/slack', 'LINEAR_API_KEY'],
      },
      {
        file: '.env.local.example',
        mustContain: ['NEXT_PUBLIC_SUPABASE_URL', 'CRON_SECRET', 'solo', 'Tier 0'],
        mustNotContain: [
          'TRAQR_SUPABASE_URL', 'LINEAR_API_KEY', 'SLACK_BOT_TOKEN',
          'POSTHOG', 'SENTRY', 'RESEND', 'KV_REST_API', 'GUARDIAN',
        ],
      },
      {
        file: 'scripts/tp-aliases.sh',
        mustContain: [
          'z1', 'z2', 'z3', 'zb1', 'c1', 'c2', 'c3', 'cb1',
          'TP_WORKTREES', 'TP_PORT_MAIN=3000',
        ],
        mustNotContain: ['zd1', 'za=', 'cd1', 'ca=', 'analysis'],
      },
      {
        file: 'scripts/setup-worktrees.sh',
        mustContain: [
          'feature/slot-1', 'feature/slot-2', 'feature/slot-3',
          'bugfix/slot-1',
        ],
        mustNotContain: ['devops/slot-1', 'analysis/active'],
      },
      {
        file: 'scripts/pre-push-guardrail.sh',
        mustContain: ['TESTPROJECT_SHIP_AUTHORIZED'],
        mustNotContain: ['NOOKTRAQR_SHIP_AUTHORIZED'],
      },
      {
        file: '~/.claude/commands/ship.md',
        mustContain: ['testproject'],
        mustNotContain: [],
      },
    ],
  },

  smart: {
    requiredFiles: [...CORE_REQUIRED, ...TIER2_MEMORY_FILES],
    forbiddenFiles: [...TIER2_FORBIDDEN, ...DESIGN_FORBIDDEN],
    contentChecks: [
      {
        file: 'CLAUDE.md',
        mustContain: ['Test Project', 'memory_search'],
        mustNotContain: ['/slack'],
      },
      {
        file: '.env.local.example',
        mustContain: ['TRAQR_SUPABASE_URL', 'OPENAI_API_KEY', 'LINEAR_API_KEY', 'smart', 'Tier 2'],
        mustNotContain: ['SLACK_BOT_TOKEN', 'POSTHOG', 'SENTRY', 'KV_REST_API', 'GUARDIAN'],
      },
      {
        file: 'scripts/tp-aliases.sh',
        mustContain: ['z1', 'z2', 'z3', 'zb1', 'zb2', 'zd1', 'c1', 'cb1', 'cb2', 'cd1', 'TP_API='],
        mustNotContain: ['zd2', 'za=', 'ca=', 'analysis'],
      },
      {
        file: 'scripts/setup-worktrees.sh',
        mustContain: ['feature/slot-1', 'feature/slot-3', 'bugfix/slot-1', 'bugfix/slot-2', 'devops/slot-1'],
        mustNotContain: ['devops/slot-2', 'analysis/active'],
      },
      {
        file: 'scripts/pre-push-guardrail.sh',
        mustContain: ['TESTPROJECT_SHIP_AUTHORIZED'],
        mustNotContain: ['NOOKTRAQR_SHIP_AUTHORIZED'],
      },
    ],
  },

  production: {
    requiredFiles: [...CORE_REQUIRED, ...TIER2_MEMORY_FILES, ...TIER3_FILES],
    forbiddenFiles: [...DESIGN_FORBIDDEN],
    contentChecks: [
      {
        file: 'CLAUDE.md',
        mustContain: ['Test Project', 'memory_search'],
        mustNotContain: [],
      },
      {
        file: '.env.local.example',
        mustContain: ['SLACK_BOT_TOKEN', 'POSTHOG', 'SENTRY', 'KV_REST_API', 'production', 'Tier 3'],
        mustNotContain: ['RESEND', 'GUARDIAN'],
      },
      {
        file: 'scripts/tp-aliases.sh',
        mustContain: ['zd1', 'zd2', 'zd3', 'za=', 'ca=', 'cd1', 'cd2', 'cd3', 'analysis'],
        mustNotContain: [],
      },
      {
        file: 'scripts/setup-worktrees.sh',
        mustContain: ['devops/slot-1', 'devops/slot-2', 'devops/slot-3', 'analysis/active'],
        mustNotContain: [],
      },
      {
        file: 'scripts/pre-push-guardrail.sh',
        mustContain: ['TESTPROJECT_SHIP_AUTHORIZED'],
        mustNotContain: ['NOOKTRAQR_SHIP_AUTHORIZED'],
      },
    ],
  },

  full: {
    requiredFiles: [...CORE_REQUIRED, ...TIER2_MEMORY_FILES, ...TIER3_FILES],
    forbiddenFiles: [...DESIGN_FORBIDDEN],
    contentChecks: [
      {
        file: 'CLAUDE.md',
        mustContain: ['Test Project', 'memory_search'],
        mustNotContain: [],
      },
      {
        file: '.env.local.example',
        mustContain: ['GUARDIAN', 'RESEND', 'full', 'Tier 4', 'SLACK_BOT_TOKEN', 'POSTHOG', 'KV_REST_API'],
        mustNotContain: [],
      },
      {
        file: 'scripts/tp-aliases.sh',
        mustContain: ['zd1', 'zd2', 'zd3', 'za=', 'ca=', 'analysis'],
        mustNotContain: [],
      },
      {
        file: 'scripts/setup-worktrees.sh',
        mustContain: ['devops/slot-1', 'devops/slot-3', 'analysis/active'],
        mustNotContain: [],
      },
      {
        file: 'scripts/pre-push-guardrail.sh',
        mustContain: ['TESTPROJECT_SHIP_AUTHORIZED'],
        mustNotContain: ['NOOKTRAQR_SHIP_AUTHORIZED'],
      },
    ],
  },

  'gitlab-team': {
    requiredFiles: [...CORE_REQUIRED, ...TIER2_MEMORY_FILES],
    forbiddenFiles: [...TIER2_FORBIDDEN, ...DESIGN_FORBIDDEN],
    contentChecks: [
      {
        file: '~/.claude/commands/ship.md',
        mustContain: ['glab', 'gitlab', 'merge_requests', 'merge_when_pipeline_succeeds', 'PRIVATE-TOKEN'],
        mustNotContain: ['gh pr create', 'gh pr edit', 'github.com/test-org'],
      },
      {
        file: 'CLAUDE.md',
        mustContain: ['Test Project'],
        mustNotContain: ['LINEAR_API_KEY', 'SLACK_BOT_TOKEN'],
      },
      {
        file: '~/.claude/commands/sync.md',
        mustContain: ['git fetch'],
        mustNotContain: ['glab', 'gitlab'],  // sync is pure git — no VCS-specific content
      },
    ],
  },
}
