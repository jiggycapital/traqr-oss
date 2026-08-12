/**
 * PR Learning Extraction Route (Portable)
 *
 * POST /extract-pr-learnings — Extracts learnings from a single PR.
 * Called by Guardian post-merge lifecycle.
 *
 * Portable: GitHub API calls are self-contained (no NookTraqr imports).
 * Idempotency checking is optional — caller can pass `skipIfCaptured` metadata.
 */

import { Hono } from 'hono'
import { requireAuth } from '../lib/auth.js'
import { extractLearningsFromPR, getSourceProject } from '../lib/learning-extractor.js'

const app = new Hono()

app.post('/', requireAuth, async (c) => {
  try {
    const body = await c.req.json()
    const {
      prNumber,
      title,
      branch,
      project,
      description,
      filesChanged,
      githubRepo,
      githubToken,
      skipIfCaptured,
      previousCaptureCount,
      previousCaptureAt,
    } = body as {
      prNumber?: number
      title?: string
      branch?: string
      project?: string
      description?: string
      filesChanged?: string[]
      githubRepo?: string
      githubToken?: string
      skipIfCaptured?: boolean
      previousCaptureCount?: number
      previousCaptureAt?: string
    }

    // Allow caller to set source project
    if (project) {
      process.env.TRAQR_SOURCE_PROJECT = project
    }

    if (!prNumber || typeof prNumber !== 'number') {
      return c.json({ error: 'prNumber is required and must be a number' }, 400)
    }

    // If caller tells us this was already captured, skip
    if (skipIfCaptured) {
      console.log(`[extract-pr-learnings] PR #${prNumber} already captured (${previousCaptureCount} learnings at ${previousCaptureAt})`)
      return c.json({
        success: true,
        skipped: true,
        reason: 'already_captured',
        memoriesStored: 0,
        memoriesDeduplicated: 0,
        previousCount: previousCaptureCount,
        capturedAt: previousCaptureAt,
      })
    }

    console.log(`[extract-pr-learnings] Processing PR #${prNumber}`)

    // Use provided data or fetch from GitHub
    let prTitle = title
    let prDescription = description
    let prFiles = filesChanged || []

    const resolvedGithubToken = githubToken || process.env.GITHUB_TOKEN
    const resolvedGithubRepo = githubRepo || process.env.TRAQR_GITHUB_REPO

    if (!prTitle && resolvedGithubToken && resolvedGithubRepo) {
      const prData = await fetchPRDetails(prNumber, resolvedGithubRepo, resolvedGithubToken)
      if (prData) {
        prTitle = prData.title
        prDescription = prData.body || undefined
      }
    }
    prTitle = prTitle || `PR #${prNumber}`

    if (prFiles.length === 0 && resolvedGithubToken && resolvedGithubRepo) {
      prFiles = await fetchPRFiles(prNumber, resolvedGithubRepo, resolvedGithubToken)
    }

    if (prFiles.length === 0) {
      console.log(`[extract-pr-learnings] PR #${prNumber} has no files`)
      return c.json({
        success: true,
        skipped: true,
        reason: 'no_files',
        memoriesStored: 0,
        memoriesDeduplicated: 0,
      })
    }

    const result = await extractLearningsFromPR({
      prNumber,
      title: prTitle,
      description: prDescription,
      filesChanged: prFiles,
    })

    console.log(`[extract-pr-learnings] PR #${prNumber}: ${result.memoriesStored} new, ${result.memoriesDeduplicated} deduped`)

    return c.json({
      success: true,
      skipped: false,
      memoriesStored: result.memoriesStored,
      memoriesDeduplicated: result.memoriesDeduplicated,
      errors: result.errors.length > 0 ? result.errors : undefined,
    })
  } catch (error) {
    console.error('[extract-pr-learnings] Error:', error)
    return c.json(
      { error: 'Failed to extract learnings', details: error instanceof Error ? error.message : 'Unknown' },
      500
    )
  }
})

async function fetchPRDetails(
  prNumber: number,
  repo: string,
  token: string
): Promise<{ title: string; body: string | null } | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/pulls/${prNumber}`,
      {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    )

    if (!response.ok) {
      console.error(`[extract-pr-learnings] GitHub API error fetching PR #${prNumber}: ${response.status}`)
      return null
    }

    const data = await response.json()
    return { title: data.title, body: data.body }
  } catch (error) {
    console.error(`[extract-pr-learnings] Failed to fetch PR #${prNumber}:`, error)
    return null
  }
}

async function fetchPRFiles(
  prNumber: number,
  repo: string,
  token: string
): Promise<string[]> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/pulls/${prNumber}/files`,
      {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    )

    if (!response.ok) {
      console.error(`[extract-pr-learnings] GitHub API error fetching files for PR #${prNumber}: ${response.status}`)
      return []
    }

    const files = await response.json()
    return Array.isArray(files) ? files.map((f: { filename: string }) => f.filename) : []
  } catch (error) {
    console.error(`[extract-pr-learnings] Failed to fetch files for PR #${prNumber}:`, error)
    return []
  }
}

export default app
