/**
 * VectorDB Provider Types
 *
 * Provider-agnostic types for the memory system.
 * These types are designed to be portable across different vector databases
 * (Supabase pgvector, Pinecone, Qdrant, etc.)
 */

// Memory categories for organizing learnings
/**
 * The canonical category list. Every runtime check derives from this array.
 * Do not hand-maintain a second copy.
 *
 * TD-1334: the borderline ACTION list lived in four hand-maintained places,
 * one was missed, and a valid verdict was rejected as malformed for 150 days.
 * When that was found, THIS list had six copies in this package. A copy typed
 * `MemoryCategory[]` catches an INVALID value at compile time but is silent
 * about a MISSING one — and missing is the direction that bit us.
 *
 *   gotcha      Common pitfalls and mistakes to avoid
 *   pattern     Reusable patterns that work well
 *   fix         Bug fixes and solutions
 *   insight     General insights and learnings
 *   question    Open questions still being explored
 *   preference  Coding style, design choices, how the developer likes things done
 *   convention  Project rules, naming patterns, file structure conventions
 */
export const MEMORY_CATEGORIES = [
  'gotcha', 'pattern', 'fix', 'insight', 'question', 'preference', 'convention',
] as const

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number]

// Source types for tracking where memories came from
export type MemorySourceType =
  | 'pr'              // Created from a PR via /ship --memory
  | 'manual'          // Manually entered via /memory store
  | 'extracted'       // Auto-extracted by LLM from codebase
  | 'bootstrap'       // Imported from _learnings.md files
  | 'advisor_session' // Created from advisor session learnings
  | 'plan'            // Extracted from approved plans
  | 'web_research'    // Acquired via /learn research from web sources
  | 'session'         // Learnings captured at ship/session time
  | 'codebase_analysis' // Learnings from deep codebase scanning

// Durability levels for memory lifecycle management
export type MemoryDurability = 'permanent' | 'temporary' | 'session'

// Security classification levels (Glasswing Red Alert)
export type MemoryClassification = 'public' | 'internal' | 'confidential' | 'restricted'

// Agent access levels for mode-specific memory access control
export type MemoryAccessLevel = 'exploration' | 'standard' | 'privileged' | 'admin'

// Classification rank for comparison (higher = more sensitive)
export const CLASSIFICATION_RANK: Record<MemoryClassification, number> = {
  public: 1,
  internal: 2,
  confidential: 3,
  restricted: 4,
}

// Access level to max classification mapping
export const ACCESS_LEVEL_MAX_CLASSIFICATION: Record<MemoryAccessLevel, MemoryClassification> = {
  exploration: 'internal',     // /bethesda, default — public + internal only
  standard: 'confidential',    // /consultant, /lore — + confidential with namespace
  privileged: 'restricted',    // /call — can see restricted (raw transcripts)
  admin: 'restricted',         // /cos — full cross-namespace visibility
}

// TD-883: does a row's classification exceed the ceiling for a caller?
// Shared, dependency-free predicate for the direct getById path (both
// providers import from this module already, so no import cycle with the
// retrieval-layer choke point). Mirrors applyClassificationCeiling's rules:
//   - no accessLevel + no maxClassification → no ceiling → never exceeds
//   - maxClassification overrides accessLevel
//   - missing/undefined classification → treated as 'public' (never exceeds)
//   - unknown classification string → fail closed (exceeds)
export function exceedsClassificationCeiling(
  classification: MemoryClassification | undefined,
  accessLevel?: MemoryAccessLevel,
  maxClassification?: MemoryClassification,
): boolean {
  const ceiling: MemoryClassification | undefined =
    maxClassification ??
    (accessLevel ? ACCESS_LEVEL_MAX_CLASSIFICATION[accessLevel] : undefined)
  if (!ceiling) return false
  const rank = CLASSIFICATION_RANK[(classification ?? 'public') as MemoryClassification]
  if (rank === undefined) return true // unknown classification → fail closed
  return rank > CLASSIFICATION_RANK[ceiling]
}

// The set-shaped twin of exceedsClassificationCeiling, for callers that must push
// the ceiling DOWN into the query instead of filtering rows after the fact.
//
// A row-by-row filter is fine when you already hold the rows; it is wrong for an
// aggregate, where the count has to exclude over-tier rows the caller never sees.
// Returns undefined for "no ceiling" (count everything) so the caller can skip the
// predicate entirely. Fails closed the same way its twin does: an unknown
// classification string is absent from this list, so it is never counted.
export function allowedClassifications(
  accessLevel?: MemoryAccessLevel,
  maxClassification?: MemoryClassification,
): MemoryClassification[] | undefined {
  const ceiling: MemoryClassification | undefined =
    maxClassification ??
    (accessLevel ? ACCESS_LEVEL_MAX_CLASSIFICATION[accessLevel] : undefined)
  if (!ceiling) return undefined
  const max = CLASSIFICATION_RANK[ceiling]
  return (Object.keys(CLASSIFICATION_RANK) as MemoryClassification[])
    .filter((c) => CLASSIFICATION_RANK[c] <= max)
}

// Retention policies for data lifecycle (Glasswing TD-716)
export type MemoryRetentionPolicy = 'permanent' | 'client_engagement' | 'session' | 'manual'

// Memory types for type-aware lifecycle (v2)
export type MemoryType = 'fact' | 'preference' | 'pattern'

// Input for creating a new memory
export interface MemoryInput {
  content: string
  summary?: string
  category?: MemoryCategory
  tags?: string[]
  contextTags?: string[]
  sourceType: MemorySourceType
  sourceRef?: string
  sourceProject?: string
  confidence?: number  // 0-1, defaults to 1.0
  relatedTo?: string[]
  isContradiction?: boolean
  durability?: MemoryDurability  // defaults to 'permanent'
  expiresAt?: Date  // optional explicit expiration for temporary memories
  // Classification fields (v4 schema)
  domain?: string // who/what: sean, traqr, tooling, universal, app names
  topic?: string // subject: supabase, git, vercel, architecture, etc.
  // Cross-project fields
  isUniversal?: boolean // Mark as universal pattern
  agentType?: string // Agent creating this memory
  // v2: Memory lifecycle
  memoryType?: MemoryType
  validAt?: Date
  forgetAfter?: Date
  sourceTool?: string
  // Source reliability — how trustworthy is the origin of this memory?
  // direct-user > deliberate-store > granola-single > granola-multi > inferred > auto-derived
  sourceReliability?: 'direct-user' | 'deliberate-store' | 'granola-single' | 'granola-multi' | 'inferred' | 'auto-derived'
  // Pre-computed embedding (skip re-generation in store)
  precomputedEmbedding?: string
  // Security classification (Glasswing Red Alert)
  classification?: MemoryClassification
  clientNamespace?: string
  containsPii?: boolean
  // Retention policy (Glasswing TD-716)
  retentionPolicy?: MemoryRetentionPolicy
  retentionExpiresAt?: Date
}

// Full memory record from the database
export interface Memory {
  id: string
  content: string
  summary?: string
  category?: MemoryCategory
  tags: string[]
  contextTags: string[]
  sourceType: MemorySourceType
  sourceRef?: string
  sourceProject: string
  originalConfidence: number
  lastValidated: Date
  relatedTo: string[]
  isContradiction: boolean
  isArchived: boolean
  archiveReason?: string
  archivedAt?: Date
  durability: MemoryDurability
  expiresAt?: Date
  embeddingModel: string
  embeddingModelVersion: string
  createdAt: Date
  updatedAt: Date
  // Classification fields (v4 schema)
  domain?: string
  topic?: string
  // Cross-project fields
  isUniversal?: boolean
  agentType?: string
  // Citation tracking
  timesReturned: number
  timesCited: number
  lastReturnedAt?: Date
  lastCitedAt?: Date
  // v2: Memory lifecycle
  memoryType?: MemoryType
  validAt?: Date
  invalidAt?: Date
  isLatest?: boolean
  isForgotten?: boolean
  forgottenAt?: Date
  forgetAfter?: Date
  sourceTool?: string
  // v3: Security classification (Glasswing Red Alert)
  classification?: MemoryClassification
  clientNamespace?: string
  containsPii?: boolean
  // v4: Retention policies (Glasswing TD-716)
  retentionPolicy?: MemoryRetentionPolicy
  retentionExpiresAt?: Date
}

// Memory with computed fields from search
export interface MemorySearchResult extends Memory {
  currentConfidence: number  // Decay-adjusted confidence
  similarity: number         // Cosine similarity to query
  relevanceScore: number     // similarity * currentConfidence * citationBoost
}

// Search options
export interface SearchOptions {
  domainId?: string
  category?: MemoryCategory
  tags?: string[]
  includeArchived?: boolean
  limit?: number
  similarityThreshold?: number
  durability?: MemoryDurability
  excludeExpired?: boolean
  // Cross-project options
  sourceProject?: string
  includeUniversal?: boolean
  agentType?: string
  // v2: Lifecycle filters
  latestOnly?: boolean
  memoryType?: MemoryType
  // v3: Security filters (Glasswing Red Alert)
  maxClassification?: MemoryClassification
  clientNamespace?: string
  accessLevel?: MemoryAccessLevel
}

// Update options
export interface MemoryUpdate {
  content?: string
  summary?: string
  category?: MemoryCategory
  tags?: string[]
  contextTags?: string[]
  confidence?: number
  relatedTo?: string[]
  isContradiction?: boolean
  changeReason?: string
  durability?: MemoryDurability
  expiresAt?: Date
}

// Export format (for portability)
export interface MemoryExport {
  id: string
  content: string
  summary?: string
  category?: MemoryCategory
  tags: string[]
  contextTags: string[]
  sourceType: MemorySourceType
  sourceRef?: string
  sourceProject: string
  originalConfidence: number
  lastValidated: string  // ISO date string
  relatedTo: string[]
  isContradiction: boolean
  isArchived: boolean
  archiveReason?: string
  durability?: MemoryDurability
  expiresAt?: string
  embeddingModel: string
  embeddingModelVersion: string
  createdAt: string
  updatedAt: string
  domainName?: string
  userEmail?: string
  // Citation tracking
  timesReturned?: number
  timesCited?: number
  lastReturnedAt?: string
  lastCitedAt?: string
}

// TD-1018: the exact column set `exportAll`'s row mapper reads. Named here so
// both drivers project it instead of `SELECT *`. The point is what it OMITS —
// `embedding` is a 1536-dim vector (~6 KB/row) that no mapper field consumes,
// so `SELECT *` was moving ~74 MB of vectors per call to be discarded.
export const MEMORY_EXPORT_COLUMNS = [
  'id', 'content', 'summary', 'category', 'tags', 'context_tags',
  'source_type', 'source_ref', 'source_project', 'original_confidence',
  'last_validated', 'related_to', 'is_contradiction', 'is_archived',
  'archive_reason', 'durability', 'expires_at', 'embedding_model',
  'embedding_model_version', 'created_at', 'updated_at',
].join(', ')

// TD-1018: the six fields the stats aggregators actually read. `getMemoryStats`
// and `getDetailedStats` used to call `exportAll()` — a full table download —
// to compute counts. Measured before the fix: 74 calls, 28 s mean, 392,679
// disk blocks read.
export interface MemoryStatsRow {
  id: string
  category?: string
  sourceType?: string
  tags: string[]
  isArchived: boolean
  createdAt: string
}

export const MEMORY_STATS_COLUMNS = 'id, category, source_type, tags, is_archived, created_at'

// Domain for isolating memories by project
export interface MemoryDomain {
  id: string
  userId: string
  name: string
  description?: string
  isShareable: boolean
  createdAt: Date
  updatedAt: Date
}


// Browse result for faceted navigation
export interface BrowseResult {
  id: string
  domain?: string
  category?: string
  content: string
  summary?: string
}

// Provider interface - all implementations must conform to this
export interface VectorDBProvider {
  // Core operations
  store(memory: MemoryInput, domainId?: string): Promise<Memory>
  search(query: string, options?: SearchOptions & { precomputedEmbedding?: string }): Promise<MemorySearchResult[]>
  // TD-883: optional classification ceiling. When opts carries accessLevel or
  // maxClassification and the fetched row exceeds that ceiling, return null
  // (treated as not-found for that tier). No opts → unchanged behavior.
  getById(id: string, opts?: { accessLevel?: MemoryAccessLevel; maxClassification?: MemoryClassification }): Promise<Memory | null>
  update(id: string, updates: MemoryUpdate): Promise<Memory>
  delete(id: string): Promise<void>
  validate(id: string): Promise<Memory>

  // Archive operations
  archive(id: string, reason?: string): Promise<Memory>
  unarchive(id: string): Promise<Memory>

  // Bulk operations
  exportAll(domainId?: string): Promise<MemoryExport[]>
  importBulk(memories: MemoryExport[], domainId: string): Promise<number>
  // TD-1018: narrow projection for the stats aggregators, so counting rows
  // does not download every row's embedding.
  statsRows(): Promise<MemoryStatsRow[]>

  // Domain management
  createDomain(name: string, description?: string, userId?: string): Promise<MemoryDomain>
  getDomain(name: string): Promise<MemoryDomain | null>
  getDefaultDomain(): Promise<MemoryDomain>

  // Health
  ping(): Promise<boolean>

  // v2: Lifecycle
  invalidate(id: string): Promise<void>
  supersede(id: string): Promise<void>

  // Feedback signals (TD-817): the write path for times_returned/times_cited.
  // These live on the provider because the prior implementation went through
  // the Supabase client directly — which throws (silently, behind a catch) on
  // every DATABASE_URL-configured runtime. That mismatch froze the counters
  // fleet-wide on 2026-05-20.
  bumpReturned(ids: string[]): Promise<void>
  citeMemory(id: string): Promise<void>

  // Entity operations
  findEntityByName(name: string, entityType: string): Promise<any | null>
  findEntityByNameFuzzy(name: string, entityType: string): Promise<any | null>
  findEntityByEmbedding(embeddingStr: string, entityType: string, threshold?: number): Promise<any | null>
  createEntity(entity: { name: string, entityType: string, embedding?: string, userId?: string }): Promise<any>
  incrementEntityMentions(entityId: string): Promise<void>
  linkMemoryToEntity(memoryId: string, entityId: string, role?: string): Promise<void>
  findOrphanedEntities(): Promise<string[]>
  archiveEntities(ids: string[]): Promise<number>

  // Utility operations (abstracted from direct client calls)
  browse(options?: { domain?: string, category?: string, limit?: number, accessLevel?: MemoryAccessLevel, maxClassification?: MemoryClassification }): Promise<BrowseResult[]>
  // Domain counts over the WHOLE corpus, not over a page of it. Separate from
  // browse() on purpose: browse() is paged by contract, and counting its page
  // is what made memory_browse report 6 jiggy memories against 5,868 real ones.
  browseDomainCounts(options?: { accessLevel?: MemoryAccessLevel, maxClassification?: MemoryClassification }): Promise<Record<string, number>>
  forget(id: string): Promise<void>
  createRelationship(sourceId: string, targetId: string, edgeType: string, metadata?: Record<string, unknown>): Promise<string | null>
  countEntityMentions(name: string, userId: string): Promise<number>
  schemaVersion(): Promise<number | null>
}

// Provider configuration
export interface ProviderConfig {
  type: 'supabase' | 'postgres'
  supabaseUrl?: string
  supabaseKey?: string
  databaseUrl?: string
}

// Bootstrap confidence levels
export const BOOTSTRAP_CONFIDENCE = {
  WHATS_WORKED: 0.9,
  WHATS_HASNT_WORKED: 0.8,
  KEY_GOTCHAS: 0.9,
  PATTERNS_DISCOVERED: 0.85,
  OPEN_QUESTIONS: 0.5,
  MANUAL: 1.0,
  PR: 0.9,
} as const

// Decay constants — citation-aware rates (accelerated for uncited/noise)
export const DECAY_CONFIG = {
  RATE_UNCITED_RETURNED: 0.7,  // noise: returned but never cited
  RATE_UNCITED: 0.5,           // default uncited: ~3 months to archive
  RATE_CITED_LOW: 0.1,         // cited 1-3x: moderate
  RATE_CITED_HIGH: 0.05,       // cited >3x: proven valuable
  ARCHIVE_THRESHOLD: 0.3,
  FLOOR: 0.1,
  STALE_UNCITED_DAYS: 90,      // auto-archive uncited after this many days
} as const
