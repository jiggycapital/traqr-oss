/**
 * Supabase Client for @traqr/memory
 *
 * Configurable Supabase client for the memory system.
 * Uses generic env vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 * instead of NookTraqr-specific ones.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'

let clientInstance: SupabaseClient | null = null

export interface MemoryClientConfig {
  supabaseUrl?: string
  supabaseKey?: string
  userId?: string
  projectId?: string
  tableName?: string
}

// Default IDs for single-user mode
export const DEFAULT_USER_ID = 'a0000000-0000-0000-0000-000000000001'
export const DEFAULT_PROJECT_ID = 'b0000000-0000-0000-0000-000000000001'

let _userId = DEFAULT_USER_ID
let _projectId = DEFAULT_PROJECT_ID
let _tableName = 'traqr_memories'

export function getMemoryClient(config?: MemoryClientConfig): SupabaseClient {
  if (clientInstance) return clientInstance

  const url = config?.supabaseUrl || process.env.SUPABASE_URL || process.env.TRAQR_SUPABASE_URL
  const key = config?.supabaseKey || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.TRAQR_SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. ' +
      'Set these environment variables to connect to your Supabase instance.'
    )
  }

  if (config?.userId) _userId = config.userId
  if (config?.projectId) _projectId = config.projectId

  clientInstance = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  return clientInstance
}

export function getUserId(): string {
  return _userId
}

export function getProjectId(): string {
  return _projectId
}

/**
 * Configure the memory system in one shot.
 * Resets the singleton so next getMemoryClient() uses the new config.
 */
export function configureMemory(config: MemoryClientConfig): void {
  clientInstance = null
  if (config.tableName) _tableName = config.tableName
  getMemoryClient(config)
}

export function getTableName(): string {
  return _tableName
}

/** Reset singleton (for testing) */
export function resetMemoryClient(): void {
  clientInstance = null
}
