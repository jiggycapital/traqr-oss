/**
 * VectorDB Provider Factory
 *
 * Abstraction layer for vector database operations.
 * Currently supports Supabase pgvector.
 */

import { SupabaseVectorProvider } from './supabase.js'
import type { VectorDBProvider, ProviderConfig } from './types.js'

// Re-export types for convenience
export * from './types.js'

// Singleton instance
let providerInstance: VectorDBProvider | null = null

/**
 * Get the configured vector database provider
 */
export function getVectorDB(config?: ProviderConfig): VectorDBProvider {
  if (providerInstance) return providerInstance

  const providerType = config?.type || 'supabase'

  switch (providerType) {
    case 'supabase':
      providerInstance = new SupabaseVectorProvider()
      break
    case 'pinecone':
      throw new Error('Pinecone provider not yet implemented')
    case 'qdrant':
      throw new Error('Qdrant provider not yet implemented')
    default:
      throw new Error(`Unknown provider type: ${providerType}`)
  }

  return providerInstance
}

/**
 * Reset the provider instance (useful for testing)
 */
export function resetVectorDB(): void {
  providerInstance = null
}

export default getVectorDB
