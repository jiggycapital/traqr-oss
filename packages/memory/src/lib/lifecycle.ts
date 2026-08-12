/**
 * Memory Lifecycle Utilities
 *
 * Version chains, temporal queries, and lifecycle management
 * for the Memory Engine v2 temporal model.
 */

import { getMemoryClient } from './client.js'
import { getMemory } from './memory.js'
import type { Memory } from '../vectordb/types.js'

// ---------------------------------------------------------------------------
// Version Chains
// ---------------------------------------------------------------------------

interface VersionChainEntry {
  memory: Memory
  edgeType: string
  createdAt: Date
}

/**
 * Walk 'updates' edges from a memory to its predecessors.
 * Returns newest-first chain: [current, previous, oldest...]
 */
export async function getVersionChain(
  memoryId: string,
  maxDepth: number = 10,
): Promise<VersionChainEntry[]> {
  const client = getMemoryClient()
  const chain: VersionChainEntry[] = []

  // Start with the given memory
  const current = await getMemory(memoryId)
  if (!current) return []
  chain.push({ memory: current, edgeType: 'root', createdAt: current.createdAt })

  // Walk target_memory_id via 'updates' edges
  let currentId = memoryId
  for (let depth = 0; depth < maxDepth; depth++) {
    const { data, error } = await (client.from('memory_relationships') as any)
      .select('target_memory_id, edge_type, created_at')
      .eq('source_memory_id', currentId)
      .in('edge_type', ['updates', 'extends'])
      .limit(1)
      .single()

    if (error || !data) break

    const targetMemory = await getMemory(data.target_memory_id)
    if (!targetMemory) break

    chain.push({
      memory: targetMemory,
      edgeType: data.edge_type,
      createdAt: new Date(data.created_at),
    })
    currentId = data.target_memory_id
  }

  return chain
}

// ---------------------------------------------------------------------------
// Memory History
// ---------------------------------------------------------------------------

export interface MemoryHistoryResult {
  current: Memory
  previous: Memory[]
  edges: { from: string; to: string; edgeType: string; createdAt: Date }[]
}

/**
 * Get the full history of a memory including all version chain entries
 * and the edges connecting them.
 */
export async function getMemoryHistory(memoryId: string): Promise<MemoryHistoryResult | null> {
  const chain = await getVersionChain(memoryId)
  if (chain.length === 0) return null

  const current = chain[0].memory
  const previous = chain.slice(1).map((e) => e.memory)
  const edges = chain.slice(1).map((e, i) => ({
    from: chain[i].memory.id,
    to: e.memory.id,
    edgeType: e.edgeType,
    createdAt: e.createdAt,
  }))

  return { current, previous, edges }
}

// ---------------------------------------------------------------------------
// Relationship Queries
// ---------------------------------------------------------------------------

export interface MemoryRelationship {
  id: string
  sourceMemoryId: string
  targetMemoryId: string
  edgeType: string
  confidence: number
  createdAt: Date
}

/**
 * Get all relationships for a memory (both incoming and outgoing).
 */
export async function getMemoryRelationships(memoryId: string): Promise<MemoryRelationship[]> {
  const client = getMemoryClient()

  const { data, error } = await (client.from('memory_relationships') as any)
    .select('*')
    .or(`source_memory_id.eq.${memoryId},target_memory_id.eq.${memoryId}`)
    .order('created_at', { ascending: false })

  if (error) {
    console.warn('[lifecycle] Failed to get relationships:', error.message)
    return []
  }

  return (data || []).map((row: any) => ({
    id: row.id,
    sourceMemoryId: row.source_memory_id,
    targetMemoryId: row.target_memory_id,
    edgeType: row.edge_type,
    confidence: row.confidence,
    createdAt: new Date(row.created_at),
  }))
}
