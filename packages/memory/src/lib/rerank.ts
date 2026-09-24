/**
 * Cohere Rerank Integration
 *
 * Optional final retrieval stage. Takes RRF-fused candidates + query,
 * returns reranked results with 0-1 relevance scores.
 * Graceful degradation: returns null if COHERE_API_KEY not set or on any error.
 */

import { embeddingFetch } from './embeddings.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RerankResult {
  id: string
  relevanceScore: number // 0-1 from Cohere
  index: number          // original position in input
}

export interface RerankDocument {
  id: string
  content: string
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let missingKeyLogged = false

// ---------------------------------------------------------------------------
// Cohere Rerank
// ---------------------------------------------------------------------------

/**
 * Rerank documents using Cohere Rerank v3.5.
 * Returns null if COHERE_API_KEY is not set or on any error.
 * Caller should fall back to existing RRF scores.
 */
export async function cohereRerank(
  query: string,
  documents: RerankDocument[],
  topN: number = 20,
): Promise<RerankResult[] | null> {
  const apiKey = process.env.COHERE_API_KEY
  if (!apiKey) {
    if (!missingKeyLogged) {
      console.error('[rerank] COHERE_API_KEY not set — skipping rerank, using RRF scores')
      missingKeyLogged = true
    }
    return null
  }

  if (documents.length === 0) return null

  try {
    // TD-1218 — bare `fetch` has no response deadline. Unlike the embed leg,
    // a timeout here is genuinely safe to swallow: the catch below falls back
    // to the RRF scores the caller already has, so the search still returns
    // real results rather than an empty set. What it must NOT do is hang,
    // because this stage sits on the same hot path as the 1815s incident.
    const response = await embeddingFetch()('https://api.cohere.com/v2/rerank', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'rerank-v3.5',
        query,
        documents: documents.map((d) => d.content),
        top_n: Math.min(topN, documents.length),
      }),
    })

    if (!response.ok) {
      console.warn(`[rerank] Cohere API error: ${response.status} ${response.statusText}`)
      return null
    }

    const data = await response.json() as {
      results: { index: number; relevance_score: number }[]
    }

    return (data.results || []).map((r) => ({
      id: documents[r.index].id,
      relevanceScore: r.relevance_score,
      index: r.index,
    }))
  } catch (err) {
    console.warn('[rerank] Cohere rerank failed:', err instanceof Error ? err.message : err)
    return null
  }
}
