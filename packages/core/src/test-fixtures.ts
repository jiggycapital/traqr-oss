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
    ghOrgRepo: 'kiro-sales/Kiro-Sales',
  },
  vcs: {
    provider: 'gitlab',
    projectId: '152559',
    baseUrl: 'https://gitlab.aws.dev',
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

// --- Shared file lists to avoid duplication ---

/** Core files present in ALL packs (Solo base = 20 files) */
const CORE_REQUIRED = [
  'CLAUDE.md',
  '.claude/settings.json',
  '.claude/commands/ship.md',
  '.claude/commands/sync.md',
  '.claude/commands/worktrees.md',
  '.claude/commands/pr.md',
  '.claude/commands/resync.md',
  '.claude/commands/verify.md',
  '.claude/commands/draft.md',
  '.claude/commands/context.md',
  '.claude/commands/techdebt.md',
  '.claude/commands/browser.md',
  '.claude/commands/plan.md',
  '.claude/commands/traqr-init.md',
  '.claude/commands/traqr-upgrade.md',
  '.claude/commands/traqr-setup.md',
  'scripts/tp-aliases.sh',
  'scripts/setup-worktrees.sh',
  'scripts/pre-push-guardrail.sh',
  '.env.local.example',
]

/** Memory + issues files added at Tier 2 (Smart Dev) */
const MEMORY_ISSUES_FILES = [
  '.claude/commands/analyze.md',
  '.claude/commands/status.md',
  '.claude/commands/validate-config.md',
  '.claude/commands/bootstrap-skills.md',
]

/** Slack + writing files added at Tier 3 (Production) */
const SLACK_WRITING_FILES = [
  '.claude/commands/slack.md',
  '.claude/commands/inbox.md',
  '.claude/commands/writing-style.md',
]

/** Email file (Tier 3+ when EMAIL=true, only Full enables it) */
const EMAIL_FILES = ['.claude/commands/email.md']

/** Tier 4 gated command files */
const TIER4_FILES = [
  '.claude/commands/analytics.md',
  '.claude/commands/cron.md',
  '.claude/commands/webhook.md',
  '.claude/commands/gap-analysis.md',
]

/**
 * Per-pack content expectations for rendered output validation.
 * File keys match renderAllTemplates() output (template-relative paths),
 * NOT installed filesystem paths.
 */
export const CONTENT_EXPECTATIONS: Record<string, ContentExpectation> = {
  solo: {
    requiredFiles: [...CORE_REQUIRED],
    forbiddenFiles: [
      '.claude/commands/analyze.md',     // tier 1+ MEMORY
      '.claude/commands/validate-config.md', // tier 1+ MEMORY
      '.claude/commands/slack.md',       // tier 3+ SLACK
      '.claude/commands/inbox.md',       // tier 3+ SLACK
      '.claude/commands/analytics.md',   // tier 4 POSTHOG
      '.claude/commands/email.md',       // tier 3+ EMAIL
      '.claude/commands/cron.md',        // tier 4 CRONS
    ],
    contentChecks: [
      {
        file: 'CLAUDE.md',
        mustContain: ['Test Project', 'tp', 'testproject'],
        mustNotContain: ['TRAQR_SUPABASE_URL', '/startup', '/slack', 'LINEAR_API_KEY', 'daemon'],
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
        file: '.claude/commands/ship.md',
        mustContain: ['testproject'],
        mustNotContain: [],
      },
    ],
  },

  smart: {
    requiredFiles: [...CORE_REQUIRED, ...MEMORY_ISSUES_FILES],
    forbiddenFiles: [
      '.claude/commands/slack.md',        // tier 3+ SLACK
      '.claude/commands/inbox.md',        // tier 3+ SLACK
      '.claude/commands/email.md',        // tier 3+ EMAIL
      '.claude/commands/writing-style.md', // tier 3+ MEMORY
      '.claude/commands/analytics.md',    // tier 4 POSTHOG
      '.claude/commands/cron.md',         // tier 4 CRONS
      '.claude/commands/webhook.md',      // tier 4 CRONS
      '.claude/commands/gap-analysis.md', // tier 4 CRONS
    ],
    contentChecks: [
      {
        file: 'CLAUDE.md',
        mustContain: ['Test Project', '/startup', '/learn', '/dispatch', 'Memory Feedback', 'Three Gates'],
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
    requiredFiles: [...CORE_REQUIRED, ...MEMORY_ISSUES_FILES, ...SLACK_WRITING_FILES],
    forbiddenFiles: [
      '.claude/commands/email.md',        // EMAIL=false
      '.claude/commands/analytics.md',    // tier 4+
      '.claude/commands/cron.md',         // tier 4+
      '.claude/commands/webhook.md',      // tier 4+
      '.claude/commands/gap-analysis.md', // tier 4+
    ],
    contentChecks: [
      {
        file: 'CLAUDE.md',
        mustContain: ['Test Project', '/startup', '/dispatch', 'Slack', 'Linear'],
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
    requiredFiles: [...CORE_REQUIRED, ...MEMORY_ISSUES_FILES, ...SLACK_WRITING_FILES, ...EMAIL_FILES, ...TIER4_FILES],
    forbiddenFiles: [
      // No gated commands excluded — all render at tier 4
      // Design templates still excluded (DESIGN=false for all packs)
      'src/app/globals.css',
      'tailwind.config.ts',
      'src/components/Providers.tsx',
    ],
    contentChecks: [
      {
        file: 'CLAUDE.md',
        mustContain: ['Test Project', '/startup', '/dispatch', 'Slack', 'Linear'],
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
    requiredFiles: [...CORE_REQUIRED, ...MEMORY_ISSUES_FILES],
    forbiddenFiles: [
      '.claude/commands/slack.md',        // no Slack
      '.claude/commands/inbox.md',        // no Slack
      '.claude/commands/email.md',        // no email
      '.claude/commands/analytics.md',    // tier 4 only
      '.claude/commands/cron.md',         // tier 4 only
    ],
    contentChecks: [
      {
        file: '.claude/commands/ship.md',
        mustContain: ['glab', 'gitlab', 'merge_when_pipeline_succeeds', 'PRIVATE-TOKEN', 'merge_requests'],
        mustNotContain: ['gh pr create', 'gh pr edit', 'gh pr list', 'github.com/test-org'],
      },
      {
        file: 'CLAUDE.md',
        mustContain: ['Test Project'],
        mustNotContain: ['LINEAR_API_KEY', 'SLACK_BOT_TOKEN'],
      },
      {
        file: '.claude/commands/sync.md',
        mustContain: ['git fetch', 'git rebase'],
        mustNotContain: ['glab', 'gitlab'],  // sync is pure git — no VCS-specific content
      },
    ],
  },
}
