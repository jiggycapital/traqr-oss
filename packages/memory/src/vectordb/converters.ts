/**
 * Shared Row-to-Type Converters
 *
 * Database row types and converter functions shared between
 * SupabaseVectorProvider and PostgresVectorProvider.
 */

import type {
  Memory,
  MemorySearchResult,
  MemoryCategory,
  MemoryClassification,
  MemoryDurability,
  MemoryRetentionPolicy,
  MemoryType,
} from './types.js'
import { decrypt } from '../lib/encryption.js'

// Database row type matching traqr_memories schema
export interface MemoryRow {
  id: string
  user_id: string
  project_id: string | null
  content: string
  summary: string | null
  category: string | null
  tags: string[]
  context_tags: string[]
  domain: string | null
  topic: string | null
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
  // v3: Security classification (Glasswing Red Alert)
  classification?: string | null
  client_namespace?: string | null
  contains_pii?: boolean | null
  // v3: Application-level encryption (TD-715)
  encrypted_content?: string | null
  encryption_iv?: string | null
  encryption_tag?: string | null
  encryption_key_version?: number | null
  // v4: Retention policies (Glasswing TD-716)
  retention_policy?: string | null
  retention_expires_at?: string | null
}

export interface SearchResultRow extends MemoryRow {
  current_confidence: number
  similarity: number
  relevance_score: number
}

export function rowToMemory(row: MemoryRow): Memory {
  // Transparent decryption: if encrypted_content exists, decrypt it
  let content = row.content
  if (row.encrypted_content && row.encryption_iv && row.encryption_tag) {
    const decrypted = decrypt({
      ciphertext: row.encrypted_content,
      iv: row.encryption_iv,
      authTag: row.encryption_tag,
      keyVersion: row.encryption_key_version || 1,
    })
    if (decrypted) {
      content = decrypted
    }
    // If decryption fails (key missing/rotated), content stays as placeholder
  }

  return {
    id: row.id,
    content,
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
    domain: row.domain ?? undefined,
    topic: row.topic ?? undefined,
    isUniversal: row.is_universal ?? false,
    agentType: row.agent_type ?? undefined,
    timesReturned: row.times_returned ?? 0,
    timesCited: row.times_cited ?? 0,
    lastReturnedAt: row.last_returned_at ? new Date(row.last_returned_at) : undefined,
    lastCitedAt: row.last_cited_at ? new Date(row.last_cited_at) : undefined,
    memoryType: (row.memory_type as MemoryType) ?? undefined,
    validAt: row.valid_at ? new Date(row.valid_at) : undefined,
    invalidAt: row.invalid_at ? new Date(row.invalid_at) : undefined,
    isLatest: row.is_latest ?? true,
    isForgotten: row.is_forgotten ?? false,
    forgottenAt: row.forgotten_at ? new Date(row.forgotten_at) : undefined,
    forgetAfter: row.forget_after ? new Date(row.forget_after) : undefined,
    sourceTool: row.source_tool ?? undefined,
    // v3: Security classification
    classification: (row.classification as MemoryClassification) ?? 'internal',
    clientNamespace: row.client_namespace ?? undefined,
    containsPii: row.contains_pii ?? false,
    // v4: Retention policies
    retentionPolicy: (row.retention_policy as MemoryRetentionPolicy) ?? 'permanent',
    retentionExpiresAt: row.retention_expires_at ? new Date(row.retention_expires_at) : undefined,
  }
}

export function rowToSearchResult(row: SearchResultRow): MemorySearchResult {
  return {
    ...rowToMemory(row),
    currentConfidence: row.current_confidence,
    similarity: row.similarity,
    relevanceScore: row.relevance_score,
  }
}
