/**
 * Embeddings Utility
 *
 * Generates vector embeddings using configurable provider.
 * Supports OpenAI text-embedding-3-small and Google Gemini Embedding 2.
 * Set EMBEDDING_PROVIDER env var: 'openai' (default) or 'gemini'.
 */

import OpenAI from 'openai'

// Embedding provider detection
const EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER || 'openai'

// Embedding model configuration
export const EMBEDDING_CONFIG = {
  MODEL: EMBEDDING_PROVIDER === 'gemini' ? 'gemini-embedding-001' : 'text-embedding-3-small',
  MODEL_VERSION: 'v1',
  DIMENSIONS: 1536,
  PROVIDER: EMBEDDING_PROVIDER,
  MAX_TOKENS: 8191,
} as const

export interface EmbeddingResult {
  embedding: number[]
  model: string
  modelVersion: string
  dimensions: number
  usage: {
    promptTokens: number
    totalTokens: number
  }
}

// Singleton OpenAI client
let openaiClient: OpenAI | null = null

function getOpenAIClient(): OpenAI {
  if (openaiClient) return openaiClient

  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY environment variable is not set. ' +
      'Get your API key from https://platform.openai.com/api-keys'
    )
  }

  openaiClient = new OpenAI({ apiKey })
  return openaiClient
}

/**
 * Generate embedding for a single text (provider-agnostic)
 */
export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  if (EMBEDDING_PROVIDER === 'gemini') {
    return generateGeminiEmbedding(text)
  }
  return generateOpenAIEmbedding(text)
}

async function generateOpenAIEmbedding(text: string): Promise<EmbeddingResult> {
  const client = getOpenAIClient()

  const maxChars = EMBEDDING_CONFIG.MAX_TOKENS * 4
  const truncatedText = text.slice(0, maxChars)

  const response = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: truncatedText,
    encoding_format: 'float',
  })

  const embeddingData = response.data[0]

  return {
    embedding: embeddingData.embedding,
    model: 'openai/text-embedding-3-small',
    modelVersion: 'v1',
    dimensions: EMBEDDING_CONFIG.DIMENSIONS,
    usage: {
      promptTokens: response.usage.prompt_tokens,
      totalTokens: response.usage.total_tokens,
    },
  }
}

async function generateGeminiEmbedding(text: string): Promise<EmbeddingResult> {
  const apiKey = process.env.GOOGLE_API_KEY
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY not set. Required when EMBEDDING_PROVIDER=gemini.')
  }

  const maxChars = EMBEDDING_CONFIG.MAX_TOKENS * 4
  const truncatedText = text.slice(0, maxChars)

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text: truncatedText }] },
        outputDimensionality: EMBEDDING_CONFIG.DIMENSIONS,
      }),
    },
  )

  if (!response.ok) {
    throw new Error(`Gemini embedding failed: ${response.status} ${response.statusText}`)
  }

  const data = await response.json() as { embedding: { values: number[] } }

  return {
    embedding: data.embedding.values,
    model: 'gemini/gemini-embedding-001',
    modelVersion: 'v1',
    dimensions: data.embedding.values.length,
    usage: { promptTokens: 0, totalTokens: 0 }, // Gemini doesn't report token usage
  }
}

/**
 * Generate embeddings for multiple texts in batch
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return []

  const client = getOpenAIClient()

  const maxChars = EMBEDDING_CONFIG.MAX_TOKENS * 4
  const truncatedTexts = texts.map(t => t.slice(0, maxChars))

  const response = await client.embeddings.create({
    model: EMBEDDING_CONFIG.MODEL,
    input: truncatedTexts,
    encoding_format: 'float',
  })

  return response.data.map((embeddingData) => ({
    embedding: embeddingData.embedding,
    model: `${EMBEDDING_CONFIG.PROVIDER}/${EMBEDDING_CONFIG.MODEL}`,
    modelVersion: EMBEDDING_CONFIG.MODEL_VERSION,
    dimensions: EMBEDDING_CONFIG.DIMENSIONS,
    usage: {
      promptTokens: Math.floor(response.usage.prompt_tokens / texts.length),
      totalTokens: Math.floor(response.usage.total_tokens / texts.length),
    },
  }))
}

/**
 * Calculate cosine similarity between two embeddings
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimensions don't match: ${a.length} vs ${b.length}`)
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB)
  if (magnitude === 0) return 0

  return dotProduct / magnitude
}

/**
 * Format embedding for Supabase pgvector storage
 */
export function formatEmbeddingForPgVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}

/**
 * Parse pgvector format back to number array
 */
export function parseEmbeddingFromPgVector(pgvectorString: string): number[] {
  if (!pgvectorString) return []

  if (Array.isArray(pgvectorString)) {
    return (pgvectorString as unknown as string[]).map(Number)
  }

  const cleaned = pgvectorString.replace(/^\[|\]$/g, '')
  return cleaned.split(',').map(Number)
}

/**
 * Check if embeddings need regeneration
 */
export function needsReembedding(
  currentModel: string,
  currentVersion: string
): boolean {
  const expectedModel = `${EMBEDDING_CONFIG.PROVIDER}/${EMBEDDING_CONFIG.MODEL}`
  const expectedVersion = EMBEDDING_CONFIG.MODEL_VERSION

  return currentModel !== expectedModel || currentVersion !== expectedVersion
}

// Health Check

export interface EmbeddingHealthStatus {
  status: 'healthy' | 'degraded' | 'failed'
  canStore: boolean
  canSearch: boolean
  reason?: string
  latencyMs?: number
  quotaExceeded?: boolean
}

/**
 * Check embedding service health
 */
export async function checkEmbeddingHealth(): Promise<EmbeddingHealthStatus> {
  const startTime = Date.now()

  try {
    const client = getOpenAIClient()

    const response = await client.embeddings.create({
      model: EMBEDDING_CONFIG.MODEL,
      input: 'health check',
      encoding_format: 'float',
    })

    const latencyMs = Date.now() - startTime

    if (!response.data?.[0]?.embedding) {
      return {
        status: 'degraded',
        canStore: false,
        canSearch: false,
        reason: 'OpenAI returned empty embedding',
        latencyMs,
      }
    }

    return {
      status: 'healthy',
      canStore: true,
      canSearch: true,
      latencyMs,
    }
  } catch (error) {
    const latencyMs = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    const isQuotaExceeded =
      errorMessage.includes('quota') ||
      errorMessage.includes('rate limit') ||
      errorMessage.includes('exceeded') ||
      errorMessage.includes('billing') ||
      errorMessage.includes('insufficient_quota')

    const isAuthError =
      errorMessage.includes('API key') ||
      errorMessage.includes('authentication') ||
      errorMessage.includes('unauthorized')

    if (isQuotaExceeded) {
      return {
        status: 'degraded',
        canStore: false,
        canSearch: false,
        reason: 'OpenAI quota exceeded - cannot generate embeddings',
        quotaExceeded: true,
        latencyMs,
      }
    }

    if (isAuthError) {
      return {
        status: 'failed',
        canStore: false,
        canSearch: false,
        reason: 'OpenAI API key invalid or missing',
        latencyMs,
      }
    }

    return {
      status: 'failed',
      canStore: false,
      canSearch: false,
      reason: errorMessage,
      latencyMs,
    }
  }
}
