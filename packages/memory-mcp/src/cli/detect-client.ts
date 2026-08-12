/**
 * MCP Client Detection
 *
 * Finds the config file for the user's MCP client so --install
 * can write the traqr-memory server config directly.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface DetectedClient {
  name: string
  configPath: string
  configKey: string // key in the JSON where mcpServers lives
}

const HOME = process.env.HOME || ''

const CLIENTS: Array<{ name: string; path: string; key: string }> = [
  {
    name: 'Claude Code',
    path: join(HOME, '.claude', 'settings.json'),
    key: 'mcpServers',
  },
  {
    name: 'Claude Desktop',
    path: join(HOME, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    key: 'mcpServers',
  },
  {
    name: 'Cursor',
    path: join(process.cwd(), '.cursor', 'mcp.json'),
    key: 'mcpServers',
  },
]

export function detectMcpClients(): DetectedClient[] {
  return CLIENTS
    .filter(c => existsSync(c.path))
    .map(c => ({ name: c.name, configPath: c.path, configKey: c.key }))
}

export function readClientConfig(client: DetectedClient): Record<string, any> {
  try {
    return JSON.parse(readFileSync(client.configPath, 'utf-8'))
  } catch {
    return {}
  }
}
