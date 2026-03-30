/**
 * VectorDB Provider Factory
 *
 * Abstraction layer for vector database operations.
 * Supports Supabase (PostgREST) and raw Postgres (pg wire protocol).
 * Auto-detects from DATABASE_URL vs SUPABASE_URL.
 */

import { SupabaseVectorProvider } from './supabase.js'
import { PostgresVectorProvider, resetPostgresPool } from './postgres.js'
import { getMemoryConfig } from '../lib/client.js'
import type { VectorDBProvider, ProviderConfig } from './types.js'

// Re-export types for convenience
export * from './types.js'

// Singleton instance
let providerInstance: VectorDBProvider | null = null

/**
 * Get the configured vector database provider.
 * Auto-detects from config or env vars:
 *   DATABASE_URL → PostgresVectorProvider
 *   SUPABASE_URL → SupabaseVectorProvider
 */
export function getVectorDB(config?: ProviderConfig): VectorDBProvider {
  if (providerInstance) return providerInstance

  // Explicit type takes priority
  if (config?.type) {
    switch (config.type) {
      case 'postgres':
        providerInstance = new PostgresVectorProvider()
        break
      case 'supabase':
        providerInstance = new SupabaseVectorProvider()
        break
      default:
        throw new Error(`Unknown provider type: ${config.type}`)
    }
    return providerInstance
  }

  // Auto-detect from stored config / env vars
  const memConfig = getMemoryConfig()
  if (memConfig.databaseUrl) {
    providerInstance = new PostgresVectorProvider()
  } else {
    providerInstance = new SupabaseVectorProvider()
  }

  return providerInstance
}

/**
 * Reset the provider instance (useful for testing)
 */
export function resetVectorDB(): void {
  providerInstance = null
  resetPostgresPool()
}

export default getVectorDB
