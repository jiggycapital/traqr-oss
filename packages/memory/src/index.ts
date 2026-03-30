/**
 * @traqr/memory — Public API
 *
 * Vector DB client, memory operations, and standalone HTTP server
 * for the Traqr memory system.
 */

// Server
export { createMemoryServer } from './server.js'

// VectorDB layer
export { getVectorDB, resetVectorDB } from './vectordb/index.js'
export type {
  VectorDBProvider,
  Memory,
  MemoryInput,
  MemorySearchResult,
  MemoryUpdate,
  MemoryExport,
  MemoryDomain,
  SearchOptions,
  MemoryCategory,
  MemorySourceType,
  MemoryDurability,
  MemoryType,
  BM25SearchResult,
  TemporalSearchResult,
  GraphSearchResult,
  BrowseResult,
  ProviderConfig,
} from './vectordb/types.js'
export { BOOTSTRAP_CONFIDENCE, DECAY_CONFIG } from './vectordb/types.js'

// Auto-derive v2
export {
  deriveAll,
  deriveDomain,
  deriveCategory,
  deriveTopic,
  deriveSummary,
  deriveTags,
  deriveMemoryType,
  deriveForgetAfter,
  extractEntityCandidates,
} from './lib/auto-derive.js'
export type { DeriveResult, EntityCandidate } from './lib/auto-derive.js'

// LLM borderline decision
export { borderlineDecision } from './lib/borderline.js'
export type { BorderlineDecision, BorderlineAction, MaskedMemory } from './lib/borderline.js'

// Cohere rerank
export { cohereRerank } from './lib/rerank.js'
export type { RerankResult, RerankDocument } from './lib/rerank.js'

// High-level memory operations
export {
  storeMemory,
  searchMemories,
  getMemory,
  updateMemory,
  deleteMemory,
  validateMemory,
  archiveMemory,
  unarchiveMemory,
  exportAllMemories,
  importMemories,
  storeWithDedup,
  triageAndStore,
  createRelationship,
  invalidateMemory,
  supersedeMemory,
  remember,
  recall,
  isMemoryHealthy,
  getMemoryStats,
  getDetailedStats,
  getSystemHealth,
  verifyRoundTrip,
  formatMemory,
  formatSearchResults,
} from './lib/memory.js'

// Lifecycle utilities
export {
  getVersionChain,
  getMemoryHistory,
  getMemoryRelationships,
} from './lib/lifecycle.js'
export type { MemoryHistoryResult, MemoryRelationship } from './lib/lifecycle.js'

// Entity extraction pipeline
export { processEntitiesForMemory } from './lib/entity-pipeline.js'
export type { EntityExtractionResult } from './lib/entity-pipeline.js'

export type {
  StoreWithDedupResult,
  TriageResult,
  TriageZone,
  TriageAction,
  TriageOptions,
  RoundTripResult,
  DetailedStats,
  SystemHealth,
} from './lib/memory.js'

// Multi-strategy retrieval (v2)
export {
  searchMemoriesV2,
  reciprocalRankFusion,
  detectStrategies,
  parseTemporalRange,
  findEntitiesInQuery,
} from './lib/retrieval.js'
export type {
  SearchV2Options,
  SearchStrategy,
  FusedItem,
  StrategyResult,
  DetectedStrategies,
} from './lib/retrieval.js'

// Embeddings
export {
  generateEmbedding,
  generateEmbeddingsBatch,
  cosineSimilarity,
  formatEmbeddingForPgVector,
  parseEmbeddingFromPgVector,
  needsReembedding,
  checkEmbeddingHealth,
  EMBEDDING_CONFIG,
  getEmbeddingProvider,
  getEmbeddingConfig,
  resetEmbeddingProvider,
} from './lib/embeddings.js'
export type { EmbeddingResult, EmbeddingHealthStatus, EmbeddingProvider } from './lib/embeddings.js'

// Formatting
export {
  CATEGORY_EMOJI,
  CATEGORY_EMOJI_SLACK,
  CATEGORY_EMOJI_TEXT,
  SOURCE_TYPE_EMOJI,
  getCategoryEmoji,
} from './lib/formatting.js'

// Client configuration
export { getMemoryClient, resetMemoryClient, getUserId, getProjectId, configureMemory, getTableName, getMemoryConfig } from './lib/client.js'
export type { MemoryClientConfig } from './lib/client.js'

// Auth middleware
export { verifyAuth, requireAuth, getInternalSecret } from './lib/auth.js'

// Context assembly
export { assembleSessionContext } from './lib/context.js'
export type { SessionContextParams, SessionContext, MemoryWithShortCode } from './lib/context.js'

// Learning extractor
export {
  extractLearningsFromPR,
  batchExtractLearnings,
  submitManualLearning,
  extractFromConversation,
  extractFromSessionDiff,
  extractLearningsFromPlan,
  extractFromCodebaseAnalysis,
  extractVoiceTraits,
  detectContradictions,
  formatExtractionResult,
  getSourceProject,
} from './lib/learning-extractor.js'
export type {
  PRContext,
  ExtractedLearning,
  ExtractionResult,
  SuggestedLayer,
  SessionDiffContext,
  SessionExtractionResult,
  PlanContext,
  CodebaseAnalysisContext,
  CodebaseAnalysisResult,
  ContradictionResult,
  VoiceAnalysisType,
  VoiceAnalysisContext,
  VoiceAnalysisResult,
} from './lib/learning-extractor.js'
