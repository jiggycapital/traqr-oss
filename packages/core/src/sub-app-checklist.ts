/**
 * @traqr/core — Sub-App Provisioning Checklist
 *
 * Checklist data structure and helpers for monorepo sub-app init.
 * Drives the scan→probe→update→execute→handhold→complete lifecycle
 * that Claude works through when adding a new app to a Traqr monorepo.
 */

import type { TraqrConfig } from './config-schema.js'
import type { OrgConfig } from './config-resolver.js'

// ============================================================
// Types
// ============================================================

/** Status of each checklist item as Claude works through it */
export type ChecklistStatus =
  | 'pending'      // not yet started
  | 'scanning'     // Claude is checking via MCP/config
  | 'found'        // resource discovered during scan
  | 'not-found'    // resource does not exist yet
  | 'wired'        // info stored in config
  | 'user-action'  // waiting for user to do something
  | 'skipped'      // user chose to skip
  | 'done'         // fully complete

export interface SubAppChecklistItem {
  /** Unique identifier for this item */
  id: string;
  /** Service category (linear, slack, memory, posthog, etc.) */
  service: string;
  /** Current status */
  status: ChecklistStatus;
  /** Human-readable description */
  description: string;
  /** What was discovered during scan (team name, channel list, etc.) */
  discovered?: Record<string, unknown>;
  /** What needs user action (create channel, paste key, etc.) */
  userAction?: string;
  /** MCP tools used for scanning/executing */
  mcpTools?: string[];
  /** Config keys this item writes to */
  configKeys?: string[];
}

export interface SubAppProvisioningPlan {
  appSlug: string;
  appDisplayName: string;
  parentConfig: TraqrConfig;
  items: SubAppChecklistItem[];
}

// ============================================================
// Known Slack channel purposes
// ============================================================

/** Standard Slack channel purposes that map to parent config fields */
const CHANNEL_PURPOSES = [
  { key: 'deploy', configField: 'slackDeployChannel', suffix: 'deployments' },
  { key: 'triage', configField: 'slackTriageChannel', suffix: 'dev-triage' },
  { key: 'analytics', configField: 'slackAnalyticsChannel', suffix: 'analytics' },
  { key: 'feedback', configField: 'slackFeedbackChannel', suffix: 'dev-triage' },
  { key: 'marketing', configField: 'slackMarketingChannel', suffix: 'marketing' },
  { key: 'archive', configField: 'slackArchiveChannel', suffix: 'dev-archive' },
  { key: 'ideas', configField: 'slackIdeasChannel', suffix: 'dev-ideas' },
  { key: 'memory', configField: 'slackMemoryChannel', suffix: 'memory' },
  { key: 'signups', configField: 'slackSignupsChannel', suffix: 'analytics' },
  { key: 'controlCenter', configField: 'slackControlCenterChannel', suffix: 'control-center' },
] as const;

// ============================================================
// Required Linear labels for the Traqr workflow
// ============================================================

export const REQUIRED_LINEAR_LABELS = [
  { name: 'agent-ready', color: '#27AE60' },
  { name: 'agent-claimed', color: '#E67E22' },
  { name: 'has-plan', color: '#3498DB' },
  { name: 'stale-pr', color: '#E74C3C' },
  { name: 'daemon-pr', color: '#9B59B6' },
] as const;

// ============================================================
// Checklist Builder
// ============================================================

/**
 * Build the initial checklist for a new sub-app.
 * Items start as 'pending'. Claude works through each one
 * via the scan→probe→update→execute→handhold→complete lifecycle.
 */
export function buildSubAppChecklist(
  parentConfig: TraqrConfig,
  orgConfig: OrgConfig | null,
  appSlug: string,
  appDisplayName: string,
): SubAppProvisioningPlan {
  const items: SubAppChecklistItem[] = [];

  // Always include: Linear (if parent uses it)
  if (parentConfig.issues?.provider === 'linear') {
    items.push({
      id: 'linear',
      service: 'Linear',
      status: 'pending',
      description: `Discover or create Linear team for ${appDisplayName}`,
      mcpTools: ['mcp__linear__list_teams', 'mcp__claude_ai_Linear__list_teams', 'mcp__linear__create_issue_label', 'mcp__claude_ai_Linear__create_issue_label'],
      configKeys: ['monorepo.apps.linearTeamId', 'monorepo.apps.ticketPrefix', 'issues.linearTeamMap'],
    });
  }

  // Always include: Slack (if parent uses it)
  if (parentConfig.notifications?.slackLevel && parentConfig.notifications.slackLevel !== 'none') {
    items.push({
      id: 'slack',
      service: 'Slack',
      status: 'pending',
      description: `Discover or create Slack channels for ${appDisplayName}`,
      mcpTools: ['mcp__slack__slack_list_channels', 'mcp__claude_ai_Slack__slack_search_channels'],
      configKeys: ['monorepo.apps.slackChannelPrefix', 'monorepo.apps.slackChannels'],
    });
  }

  // Memory (if parent uses supabase memory)
  if (parentConfig.memory?.provider === 'supabase') {
    items.push({
      id: 'memory',
      service: 'Memory',
      status: 'pending',
      description: `Register memory domain for ${appDisplayName}`,
      mcpTools: ['mcp__claude_ai_Supabase__execute_sql'],
      configKeys: ['memory.projectSlug'],
    });
  }

  // PostHog (if parent uses it)
  if (parentConfig.monitoring?.analytics === 'posthog') {
    items.push({
      id: 'posthog',
      service: 'PostHog',
      status: 'pending',
      description: `Share or create PostHog project for ${appDisplayName}`,
      mcpTools: ['mcp__posthog__projects-get', 'mcp__claude_ai_PostHog__projects-get'],
      configKeys: ['monorepo.apps.posthogProjectId'],
    });
  }

  // Auth (always — per-app decision)
  items.push({
    id: 'auth',
    service: 'Auth',
    status: 'pending',
    description: `Configure auth provider for ${appDisplayName}`,
    configKeys: ['monorepo.apps.auth'],
  });

  // Vercel (if parent uses it)
  if (parentConfig.project.deployPlatform === 'vercel' || !parentConfig.project.deployPlatform) {
    items.push({
      id: 'vercel',
      service: 'Vercel',
      status: 'pending',
      description: `Import ${appDisplayName} in Vercel`,
      configKeys: [],
    });
  }

  // Supabase schema (if parent uses supabase)
  if (orgConfig?.services?.supabase?.connected) {
    items.push({
      id: 'supabase-schema',
      service: 'Supabase',
      status: 'pending',
      description: `Check app-specific database tables for ${appDisplayName}`,
      mcpTools: ['mcp__claude_ai_Supabase__execute_sql'],
      configKeys: [],
    });
  }

  // Scaffold (always)
  items.push({
    id: 'scaffold',
    service: 'Scaffold',
    status: 'pending',
    description: `Render monorepo templates to apps/${appSlug}/`,
    configKeys: [],
  });

  // Config update (always)
  items.push({
    id: 'config',
    service: 'Config',
    status: 'pending',
    description: 'Update .traqr/config.json with new app',
    configKeys: ['monorepo.apps', 'monorepo.appDirs'],
  });

  // Validate (always)
  items.push({
    id: 'validate',
    service: 'Validate',
    status: 'pending',
    description: 'Verify all wired resources are accessible',
    configKeys: [],
  });

  return {
    appSlug,
    appDisplayName,
    parentConfig,
    items,
  };
}

// ============================================================
// Channel Derivation
// ============================================================

/**
 * Derive expected per-app Slack channels from parent's channel naming pattern.
 * e.g., parent has "nk-deployments" → new app with prefix "pk" expects "pk-deployments"
 * Returns the full set; Claude then scans to see which actually exist.
 */
export function deriveAppChannels(
  parentConfig: TraqrConfig,
  appChannelPrefix: string,
): Record<string, string> {
  const channels: Record<string, string> = {};
  const notifications = parentConfig.notifications;
  if (!notifications) return channels;

  const parentPrefix = notifications.slackChannelPrefix || parentConfig.aliasPrefix || 'dev';

  for (const purpose of CHANNEL_PURPOSES) {
    const parentChannel = (notifications as Record<string, unknown>)[purpose.configField] as string | undefined;
    if (!parentChannel) continue;

    // Check if the parent channel uses the parent prefix
    if (parentChannel.startsWith(`${parentPrefix}-`)) {
      // Replace parent prefix with app prefix
      const suffix = parentChannel.slice(parentPrefix.length + 1);
      channels[purpose.key] = `${appChannelPrefix}-${suffix}`;
    } else {
      // Shared channel (like "dev-archive", "memory") — keep as-is
      channels[purpose.key] = parentChannel;
    }
  }

  return channels;
}

// ============================================================
// Linear Team Derivation
// ============================================================

/**
 * Derive expected per-app Linear team config from parent.
 * Generates suggested team key, ticket prefix, and required labels.
 * Claude then scans Linear to see if team already exists.
 */
export function deriveLinearTeamConfig(
  parentConfig: TraqrConfig,
  appSlug: string,
): { teamKey: string; ticketPrefix: string; labels: Array<{ name: string; color: string }> } {
  // Derive a 3-letter ticket prefix from the app slug
  // e.g. "pokotraqr" → "PKT", "jiggycapital" → "JIG"
  const ticketPrefix = appSlug
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase()
    .slice(0, 3);

  return {
    teamKey: ticketPrefix,
    ticketPrefix,
    labels: [...REQUIRED_LINEAR_LABELS],
  };
}

// ============================================================
// Checklist Display Helper
// ============================================================

/**
 * Format the checklist for display, showing status icons for each item.
 */
export function formatChecklist(plan: SubAppProvisioningPlan): string {
  const lines: string[] = [];
  for (const item of plan.items) {
    const icon = statusIcon(item.status);
    lines.push(`  ${icon} ${item.service} — ${item.description}`);
    if (item.userAction) {
      lines.push(`     ↳ ${item.userAction}`);
    }
  }
  return lines.join('\n');
}

function statusIcon(status: ChecklistStatus): string {
  switch (status) {
    case 'pending': return '[ ]';
    case 'scanning': return '[~]';
    case 'found': return '[?]';
    case 'not-found': return '[!]';
    case 'wired': return '[>]';
    case 'user-action': return '[*]';
    case 'skipped': return '[-]';
    case 'done': return '[x]';
  }
}

// ============================================================
// Port Table Generator
// ============================================================

/**
 * Generate a port allocation table showing all apps across all slots.
 */
export function generatePortTable(config: TraqrConfig): string {
  const apps = config.monorepo?.apps;
  if (!apps || Object.keys(apps).length === 0) return '';

  const appSlugs = Object.keys(apps);
  const colWidth = 14;

  // Header
  const header = '  Slot         | ' + appSlugs.map(a => a.padEnd(colWidth)).join(' | ');
  const divider = '  ' + '-'.repeat(15 + appSlugs.length * (colWidth + 3));

  // Rows
  const slotDefs = [
    { name: 'main', port: config.ports.main },
    { name: 'feature1', port: config.ports.featureStart },
    { name: 'feature2', port: config.ports.featureStart + 1 },
    { name: 'bugfix1', port: config.ports.bugfixStart },
    { name: 'bugfix2', port: config.ports.bugfixStart + 1 },
  ];

  const rows = slotDefs.map(slot => {
    const cols = appSlugs.map(slug => {
      const offset = apps[slug].portOffset ?? 0;
      return String(slot.port + offset).padEnd(colWidth);
    });
    return `  ${slot.name.padEnd(13)} | ${cols.join(' | ')}`;
  });

  return [header, divider, ...rows].join('\n');
}
