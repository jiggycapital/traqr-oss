/**
 * Supabase VectorDB Provider
 *
 * Implementation of VectorDBProvider using Supabase with pgvector.
 * All memory operations go through the configured Supabase instance.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { getMemoryClient, getUserId, getProjectId, getTableName } from '../lib/client.js'
import { generateEmbedding, formatEmbeddingForPgVector } from '../lib/embeddings.js'
import type {
  VectorDBProvider,
  Memory,
  MemoryInput,
  MemorySearchResult,
  MemoryUpdate,
  MemoryExport,
  MemoryDomain,
  SearchOptions,
  MemoryCategory,
  MemoryDurability,
  MemoryType,
  BM25SearchResult,
  TemporalSearchResult,
  GraphSearchResult,
} from './types.js'

// Table name is configurable via configureMemory() — defaults to 'memories'

// Database row type matching memories schema
interface MemoryRow {
  id: string
  user_id: string
  project_id: string | null
  content: string
  summary: string | null
  category: string | null
  tags: string[]
  context_tags: string[]
  domain: string | null
  embedding: string | null
  embedding_model: string
  embedding_model_version: string
  source_type: string
  source_ref: string | null
  source_project: string
  original_confidence: number
  last_validated: string
  related_to: string[]
  is_contradiction: boolean
  is_archived: boolean
  archived_at: string | null
  archive_reason: string | null
  created_at: string
  updated_at: string
  durability?: string | null
  expires_at?: string | null
  is_portable?: boolean
  is_universal?: boolean
  agent_type?: string | null
  times_returned?: number
  times_cited?: number
  last_returned_at?: string | null
  last_cited_at?: string | null
  // v2: Memory lifecycle
  memory_type?: string | null
  valid_at?: string | null
  invalid_at?: string | null
  is_latest?: boolean | null
  is_forgotten?: boolean | null
  forgotten_at?: string | null
  forget_after?: string | null
  source_tool?: string | null
}

interface SearchResultRow extends MemoryRow {
  current_confidence: number
  similarity: number
  relevance_score: number
}

// Convert database row to Memory type
function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    content: row.content,
    summary: row.summary ?? undefined,
    category: row.category as MemoryCategory | undefined,
    tags: row.tags || [],
    contextTags: row.context_tags || [],
    sourceType: row.source_type as Memory['sourceType'],
    sourceRef: row.source_ref ?? undefined,
    sourceProject: row.source_project,
    originalConfidence: row.original_confidence,
    lastValidated: new Date(row.last_validated),
    relatedTo: row.related_to || [],
    isContradiction: row.is_contradiction,
    isArchived: row.is_archived,
    archiveReason: row.archive_reason ?? undefined,
    archivedAt: row.archived_at ? new Date(row.archived_at) : undefined,
    embeddingModel: row.embedding_model,
    embeddingModelVersion: row.embedding_model_version,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    durability: (row.durability as MemoryDurability) || 'permanent',
    expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
    domain: (row as any).domain ?? undefined,
    topic: (row as any).topic ?? undefined,
    isUniversal: row.is_universal ?? false,
    agentType: row.agent_type ?? undefined,
    timesReturned: row.times_returned ?? 0,
    timesCited: row.times_cited ?? 0,
    lastReturnedAt: row.last_returned_at ? new Date(row.last_returned_at) : undefined,
    lastCitedAt: row.last_cited_at ? new Date(row.last_cited_at) : undefined,
    // v2: Memory lifecycle
    memoryType: (row.memory_type as MemoryType) ?? undefined,
    validAt: row.valid_at ? new Date(row.valid_at) : undefined,
    invalidAt: row.invalid_at ? new Date(row.invalid_at) : undefined,
    isLatest: row.is_latest ?? true,
    isForgotten: row.is_forgotten ?? false,
    forgottenAt: row.forgotten_at ? new Date(row.forgotten_at) : undefined,
    forgetAfter: row.forget_after ? new Date(row.forget_after) : undefined,
    sourceTool: row.source_tool ?? undefined,
  }
}

function rowToSearchResult(row: SearchResultRow): MemorySearchResult {
  return {
    ...rowToMemory(row),
    currentConfidence: row.current_confidence,
    similarity: row.similarity,
    relevanceScore: row.relevance_score,
  }
}

export class SupabaseVectorProvider implements VectorDBProvider {
  async store(input: MemoryInput, domainId?: string): Promise<Memory> {
    const client = getMemoryClient()
    const projectId = domainId || getProjectId()

    // Use pre-computed embedding if available (saves one OpenAI API call in triage flow)
    let embeddingStr: string
    let embeddingModel = 'text-embedding-3-small'
    let embeddingModelVersion = '1'
    if (input.precomputedEmbedding) {
      embeddingStr = input.precomputedEmbedding
    } else {
      const result = await generateEmbedding(input.content)
      embeddingStr = formatEmbeddingForPgVector(result.embedding)
      embeddingModel = result.model
      embeddingModelVersion = result.modelVersion
    }

    const insertData = {
      user_id: getUserId(),
      project_id: projectId,
      content: input.content,
      summary: input.summary,
      category: input.category,
      tags: input.tags || [],
      context_tags: input.contextTags || [],
      embedding: embeddingStr,
      embedding_model: embeddingModel,
      embedding_model_version: embeddingModelVersion,
      source_type: input.sourceType,
      source_ref: input.sourceRef,
      source_project: input.sourceProject || 'default',
      original_confidence: input.confidence ?? 1.0,
      related_to: input.relatedTo || [],
      is_contradiction: input.isContradiction || false,
      is_universal: input.isUniversal || false,
      agent_type: input.agentType || null,
      durability: input.durability || 'permanent',
      expires_at: input.expiresAt ? input.expiresAt.toISOString() : null,
      is_portable: true,
      domain: input.domain || null,
      topic: input.topic || null,
      // v2: Memory lifecycle
      memory_type: input.memoryType || null,
      source_tool: input.sourceTool || null,
      valid_at: input.validAt ? input.validAt.toISOString() : new Date().toISOString(),
      forget_after: input.forgetAfter ? input.forgetAfter.toISOString() : null,
      is_latest: true,
      is_forgotten: false,
    }

    const { data, error } = await (client
      .from(getTableName()) as any)
      .insert(insertData)
      .select()
      .single()

    if (error) {
      console.error('[VectorDB] Error storing memory:', error)
      throw new Error(`Failed to store memory: ${error.message}`)
    }

    return rowToMemory(data as MemoryRow)
  }

  async search(query: string, options: SearchOptions & { precomputedEmbedding?: string } = {}): Promise<MemorySearchResult[]> {
    const client = getMemoryClient()

    const embeddingStr = options.precomputedEmbedding
      ?? formatEmbeddingForPgVector((await generateEmbedding(query)).embedding)

    if (options.includeUniversal || options.sourceProject || options.agentType) {
      const { data, error } = await (client.rpc as any)('search_memories_cross_project', {
        p_query_embedding: embeddingStr,
        p_project_id: options.domainId || null,
        p_source_project: options.sourceProject || null,
        p_category: options.category || null,
        p_tags: options.tags || null,
        p_include_archived: options.includeArchived || false,
        p_include_portable: options.includeUniversal ?? true,
        p_agent_type: options.agentType || null,
        p_limit: options.limit || 10,
        p_similarity_threshold: options.similarityThreshold || 0.3,
      })

      if (error) {
        console.error('[VectorDB] Error searching memories (cross-project):', error)
      } else {
        return (data || []).map((row: SearchResultRow) => rowToSearchResult(row))
      }
    }

    const { data, error } = await (client.rpc as any)('search_memories', {
      p_query_embedding: embeddingStr,
      p_project_id: options.domainId || null,
      p_category: options.category || null,
      p_tags: options.tags || null,
      p_include_archived: options.includeArchived || false,
      p_limit: options.limit || 10,
      p_similarity_threshold: options.similarityThreshold || 0.3,
      p_latest_only: options.latestOnly ?? true,
    })

    if (error) {
      console.error('[VectorDB] Error searching memories:', error)
      throw new Error(`Failed to search memories: ${error.message}`)
    }

    return (data || []).map((row: SearchResultRow) => rowToSearchResult(row))
  }

  async getById(id: string): Promise<Memory | null> {
    const client = getMemoryClient()

    const { data, error } = await (client
      .from(getTableName()) as any)
      .select()
      .eq('id', id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return null
      console.error('[VectorDB] Error getting memory:', error)
      throw new Error(`Failed to get memory: ${error.message}`)
    }

    return rowToMemory(data as MemoryRow)
  }

  async update(id: string, updates: MemoryUpdate): Promise<Memory> {
    const client = getMemoryClient()

    const current = await this.getById(id)
    if (!current) {
      throw new Error(`Memory not found: ${id}`)
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (updates.content !== undefined) {
      updateData.content = updates.content
      const embeddingResult = await generateEmbedding(updates.content)
      updateData.embedding = formatEmbeddingForPgVector(embeddingResult.embedding)
      updateData.embedding_model = embeddingResult.model
      updateData.embedding_model_version = embeddingResult.modelVersion
    }

    if (updates.summary !== undefined) updateData.summary = updates.summary
    if (updates.category !== undefined) updateData.category = updates.category
    if (updates.tags !== undefined) updateData.tags = updates.tags
    if (updates.contextTags !== undefined) updateData.context_tags = updates.contextTags
    if (updates.confidence !== undefined) updateData.original_confidence = updates.confidence
    if (updates.relatedTo !== undefined) updateData.related_to = updates.relatedTo
    if (updates.isContradiction !== undefined) updateData.is_contradiction = updates.isContradiction

    if (updates.content && updates.content !== current.content) {
      await (client.from('traqr_memory_history') as any).insert({
        memory_id: id,
        previous_content: current.content,
        previous_confidence: current.originalConfidence,
        change_reason: updates.changeReason || 'Content updated',
      })
    }

    const { data, error } = await (client
      .from(getTableName()) as any)
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('[VectorDB] Error updating memory:', error)
      throw new Error(`Failed to update memory: ${error.message}`)
    }

    return rowToMemory(data as MemoryRow)
  }

  async delete(id: string): Promise<void> {
    const client = getMemoryClient()

    const { error } = await (client
      .from(getTableName()) as any)
      .delete()
      .eq('id', id)

    if (error) {
      console.error('[VectorDB] Error deleting memory:', error)
      throw new Error(`Failed to delete memory: ${error.message}`)
    }
  }

  async validate(id: string): Promise<Memory> {
    const client = getMemoryClient()

    const { data, error } = await (client
      .from(getTableName()) as any)
      .update({
        last_validated: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('[VectorDB] Error validating memory:', error)
      throw new Error(`Failed to validate memory: ${error.message}`)
    }

    return rowToMemory(data as MemoryRow)
  }

  async invalidate(id: string): Promise<void> {
    const client = getMemoryClient()
    const { error } = await (client
      .from(getTableName()) as any)
      .update({
        invalid_at: new Date().toISOString(),
        is_latest: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) {
      console.warn('[VectorDB] Error invalidating memory:', error.message)
    }
  }

  async supersede(id: string): Promise<void> {
    const client = getMemoryClient()
    const { error } = await (client
      .from(getTableName()) as any)
      .update({
        is_latest: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) {
      console.warn('[VectorDB] Error superseding memory:', error.message)
    }
  }

  async archive(id: string, reason?: string): Promise<Memory> {
    const client = getMemoryClient()

    const { data, error } = await (client
      .from(getTableName()) as any)
      .update({
        is_archived: true,
        archived_at: new Date().toISOString(),
        archive_reason: reason || 'manual',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('[VectorDB] Error archiving memory:', error)
      throw new Error(`Failed to archive memory: ${error.message}`)
    }

    return rowToMemory(data as MemoryRow)
  }

  async unarchive(id: string): Promise<Memory> {
    const client = getMemoryClient()

    const { data, error } = await (client
      .from(getTableName()) as any)
      .update({
        is_archived: false,
        archived_at: null,
        archive_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('[VectorDB] Error unarchiving memory:', error)
      throw new Error(`Failed to unarchive memory: ${error.message}`)
    }

    return rowToMemory(data as MemoryRow)
  }

  async exportAll(domainId?: string): Promise<MemoryExport[]> {
    const client = getMemoryClient()

    let query = (client.from(getTableName()) as any).select('*')

    if (domainId) {
      query = query.eq('project_id', domainId)
    }

    const { data, error } = await query

    if (error) {
      console.error('[VectorDB] Error exporting memories:', error)
      throw new Error(`Failed to export memories: ${error.message}`)
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      content: row.content,
      summary: row.summary ?? undefined,
      category: row.category as MemoryCategory | undefined,
      tags: row.tags || [],
      contextTags: row.context_tags || [],
      sourceType: row.source_type,
      sourceRef: row.source_ref ?? undefined,
      sourceProject: row.source_project,
      originalConfidence: row.original_confidence,
      lastValidated: row.last_validated,
      relatedTo: row.related_to || [],
      isContradiction: row.is_contradiction,
      isArchived: row.is_archived,
      archiveReason: row.archive_reason ?? undefined,
      durability: row.durability,
      expiresAt: row.expires_at ?? undefined,
      embeddingModel: row.embedding_model,
      embeddingModelVersion: row.embedding_model_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      domainName: undefined,
      userEmail: undefined,
    }))
  }

  async importBulk(memories: MemoryExport[], domainId: string): Promise<number> {
    const client = getMemoryClient()
    let importedCount = 0
    const BATCH_SIZE = 10

    for (let i = 0; i < memories.length; i += BATCH_SIZE) {
      const batch = memories.slice(i, i + BATCH_SIZE)

      const embeddings = await Promise.all(
        batch.map(m => generateEmbedding(m.content))
      )

      const insertData = batch.map((memory, idx) => ({
        user_id: getUserId(),
        project_id: domainId,
        content: memory.content,
        summary: memory.summary,
        category: memory.category,
        tags: memory.tags,
        context_tags: memory.contextTags,
        embedding: formatEmbeddingForPgVector(embeddings[idx].embedding),
        embedding_model: embeddings[idx].model,
        embedding_model_version: embeddings[idx].modelVersion,
        source_type: memory.sourceType,
        source_ref: memory.sourceRef,
        source_project: memory.sourceProject,
        original_confidence: memory.originalConfidence,
        last_validated: memory.lastValidated,
        related_to: memory.relatedTo,
        is_contradiction: memory.isContradiction,
        is_archived: memory.isArchived,
        archive_reason: memory.archiveReason,
        created_at: memory.createdAt,
        updated_at: memory.updatedAt,
        is_portable: true,
      }))

      const { error } = await (client.from(getTableName()) as any).insert(insertData)

      if (error) {
        console.error(`[VectorDB] Error importing batch ${i / BATCH_SIZE}:`, error)
      } else {
        importedCount += batch.length
      }
    }

    return importedCount
  }

  async createDomain(name: string, description?: string, userId?: string): Promise<MemoryDomain> {
    const client = getMemoryClient()

    const { data, error } = await (client
      .from('traqr_projects') as any)
      .insert({
        user_id: userId || getUserId(),
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        description,
        is_active: true,
      })
      .select()
      .single()

    if (error) {
      console.error('[VectorDB] Error creating domain:', error)
      throw new Error(`Failed to create domain: ${error.message}`)
    }

    return {
      id: data.id,
      userId: data.user_id,
      name: data.name,
      description: data.description ?? undefined,
      isShareable: data.is_active,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.last_activity),
    }
  }

  async getDomain(name: string): Promise<MemoryDomain | null> {
    const client = getMemoryClient()

    const { data, error } = await (client
      .from('traqr_projects') as any)
      .select()
      .eq('slug', name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
      .single()

    if (error) {
      if (error.code === 'PGRST116') return null
      console.error('[VectorDB] Error getting domain:', error)
      throw new Error(`Failed to get domain: ${error.message}`)
    }

    return {
      id: data.id,
      userId: data.user_id,
      name: data.name,
      description: data.description ?? undefined,
      isShareable: data.is_active,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.last_activity),
    }
  }

  async getDefaultDomain(): Promise<MemoryDomain> {
    const client = getMemoryClient()

    const { data, error } = await (client
      .from('traqr_projects') as any)
      .select()
      .eq('id', getProjectId())
      .single()

    if (error) {
      console.error('[VectorDB] Error getting default domain:', error)
      throw new Error(`Failed to get default domain: ${error.message}`)
    }

    return {
      id: data.id,
      userId: data.user_id,
      name: data.name,
      description: data.description ?? undefined,
      isShareable: data.is_active,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.last_activity),
    }
  }

  // ============================================================
  // v2 Search Strategies (I-M4) — additive, graceful degradation
  // ============================================================

  async bm25Search(queryText: string, options?: {
    projectId?: string, domain?: string, category?: string,
    limit?: number, minScore?: number
  }): Promise<BM25SearchResult[]> {
    const client = getMemoryClient()
    const { data, error } = await (client.rpc as any)('bm25_search', {
      p_query_text: queryText,
      p_project_id: options?.projectId || null,
      p_domain: options?.domain || null,
      p_category: options?.category || null,
      p_limit: options?.limit || 20,
      p_min_score: options?.minScore || 0.01,
    })
    if (error) {
      console.error('[VectorDB] BM25 search error:', error)
      return []
    }
    return (data || []).map((row: any) => ({
      id: row.id,
      content: row.content,
      summary: row.summary ?? undefined,
      bm25Score: row.bm25_score,
      domain: row.domain ?? undefined,
      category: row.category ?? undefined,
      memoryType: row.memory_type ?? undefined,
    }))
  }

  async temporalSearch(query: string, dateStart: Date, dateEnd: Date, options?: {
    projectId?: string, similarityThreshold?: number, limit?: number, precomputedEmbedding?: string
  }): Promise<TemporalSearchResult[]> {
    const client = getMemoryClient()
    const embeddingStr = options?.precomputedEmbedding
      ?? formatEmbeddingForPgVector((await generateEmbedding(query)).embedding)
    const { data, error } = await (client.rpc as any)('temporal_search', {
      p_query_embedding: embeddingStr,
      p_date_start: dateStart.toISOString(),
      p_date_end: dateEnd.toISOString(),
      p_project_id: options?.projectId || null,
      p_similarity_threshold: options?.similarityThreshold || 0.3,
      p_limit: options?.limit || 20,
    })
    if (error) {
      console.error('[VectorDB] Temporal search error:', error)
      return []
    }
    return (data || []).map((row: any) => ({
      id: row.id,
      content: row.content,
      summary: row.summary ?? undefined,
      similarity: row.similarity,
      temporalProximity: row.temporal_proximity,
      validAt: new Date(row.valid_at),
    }))
  }

  async graphSearch(seedIds: string[], options?: {
    edgeTypes?: string[], maxDepth?: number, limit?: number
  }): Promise<GraphSearchResult[]> {
    const client = getMemoryClient()
    const { data, error } = await (client.rpc as any)('graph_search', {
      p_seed_ids: seedIds,
      p_edge_types: options?.edgeTypes || ['updates', 'extends', 'derives', 'related'],
      p_max_depth: options?.maxDepth || 2,
      p_limit: options?.limit || 20,
    })
    if (error) {
      console.error('[VectorDB] Graph search error:', error)
      return []
    }
    return (data || []).map((row: any) => ({
      id: row.id,
      content: row.content,
      summary: row.summary ?? undefined,
      graphScore: row.graph_score,
      edgeType: row.edge_type,
      depth: row.depth,
    }))
  }

  // ============================================================
  // ENTITY OPERATIONS
  // ============================================================

  async findEntityByName(name: string, entityType: string): Promise<any | null> {
    const client = getMemoryClient()
    const { data, error } = await (client.from('memory_entities') as any)
      .select('*')
      .eq('user_id', getUserId())
      .ilike('name', name.trim())
      .eq('entity_type', entityType)
      .eq('is_archived', false)
      .limit(1)
      .maybeSingle()
    if (error || !data) return null
    return data
  }

  async findEntityByNameFuzzy(name: string, entityType: string): Promise<any | null> {
    const client = getMemoryClient()
    const { data, error } = await (client.from('memory_entities') as any)
      .select('*')
      .eq('user_id', getUserId())
      .ilike('name', `%${name.trim().replace(/[%_]/g, '\\$&')}%`)
      .eq('entity_type', entityType)
      .eq('is_archived', false)
      .limit(1)
      .maybeSingle()
    if (error || !data) return null
    return data
  }

  async findEntityByEmbedding(embeddingStr: string, entityType: string, threshold: number = 0.85): Promise<any | null> {
    const client = getMemoryClient()
    const { data, error } = await (client.rpc as any)('search_entities', {
      p_embedding: embeddingStr,
      p_user_id: getUserId(),
      p_entity_type: entityType,
      p_threshold: threshold,
      p_limit: 1,
    })
    if (error || !data || data.length === 0) return null
    return data[0]
  }

  async createEntity(entity: {
    name: string, entityType: string, embedding?: string, userId?: string
  }): Promise<any> {
    const client = getMemoryClient()
    const { data, error } = await (client.from('memory_entities') as any)
      .insert({
        user_id: entity.userId || getUserId(),
        name: entity.name,
        entity_type: entity.entityType,
        embedding: entity.embedding || null,
        mentions_count: 1,
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      })
      .select()
      .single()
    if (error) {
      // UNIQUE constraint violation = entity already exists, find and return it
      if (error.code === '23505') {
        return this.findEntityByName(entity.name, entity.entityType)
      }
      console.warn('[VectorDB] Error creating entity:', error.message)
      return null
    }
    return data
  }

  async incrementEntityMentions(entityId: string): Promise<void> {
    const client = getMemoryClient()
    // Read current count, increment, write back
    const { data } = await (client.from('memory_entities') as any)
      .select('mentions_count')
      .eq('id', entityId)
      .single()
    const newCount = (data?.mentions_count || 0) + 1
    const { error } = await (client.from('memory_entities') as any)
      .update({
        mentions_count: newCount,
        last_seen_at: new Date().toISOString(),
      })
      .eq('id', entityId)
    if (error) {
      console.warn('[VectorDB] Error incrementing entity mentions:', error.message)
    }
  }

  async linkMemoryToEntity(memoryId: string, entityId: string, role: string = 'mentions'): Promise<void> {
    const client = getMemoryClient()
    const { error } = await (client.from('memory_entity_links') as any)
      .insert({
        memory_id: memoryId,
        entity_id: entityId,
        role,
      })
    if (error && error.code !== '23505') { // ignore duplicate links
      console.warn('[VectorDB] Error linking memory to entity:', error.message)
    }
  }

  async findEntitiesByNames(names: string[]): Promise<{ id: string; name: string }[]> {
    if (names.length === 0) return []
    const client = getMemoryClient()
    const lowerNames = names.map((n) => n.toLowerCase().trim()).filter(Boolean)
    const { data, error } = await (client.from('memory_entities') as any)
      .select('id, name')
      .eq('user_id', getUserId())
      .eq('is_archived', false)
      .in('name', lowerNames) // exact match on lowercase names
    if (error || !data) {
      // Fallback: try ILIKE for case-insensitive matching
      const results: { id: string; name: string }[] = []
      for (const name of lowerNames.slice(0, 10)) { // limit to avoid N+1 explosion
        const { data: d } = await (client.from('memory_entities') as any)
          .select('id, name')
          .eq('user_id', getUserId())
          .eq('is_archived', false)
          .ilike('name', name)
          .limit(1)
          .maybeSingle()
        if (d) results.push({ id: d.id, name: d.name })
      }
      return results
    }
    return (data || []).map((d: any) => ({ id: d.id, name: d.name }))
  }

  async findOrphanedEntities(): Promise<string[]> {
    const client = getMemoryClient()
    // Find entities with zero non-archived memory links
    const { data, error } = await (client.from('memory_entities') as any)
      .select('id')
      .eq('user_id', getUserId())
      .eq('is_archived', false)
    if (error || !data) return []

    const orphaned: string[] = []
    for (const entity of data) {
      const { count } = await (client.from('memory_entity_links') as any)
        .select('*', { count: 'exact', head: true })
        .eq('entity_id', entity.id)
      if (count === 0) orphaned.push(entity.id)
    }
    return orphaned
  }

  async archiveEntities(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0
    const client = getMemoryClient()
    const { error } = await (client.from('memory_entities') as any)
      .update({ is_archived: true })
      .in('id', ids)
    if (error) {
      console.warn('[VectorDB] Error archiving entities:', error.message)
      return 0
    }
    return ids.length
  }

  async ping(): Promise<boolean> {
    try {
      const client = getMemoryClient()
      const { error } = await (client.from('traqr_users') as any).select('id').limit(1)
      return !error
    } catch {
      return false
    }
  }
}
