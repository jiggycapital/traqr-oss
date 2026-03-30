/**
 * VectorDB Provider Types
 *
 * Provider-agnostic types for the memory system.
 * These types are designed to be portable across different vector databases
 * (Supabase pgvector, Pinecone, Qdrant, etc.)
 */

// Memory categories for organizing learnings
export type MemoryCategory =
  | 'gotcha'      // Common pitfalls and mistakes to avoid
  | 'pattern'     // Reusable patterns that work well
  | 'fix'         // Bug fixes and solutions
  | 'insight'     // General insights and learnings
  | 'question'    // Open questions still being explored
  | 'preference'  // Coding style, design choices, how the developer likes things done
  | 'convention'  // Project rules, naming patterns, file structure conventions

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
  // Pre-computed embedding (skip re-generation in store)
  precomputedEmbedding?: string
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
}

// Memory with computed fields from search
export interface MemorySearchResult extends Memory {
  currentConfidence: number  // Decay-adjusted confidence
  similarity: number         // Cosine similarity to query
  relevanceScore: number     // similarity * currentConfidence * citationBoost
}

// v2 search result types for multi-strategy retrieval
export interface BM25SearchResult {
  id: string
  content: string
  summary?: string
  bm25Score: number
  domain?: string
  category?: string
  memoryType?: string
}

export interface TemporalSearchResult {
  id: string
  content: string
  summary?: string
  similarity: number
  temporalProximity: number
  validAt: Date
}

export interface GraphSearchResult {
  id: string
  content: string
  summary?: string
  graphScore: number
  edgeType: string
  depth: number
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

// User for cross-project identity (future)
export interface MemoryUser {
  id: string
  apiKey: string
  email?: string
  createdAt: Date
  updatedAt: Date
}

// Provider interface - all implementations must conform to this
export interface VectorDBProvider {
  // Core operations
  store(memory: MemoryInput, domainId?: string): Promise<Memory>
  search(query: string, options?: SearchOptions): Promise<MemorySearchResult[]>
  getById(id: string): Promise<Memory | null>
  update(id: string, updates: MemoryUpdate): Promise<Memory>
  delete(id: string): Promise<void>
  validate(id: string): Promise<Memory>

  // Archive operations
  archive(id: string, reason?: string): Promise<Memory>
  unarchive(id: string): Promise<Memory>

  // Bulk operations
  exportAll(domainId?: string): Promise<MemoryExport[]>
  importBulk(memories: MemoryExport[], domainId: string): Promise<number>

  // Domain management
  createDomain(name: string, description?: string, userId?: string): Promise<MemoryDomain>
  getDomain(name: string): Promise<MemoryDomain | null>
  getDefaultDomain(): Promise<MemoryDomain>

  // Health
  ping(): Promise<boolean>
}

// Provider configuration
export interface ProviderConfig {
  type: 'supabase' | 'pinecone' | 'qdrant'
  supabaseUrl?: string
  supabaseKey?: string
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
