/**
 * Embeddings Provider System
 *
 * Provider-agnostic embedding generation. Supports:
 * - OpenAI (text-embedding-3-small)
 * - Gemini (gemini-embedding-001)
 * - Amazon Bedrock (Nova Embeddings, Titan, etc.)
 * - Ollama (local models)
 * - None (BM25-only keyword search, no embeddings)
 *
 * Set EMBEDDING_PROVIDER env var: 'openai', 'gemini', 'bedrock', 'ollama', 'none'
 * If not set, auto-detects from available API keys.
 */

import OpenAI from 'openai'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

export interface EmbeddingProvider {
  generate(text: string): Promise<EmbeddingResult>
  generateBatch(texts: string[]): Promise<EmbeddingResult[]>
  readonly dimensions: number
  readonly model: string
  readonly provider: string
}

// ---------------------------------------------------------------------------
// OpenAI Provider
// ---------------------------------------------------------------------------

class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly provider = 'openai'
  readonly model = 'text-embedding-3-small'
  readonly dimensions = 1536
  private client: OpenAI | null = null

  private getClient(): OpenAI {
    if (this.client) return this.client
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY environment variable is not set. ' +
        'Get your API key from https://platform.openai.com/api-keys'
      )
    }
    this.client = new OpenAI({ apiKey, baseURL: process.env.OPENAI_BASE_URL })
    return this.client
  }

  async generate(text: string): Promise<EmbeddingResult> {
    const client = this.getClient()
    const truncated = text.slice(0, 8191 * 4)
    const response = await client.embeddings.create({
      model: this.model,
      input: truncated,
      encoding_format: 'float',
    })
    const data = response.data[0]
    return {
      embedding: data.embedding,
      model: `openai/${this.model}`,
      modelVersion: 'v1',
      dimensions: this.dimensions,
      usage: { promptTokens: response.usage.prompt_tokens, totalTokens: response.usage.total_tokens },
    }
  }

  async generateBatch(texts: string[]): Promise<EmbeddingResult[]> {
    if (texts.length === 0) return []
    const client = this.getClient()
    const truncated = texts.map(t => t.slice(0, 8191 * 4))
    const response = await client.embeddings.create({
      model: this.model,
      input: truncated,
      encoding_format: 'float',
    })
    return response.data.map(d => ({
      embedding: d.embedding,
      model: `openai/${this.model}`,
      modelVersion: 'v1',
      dimensions: this.dimensions,
      usage: {
        promptTokens: Math.floor(response.usage.prompt_tokens / texts.length),
        totalTokens: Math.floor(response.usage.total_tokens / texts.length),
      },
    }))
  }
}

// ---------------------------------------------------------------------------
// Gemini Provider
// ---------------------------------------------------------------------------

class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly provider = 'gemini'
  readonly model = 'gemini-embedding-001'
  readonly dimensions = 1536

  async generate(text: string): Promise<EmbeddingResult> {
    const apiKey = process.env.GOOGLE_API_KEY
    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY not set. Required when EMBEDDING_PROVIDER=gemini. Get one at https://aistudio.google.com')
    }
    const truncated = text.slice(0, 8191 * 4)
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${this.model}`,
          content: { parts: [{ text: truncated }] },
          outputDimensionality: this.dimensions,
        }),
      },
    )
    if (!response.ok) {
      throw new Error(`Gemini embedding failed: ${response.status} ${response.statusText}`)
    }
    const data = await response.json() as { embedding: { values: number[] } }
    return {
      embedding: data.embedding.values,
      model: `gemini/${this.model}`,
      modelVersion: 'v1',
      dimensions: data.embedding.values.length,
      usage: { promptTokens: 0, totalTokens: 0 },
    }
  }

  async generateBatch(texts: string[]): Promise<EmbeddingResult[]> {
    // Gemini doesn't have a native batch API — sequential for now
    return Promise.all(texts.map(t => this.generate(t)))
  }
}

// ---------------------------------------------------------------------------
// Bedrock Provider (Amazon Nova Embeddings, Titan, etc.)
// ---------------------------------------------------------------------------

class BedrockEmbeddingProvider implements EmbeddingProvider {
  readonly provider = 'bedrock'
  readonly model: string
  readonly dimensions: number
  private _sdk: { client: any; InvokeModelCommand: any } | null = null

  constructor() {
    this.model = process.env.EMBEDDING_MODEL || 'amazon.nova-embed-v1:0'
    this.dimensions = parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10)
  }

  private async getSdk() {
    if (this._sdk) return this._sdk
    try {
      // Dynamic import — @aws-sdk is optional, only loaded when EMBEDDING_PROVIDER=bedrock
      const mod = await (Function('return import("@aws-sdk/client-bedrock-runtime")')() as Promise<any>)
      this._sdk = {
        client: new mod.BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' }),
        InvokeModelCommand: mod.InvokeModelCommand,
      }
      return this._sdk
    } catch {
      throw new Error(
        'Amazon Bedrock requires @aws-sdk/client-bedrock-runtime. ' +
        'Install it: npm install @aws-sdk/client-bedrock-runtime\n' +
        'Then set AWS_REGION and configure AWS credentials (IAM role, env vars, or ~/.aws/credentials).'
      )
    }
  }

  async generate(text: string): Promise<EmbeddingResult> {
    const { client, InvokeModelCommand } = await this.getSdk()
    const truncated = text.slice(0, 8191 * 4)

    const command = new InvokeModelCommand({
      modelId: this.model,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        inputText: truncated,
        dimensions: this.dimensions,
      }),
    })

    const response = await client.send(command)
    const body = JSON.parse(new TextDecoder().decode(response.body))
    const embedding = body.embedding || body.embeddings?.[0]

    if (!embedding) {
      throw new Error(`Bedrock model ${this.model} returned no embedding. Response keys: ${Object.keys(body).join(', ')}`)
    }

    return {
      embedding,
      model: `bedrock/${this.model}`,
      modelVersion: 'v1',
      dimensions: embedding.length,
      usage: { promptTokens: body.inputTextTokenCount || 0, totalTokens: body.inputTextTokenCount || 0 },
    }
  }

  async generateBatch(texts: string[]): Promise<EmbeddingResult[]> {
    // Bedrock doesn't have a native batch embedding API — sequential
    return Promise.all(texts.map(t => this.generate(t)))
  }
}

// ---------------------------------------------------------------------------
// Ollama Provider (local models)
// ---------------------------------------------------------------------------

class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly provider = 'ollama'
  readonly model: string
  readonly dimensions: number
  private readonly baseUrl: string

  constructor() {
    this.model = process.env.EMBEDDING_MODEL || 'nomic-embed-text'
    this.dimensions = parseInt(process.env.EMBEDDING_DIMENSIONS || '768', 10)
    this.baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
  }

  async generate(text: string): Promise<EmbeddingResult> {
    const truncated = text.slice(0, 8191 * 4)
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: truncated }),
    })

    if (!response.ok) {
      throw new Error(
        `Ollama embedding failed: ${response.status} ${response.statusText}. ` +
        `Is Ollama running at ${this.baseUrl}? Has model '${this.model}' been pulled?`
      )
    }

    const data = await response.json() as { embeddings: number[][] }
    const embedding = data.embeddings[0]

    return {
      embedding,
      model: `ollama/${this.model}`,
      modelVersion: 'v1',
      dimensions: embedding.length,
      usage: { promptTokens: 0, totalTokens: 0 },
    }
  }

  async generateBatch(texts: string[]): Promise<EmbeddingResult[]> {
    // Ollama supports batch via array input
    const truncated = texts.map(t => t.slice(0, 8191 * 4))
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: truncated }),
    })

    if (!response.ok) {
      throw new Error(`Ollama batch embedding failed: ${response.status}`)
    }

    const data = await response.json() as { embeddings: number[][] }
    return data.embeddings.map(emb => ({
      embedding: emb,
      model: `ollama/${this.model}`,
      modelVersion: 'v1',
      dimensions: emb.length,
      usage: { promptTokens: 0, totalTokens: 0 },
    }))
  }
}

// ---------------------------------------------------------------------------
// Null Provider (BM25-only, no embeddings)
// ---------------------------------------------------------------------------

class NullEmbeddingProvider implements EmbeddingProvider {
  readonly provider = 'none'
  readonly model = 'none'
  readonly dimensions = 0

  async generate(_text: string): Promise<EmbeddingResult> {
    return {
      embedding: [],
      model: 'none',
      modelVersion: 'v1',
      dimensions: 0,
      usage: { promptTokens: 0, totalTokens: 0 },
    }
  }

  async generateBatch(texts: string[]): Promise<EmbeddingResult[]> {
    return texts.map(() => ({
      embedding: [],
      model: 'none',
      modelVersion: 'v1',
      dimensions: 0,
      usage: { promptTokens: 0, totalTokens: 0 },
    }))
  }
}

// ---------------------------------------------------------------------------
// Factory + Singleton
// ---------------------------------------------------------------------------

let providerInstance: EmbeddingProvider | null = null

/**
 * Get the configured embedding provider.
 * Auto-detects from EMBEDDING_PROVIDER env var, or falls back to API key detection.
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  if (providerInstance) return providerInstance

  const type = process.env.EMBEDDING_PROVIDER

  switch (type) {
    case 'openai':
      providerInstance = new OpenAIEmbeddingProvider()
      break
    case 'gemini':
      providerInstance = new GeminiEmbeddingProvider()
      break
    case 'bedrock':
      providerInstance = new BedrockEmbeddingProvider()
      break
    case 'ollama':
      providerInstance = new OllamaEmbeddingProvider()
      break
    case 'none':
      providerInstance = new NullEmbeddingProvider()
      break
    default:
      // Auto-detect from available API keys (backward compat)
      if (process.env.OPENAI_API_KEY) {
        providerInstance = new OpenAIEmbeddingProvider()
      } else if (process.env.GOOGLE_API_KEY) {
        providerInstance = new GeminiEmbeddingProvider()
      } else {
        providerInstance = new NullEmbeddingProvider()
      }
  }

  return providerInstance
}

/** Reset singleton (for testing or reconfiguration) */
export function resetEmbeddingProvider(): void {
  providerInstance = null
}

// ---------------------------------------------------------------------------
// Backward-compatible API (existing callers use these)
// ---------------------------------------------------------------------------

/** Dynamic config based on active provider */
export function getEmbeddingConfig() {
  const p = getEmbeddingProvider()
  return {
    MODEL: p.model,
    MODEL_VERSION: 'v1',
    DIMENSIONS: p.dimensions,
    PROVIDER: p.provider,
    MAX_TOKENS: 8191,
  }
}

// Keep the old constant for backward compat (code that imports EMBEDDING_CONFIG directly)
export const EMBEDDING_CONFIG = {
  get MODEL() { return getEmbeddingConfig().MODEL },
  MODEL_VERSION: 'v1',
  get DIMENSIONS() { return getEmbeddingConfig().DIMENSIONS },
  get PROVIDER() { return getEmbeddingConfig().PROVIDER },
  MAX_TOKENS: 8191,
} as const

/**
 * Generate embedding for a single text (backward-compatible entry point)
 */
export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  return getEmbeddingProvider().generate(text)
}

/**
 * Generate embeddings for multiple texts in batch
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<EmbeddingResult[]> {
  return getEmbeddingProvider().generateBatch(texts)
}

// ---------------------------------------------------------------------------
// Utility functions (provider-agnostic)
// ---------------------------------------------------------------------------

/**
 * Calculate cosine similarity between two embeddings
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimensions don't match: ${a.length} vs ${b.length}`)
  }
  let dotProduct = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB)
  return magnitude === 0 ? 0 : dotProduct / magnitude
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
export function needsReembedding(currentModel: string, currentVersion: string): boolean {
  const config = getEmbeddingConfig()
  const expectedModel = `${config.PROVIDER}/${config.MODEL}`
  return currentModel !== expectedModel || currentVersion !== config.MODEL_VERSION
}

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------

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
  const provider = getEmbeddingProvider()
  if (provider.provider === 'none') {
    return { status: 'degraded', canStore: true, canSearch: false, reason: 'No embedding provider configured. BM25 keyword search only.' }
  }

  const startTime = Date.now()
  try {
    const result = await provider.generate('health check')
    const latencyMs = Date.now() - startTime
    if (!result.embedding?.length) {
      return { status: 'degraded', canStore: false, canSearch: false, reason: 'Provider returned empty embedding', latencyMs }
    }
    return { status: 'healthy', canStore: true, canSearch: true, latencyMs }
  } catch (error) {
    const latencyMs = Date.now() - startTime
    const msg = error instanceof Error ? error.message : 'Unknown error'
    const isQuota = msg.includes('quota') || msg.includes('rate limit') || msg.includes('exceeded')
    const isAuth = msg.includes('API key') || msg.includes('authentication') || msg.includes('unauthorized')
    if (isQuota) return { status: 'degraded', canStore: false, canSearch: false, reason: 'API quota exceeded', quotaExceeded: true, latencyMs }
    if (isAuth) return { status: 'failed', canStore: false, canSearch: false, reason: 'API key invalid or missing', latencyMs }
    return { status: 'failed', canStore: false, canSearch: false, reason: msg, latencyMs }
  }
}
