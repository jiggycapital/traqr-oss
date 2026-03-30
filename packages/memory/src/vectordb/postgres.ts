/**
 * Postgres VectorDB Provider
 *
 * Implementation of VectorDBProvider using raw pg wire protocol.
 * Calls the same SQL functions as SupabaseVectorProvider, but via
 * parameterized queries instead of PostgREST RPC.
 *
 * Requires: npm install pg (dynamic import — not a hard dependency)
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { getUserId, getProjectId, getTableName, getMemoryConfig } from '../lib/client.js'
import { generateEmbedding, formatEmbeddingForPgVector } from '../lib/embeddings.js'
import { rowToMemory, rowToSearchResult } from './converters.js'
import type { MemoryRow, SearchResultRow } from './converters.js'
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
  BrowseResult,
  BM25SearchResult,
  TemporalSearchResult,
  GraphSearchResult,
} from './types.js'

// ---------------------------------------------------------------------------
// Pool Management (lazy, dynamic import)
// ---------------------------------------------------------------------------

let _pool: any = null

async function getPool(): Promise<any> {
  if (_pool) return _pool
  try {
    const pg = await (Function('return import("pg")')() as Promise<any>)
    const Pool = pg.default?.Pool || pg.Pool
    const config = getMemoryConfig()
    _pool = new Pool({
      connectionString: config.databaseUrl,
      max: 5,
      idleTimeoutMillis: 30000,
    })
    return _pool
  } catch {
    throw new Error(
      'Raw Postgres requires the pg package.\n' +
      'Install it: npm install pg\n' +
      'Then set DATABASE_URL to your Postgres 15+ connection string with pgvector enabled.'
    )
  }
}

/** Reset pool (for testing or reconfiguration) */
export function resetPostgresPool(): void {
  if (_pool) {
    _pool.end().catch(() => {})
    _pool = null
  }
}

// ---------------------------------------------------------------------------
// Query Helpers
// ---------------------------------------------------------------------------

async function query(sql: string, params?: any[]): Promise<any[]> {
  const pool = await getPool()
  const result = await pool.query(sql, params)
  return result.rows
}

async function queryOne(sql: string, params?: any[]): Promise<any | null> {
  const rows = await query(sql, params)
  return rows[0] || null
}

// ---------------------------------------------------------------------------
// PostgresVectorProvider
// ---------------------------------------------------------------------------

export class PostgresVectorProvider implements VectorDBProvider {
  // ============================================================
  // CORE OPERATIONS
  // ============================================================

  async store(input: MemoryInput, domainId?: string): Promise<Memory> {
    const projectId = domainId || getProjectId()
    const table = getTableName()

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

    const row = await queryOne(
      `INSERT INTO ${table} (
        user_id, project_id, content, summary, category, tags, context_tags,
        embedding, embedding_model, embedding_model_version,
        source_type, source_ref, source_project, original_confidence,
        related_to, is_contradiction, is_universal, agent_type,
        durability, expires_at, is_portable, domain, topic,
        memory_type, source_tool, valid_at, forget_after, is_latest, is_forgotten
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8::vector, $9, $10,
        $11, $12, $13, $14,
        $15, $16, $17, $18,
        $19, $20, $21, $22, $23,
        $24, $25, $26, $27, $28, $29
      ) RETURNING *`,
      [
        getUserId(), projectId, input.content, input.summary || null,
        input.category || null, input.tags || [], input.contextTags || [],
        embeddingStr, embeddingModel, embeddingModelVersion,
        input.sourceType, input.sourceRef || null, input.sourceProject || 'default',
        input.confidence ?? 1.0,
        input.relatedTo || [], input.isContradiction || false,
        input.isUniversal || false, input.agentType || null,
        input.durability || 'permanent',
        input.expiresAt ? input.expiresAt.toISOString() : null,
        true, input.domain || null, input.topic || null,
        input.memoryType || null, input.sourceTool || null,
        input.validAt ? input.validAt.toISOString() : new Date().toISOString(),
        input.forgetAfter ? input.forgetAfter.toISOString() : null,
        true, false,
      ],
    )

    if (!row) throw new Error('Failed to store memory: no row returned')
    return rowToMemory(row as MemoryRow)
  }

  async search(queryText: string, options: SearchOptions & { precomputedEmbedding?: string } = {}): Promise<MemorySearchResult[]> {
    const embeddingStr = options.precomputedEmbedding
      ?? formatEmbeddingForPgVector((await generateEmbedding(queryText)).embedding)

    if (options.includeUniversal || options.sourceProject || options.agentType) {
      const rows = await query(
        'SELECT * FROM search_memories_cross_project($1::vector, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        [
          embeddingStr,
          options.domainId || null,
          options.sourceProject || null,
          options.category || null,
          options.tags || null,
          options.includeArchived || false,
          options.includeUniversal ?? true,
          options.agentType || null,
          options.limit || 10,
          options.similarityThreshold || 0.3,
        ],
      )
      return rows.map((row: SearchResultRow) => rowToSearchResult(row))
    }

    const rows = await query(
      'SELECT * FROM search_memories($1::vector, $2, $3, $4, $5, $6, $7, $8)',
      [
        embeddingStr,
        options.domainId || null,
        options.category || null,
        options.tags || null,
        options.includeArchived || false,
        options.limit || 10,
        options.similarityThreshold || 0.3,
        options.latestOnly ?? true,
      ],
    )
    return rows.map((row: SearchResultRow) => rowToSearchResult(row))
  }

  async getById(id: string): Promise<Memory | null> {
    const row = await queryOne(
      `SELECT * FROM ${getTableName()} WHERE id = $1`,
      [id],
    )
    if (!row) return null
    return rowToMemory(row as MemoryRow)
  }

  async update(id: string, updates: MemoryUpdate): Promise<Memory> {
    const table = getTableName()
    const current = await this.getById(id)
    if (!current) throw new Error(`Memory not found: ${id}`)

    const sets: string[] = ['updated_at = NOW()']
    const params: any[] = []
    let paramIdx = 1

    if (updates.content !== undefined) {
      const embResult = await generateEmbedding(updates.content)
      sets.push(`content = $${paramIdx++}`)
      params.push(updates.content)
      sets.push(`embedding = $${paramIdx}::vector`)
      params.push(formatEmbeddingForPgVector(embResult.embedding))
      paramIdx++
      sets.push(`embedding_model = $${paramIdx++}`)
      params.push(embResult.model)
      sets.push(`embedding_model_version = $${paramIdx++}`)
      params.push(embResult.modelVersion)
    }

    if (updates.summary !== undefined) { sets.push(`summary = $${paramIdx++}`); params.push(updates.summary) }
    if (updates.category !== undefined) { sets.push(`category = $${paramIdx++}`); params.push(updates.category) }
    if (updates.tags !== undefined) { sets.push(`tags = $${paramIdx++}`); params.push(updates.tags) }
    if (updates.contextTags !== undefined) { sets.push(`context_tags = $${paramIdx++}`); params.push(updates.contextTags) }
    if (updates.confidence !== undefined) { sets.push(`original_confidence = $${paramIdx++}`); params.push(updates.confidence) }
    if (updates.relatedTo !== undefined) { sets.push(`related_to = $${paramIdx++}`); params.push(updates.relatedTo) }
    if (updates.isContradiction !== undefined) { sets.push(`is_contradiction = $${paramIdx++}`); params.push(updates.isContradiction) }

    // Write history if content changed
    if (updates.content && updates.content !== current.content) {
      await query(
        `INSERT INTO traqr_memory_history (memory_id, previous_content, previous_confidence, change_reason)
         VALUES ($1, $2, $3, $4)`,
        [id, current.content, current.originalConfidence, updates.changeReason || 'Content updated'],
      )
    }

    params.push(id)
    const row = await queryOne(
      `UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      params,
    )
    if (!row) throw new Error(`Failed to update memory: ${id}`)
    return rowToMemory(row as MemoryRow)
  }

  async delete(id: string): Promise<void> {
    await query(`DELETE FROM ${getTableName()} WHERE id = $1`, [id])
  }

  async validate(id: string): Promise<Memory> {
    const row = await queryOne(
      `UPDATE ${getTableName()} SET last_validated = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id],
    )
    if (!row) throw new Error(`Failed to validate memory: ${id}`)
    return rowToMemory(row as MemoryRow)
  }

  // ============================================================
  // ARCHIVE OPERATIONS
  // ============================================================

  async archive(id: string, reason?: string): Promise<Memory> {
    const row = await queryOne(
      `UPDATE ${getTableName()} SET is_archived = true, archived_at = NOW(),
       archive_reason = $2, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, reason || 'manual'],
    )
    if (!row) throw new Error(`Failed to archive memory: ${id}`)
    return rowToMemory(row as MemoryRow)
  }

  async unarchive(id: string): Promise<Memory> {
    const row = await queryOne(
      `UPDATE ${getTableName()} SET is_archived = false, archived_at = NULL,
       archive_reason = NULL, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id],
    )
    if (!row) throw new Error(`Failed to unarchive memory: ${id}`)
    return rowToMemory(row as MemoryRow)
  }

  // ============================================================
  // BULK OPERATIONS
  // ============================================================

  async exportAll(domainId?: string): Promise<MemoryExport[]> {
    const table = getTableName()
    const sql = domainId
      ? `SELECT * FROM ${table} WHERE project_id = $1`
      : `SELECT * FROM ${table}`
    const rows = await query(sql, domainId ? [domainId] : [])
    return rows.map((row: any) => ({
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
    }))
  }

  async importBulk(memories: MemoryExport[], domainId: string): Promise<number> {
    const table = getTableName()
    let importedCount = 0
    const BATCH_SIZE = 10

    for (let i = 0; i < memories.length; i += BATCH_SIZE) {
      const batch = memories.slice(i, i + BATCH_SIZE)
      const embeddings = await Promise.all(batch.map(m => generateEmbedding(m.content)))

      for (let j = 0; j < batch.length; j++) {
        const m = batch[j]
        const emb = embeddings[j]
        try {
          await query(
            `INSERT INTO ${table} (
              user_id, project_id, content, summary, category, tags, context_tags,
              embedding, embedding_model, embedding_model_version,
              source_type, source_ref, source_project, original_confidence,
              last_validated, related_to, is_contradiction, is_archived,
              archive_reason, created_at, updated_at, is_portable
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
            [
              getUserId(), domainId, m.content, m.summary || null,
              m.category || null, m.tags, m.contextTags,
              formatEmbeddingForPgVector(emb.embedding), emb.model, emb.modelVersion,
              m.sourceType, m.sourceRef || null, m.sourceProject,
              m.originalConfidence, m.lastValidated, m.relatedTo,
              m.isContradiction, m.isArchived, m.archiveReason || null,
              m.createdAt, m.updatedAt, true,
            ],
          )
          importedCount++
        } catch (err) {
          console.error(`[VectorDB] Error importing memory ${i + j}:`, err instanceof Error ? err.message : err)
        }
      }
    }
    return importedCount
  }

  // ============================================================
  // DOMAIN MANAGEMENT
  // ============================================================

  async createDomain(name: string, description?: string, userId?: string): Promise<MemoryDomain> {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const row = await queryOne(
      `INSERT INTO traqr_projects (user_id, name, slug, description, is_active)
       VALUES ($1, $2, $3, $4, true) RETURNING *`,
      [userId || getUserId(), name, slug, description || null],
    )
    if (!row) throw new Error(`Failed to create domain: ${name}`)
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      description: row.description ?? undefined,
      isShareable: row.is_active,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.last_activity || row.created_at),
    }
  }

  async getDomain(name: string): Promise<MemoryDomain | null> {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const row = await queryOne(
      `SELECT * FROM traqr_projects WHERE slug = $1`,
      [slug],
    )
    if (!row) return null
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      description: row.description ?? undefined,
      isShareable: row.is_active,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.last_activity || row.created_at),
    }
  }

  async getDefaultDomain(): Promise<MemoryDomain> {
    const row = await queryOne(
      `SELECT * FROM traqr_projects WHERE id = $1`,
      [getProjectId()],
    )
    if (!row) throw new Error('Failed to get default domain')
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      description: row.description ?? undefined,
      isShareable: row.is_active,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.last_activity || row.created_at),
    }
  }

  // ============================================================
  // v2 SEARCH STRATEGIES
  // ============================================================

  async bm25Search(queryText: string, options?: {
    projectId?: string, domain?: string, category?: string,
    limit?: number, minScore?: number
  }): Promise<BM25SearchResult[]> {
    const rows = await query(
      'SELECT * FROM bm25_search($1, $2, $3, $4, $5, $6)',
      [
        queryText,
        options?.projectId || null,
        options?.domain || null,
        options?.category || null,
        options?.limit || 20,
        options?.minScore || 0.01,
      ],
    )
    return rows.map((row: any) => ({
      id: row.id,
      content: row.content,
      summary: row.summary ?? undefined,
      bm25Score: row.bm25_score,
      domain: row.domain ?? undefined,
      category: row.category ?? undefined,
      memoryType: row.memory_type ?? undefined,
    }))
  }

  async temporalSearch(queryText: string, dateStart: Date, dateEnd: Date, options?: {
    projectId?: string, similarityThreshold?: number, limit?: number, precomputedEmbedding?: string
  }): Promise<TemporalSearchResult[]> {
    const embeddingStr = options?.precomputedEmbedding
      ?? formatEmbeddingForPgVector((await generateEmbedding(queryText)).embedding)
    const rows = await query(
      'SELECT * FROM temporal_search($1::vector, $2, $3, $4, $5, $6)',
      [
        embeddingStr,
        dateStart.toISOString(),
        dateEnd.toISOString(),
        options?.projectId || null,
        options?.similarityThreshold || 0.3,
        options?.limit || 20,
      ],
    )
    return rows.map((row: any) => ({
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
    const rows = await query(
      'SELECT * FROM graph_search($1, $2, $3, $4)',
      [
        seedIds,
        options?.edgeTypes || ['updates', 'extends', 'derives', 'related'],
        options?.maxDepth || 2,
        options?.limit || 20,
      ],
    )
    return rows.map((row: any) => ({
      id: row.id,
      content: row.content,
      summary: row.summary ?? undefined,
      graphScore: row.graph_score,
      edgeType: row.edge_type,
      depth: row.depth,
    }))
  }

  // ============================================================
  // LIFECYCLE
  // ============================================================

  async invalidate(id: string): Promise<void> {
    await query(
      `UPDATE ${getTableName()} SET invalid_at = NOW(), is_latest = false, updated_at = NOW()
       WHERE id = $1`,
      [id],
    )
  }

  async supersede(id: string): Promise<void> {
    await query(
      `UPDATE ${getTableName()} SET is_latest = false, updated_at = NOW()
       WHERE id = $1`,
      [id],
    )
  }

  // ============================================================
  // ENTITY OPERATIONS
  // ============================================================

  async findEntityByName(name: string, entityType: string): Promise<any | null> {
    return queryOne(
      `SELECT * FROM memory_entities
       WHERE user_id = $1 AND LOWER(name) = LOWER($2) AND entity_type = $3 AND is_archived = false
       LIMIT 1`,
      [getUserId(), name.trim(), entityType],
    )
  }

  async findEntityByNameFuzzy(name: string, entityType: string): Promise<any | null> {
    const escaped = name.trim().replace(/[%_]/g, '\\$&')
    return queryOne(
      `SELECT * FROM memory_entities
       WHERE user_id = $1 AND name ILIKE $2 AND entity_type = $3 AND is_archived = false
       LIMIT 1`,
      [getUserId(), `%${escaped}%`, entityType],
    )
  }

  async findEntityByEmbedding(embeddingStr: string, entityType: string, threshold: number = 0.85): Promise<any | null> {
    const rows = await query(
      'SELECT * FROM search_entities($1::vector, $2, $3, $4, $5)',
      [embeddingStr, getUserId(), entityType, threshold, 1],
    )
    return rows[0] || null
  }

  async createEntity(entity: {
    name: string, entityType: string, embedding?: string, userId?: string
  }): Promise<any> {
    try {
      const row = await queryOne(
        `INSERT INTO memory_entities (user_id, name, entity_type, embedding, mentions_count, first_seen_at, last_seen_at)
         VALUES ($1, $2, $3, $4::vector, 1, NOW(), NOW()) RETURNING *`,
        [entity.userId || getUserId(), entity.name, entity.entityType, entity.embedding || null],
      )
      return row
    } catch (err: any) {
      if (err?.code === '23505') {
        return this.findEntityByName(entity.name, entity.entityType)
      }
      console.warn('[VectorDB] Error creating entity:', err?.message || err)
      return null
    }
  }

  async incrementEntityMentions(entityId: string): Promise<void> {
    await query(
      `UPDATE memory_entities SET mentions_count = mentions_count + 1, last_seen_at = NOW()
       WHERE id = $1`,
      [entityId],
    )
  }

  async linkMemoryToEntity(memoryId: string, entityId: string, role: string = 'mentions'): Promise<void> {
    try {
      await query(
        `INSERT INTO memory_entity_links (memory_id, entity_id, role) VALUES ($1, $2, $3)`,
        [memoryId, entityId, role],
      )
    } catch (err: any) {
      if (err?.code !== '23505') { // ignore duplicate links
        console.warn('[VectorDB] Error linking memory to entity:', err?.message || err)
      }
    }
  }

  async findEntitiesByNames(names: string[]): Promise<{ id: string; name: string }[]> {
    if (names.length === 0) return []
    const lowerNames = names.map(n => n.toLowerCase().trim()).filter(Boolean)
    const placeholders = lowerNames.map((_, i) => `$${i + 3}`).join(', ')
    const rows = await query(
      `SELECT id, name FROM memory_entities
       WHERE user_id = $1 AND is_archived = false AND LOWER(name) IN (${placeholders})`,
      [getUserId(), ...lowerNames],
    )
    if (rows.length > 0) return rows.map((d: any) => ({ id: d.id, name: d.name }))

    // Fallback: ILIKE for case-insensitive matching
    const results: { id: string; name: string }[] = []
    for (const name of lowerNames.slice(0, 10)) {
      const row = await queryOne(
        `SELECT id, name FROM memory_entities
         WHERE user_id = $1 AND is_archived = false AND name ILIKE $2
         LIMIT 1`,
        [getUserId(), name],
      )
      if (row) results.push({ id: row.id, name: row.name })
    }
    return results
  }

  async findOrphanedEntities(): Promise<string[]> {
    const entities = await query(
      `SELECT id FROM memory_entities WHERE user_id = $1 AND is_archived = false`,
      [getUserId()],
    )
    const orphaned: string[] = []
    for (const entity of entities) {
      const link = await queryOne(
        `SELECT 1 FROM memory_entity_links WHERE entity_id = $1 LIMIT 1`,
        [entity.id],
      )
      if (!link) orphaned.push(entity.id)
    }
    return orphaned
  }

  async archiveEntities(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ')
    await query(
      `UPDATE memory_entities SET is_archived = true WHERE id IN (${placeholders})`,
      ids,
    )
    return ids.length
  }

  // ============================================================
  // UTILITY OPERATIONS
  // ============================================================

  async browse(options?: { domain?: string, category?: string, limit?: number }): Promise<BrowseResult[]> {
    const table = getTableName()
    const conditions = ['is_archived = false', 'is_forgotten = false']
    const params: any[] = []
    let paramIdx = 1

    if (options?.domain) {
      conditions.push(`domain = $${paramIdx++}`)
      params.push(options.domain)
    }
    if (options?.category) {
      conditions.push(`category = $${paramIdx++}`)
      params.push(options.category)
    }

    const limit = options?.limit || 20
    params.push(limit)

    const rows = await query(
      `SELECT id, domain, category, content, summary FROM ${table}
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC LIMIT $${paramIdx}`,
      params,
    )
    return rows.map((r: any) => ({
      id: r.id,
      domain: r.domain ?? undefined,
      category: r.category ?? undefined,
      content: r.content,
      summary: r.summary ?? undefined,
    }))
  }

  async forget(id: string): Promise<void> {
    await query(
      `UPDATE ${getTableName()} SET is_forgotten = true, forgotten_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [id],
    )
  }

  async createRelationship(
    sourceId: string, targetId: string, edgeType: string,
    metadata: Record<string, unknown> = {},
  ): Promise<string | null> {
    try {
      const row = await queryOne(
        `INSERT INTO memory_relationships (source_memory_id, target_memory_id, edge_type, metadata)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [sourceId, targetId, edgeType, JSON.stringify(metadata)],
      )
      return row?.id || null
    } catch (err: any) {
      if (err?.code === '23505') return null // duplicate
      console.warn('[VectorDB] createRelationship error:', err?.message || err)
      return null
    }
  }

  async countEntityMentions(name: string, userId: string): Promise<number> {
    const row = await queryOne(
      'SELECT count_entity_mentions($1, $2) as count',
      [name, userId],
    )
    return row?.count ?? 0
  }

  async schemaVersion(): Promise<number | null> {
    try {
      const row = await queryOne(
        'SELECT version FROM schema_version ORDER BY version DESC LIMIT 1',
      )
      return row?.version ?? null
    } catch {
      return null
    }
  }

  async ping(): Promise<boolean> {
    try {
      await queryOne('SELECT 1 as ok')
      return true
    } catch {
      return false
    }
  }
}
