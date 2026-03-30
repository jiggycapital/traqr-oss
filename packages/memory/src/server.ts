/**
 * @traqr/memory — Standalone Hono HTTP Server
 *
 * Provides 11 memory API routes as a standalone server.
 * Drop-in replacement for NookTraqr's Next.js memory API routes.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... OPENAI_API_KEY=... \
 *     node --loader ts-node/esm packages/memory/src/server.ts
 *
 * Routes:
 *   GET  /search              — Semantic memory search
 *   POST /store               — Store a new memory
 *   GET  /get                 — Get memory by ID
 *   PATCH /update             — Update a memory
 *   GET  /verify              — System health check
 *   POST /verify              — Full round-trip verification
 *   GET  /export              — Export all memories
 *   POST /cite                — Record memory citations
 *   GET  /dashboard           — Memory stats dashboard
 *   GET  /sync                — Get recent learnings
 *   POST /sync                — Sync learnings
 *   GET  /bootstrap           — Bootstrap usage info
 *   POST /bootstrap           — Import markdown sections
 *   POST /capture-session     — Store captured session learnings
 *   POST /pulse               — Batched capture + search + update
 *   POST /assemble-context    — Session context assembly
 *   GET  /learnings           — Domain-organized learning query
 *   POST /extract-pr-learnings — On-demand PR learning extraction
 *   GET  /voice-profile       — Voice profile aggregation
 *   POST /analyze-voice       — Voice analysis extraction
 *   POST /analyze-codebase    — Codebase convention analysis
 *   POST /capture             — Passive knowledge capture
 *   GET  /capture             — List recent captures
 */

import { Hono } from 'hono'
import { serve } from '@hono/node-server'

import searchRoutes from './routes/search.js'
import storeRoutes from './routes/store.js'
import crudRoutes from './routes/crud.js'
import exportRoutes from './routes/export.js'
import citeRoutes from './routes/cite.js'
import dashboardRoutes from './routes/dashboard.js'
import syncRoutes from './routes/sync.js'
import bootstrapRoutes from './routes/bootstrap.js'
import captureSessionRoutes from './routes/capture.js'
import pulseRoutes from './routes/pulse.js'
import assembleContextRoutes from './routes/assemble-context.js'
import learningsRoutes from './routes/learnings.js'
import extractPrLearningsRoutes from './routes/extract-pr-learnings.js'
import voiceProfileRoutes from './routes/voice-profile.js'
import analyzeVoiceRoutes from './routes/analyze-voice.js'
import analyzeCodebaseRoutes from './routes/analyze-codebase.js'
import captureThoughtRoutes from './routes/capture-thought.js'
import browseRoutes from './routes/browse.js'
import forgetCronRoutes from './routes/forget-cron.js'
import entityCronRoutes from './routes/entity-cron.js'

export function createMemoryServer(): Hono {
  const app = new Hono()

  // Health check
  app.get('/health', (c) => c.json({ status: 'ok', service: '@traqr/memory' }))

  // Core routes (existing)
  app.route('/search', searchRoutes)
  app.route('/store', storeRoutes)
  app.route('/', crudRoutes)           // /get, /update, /verify
  app.route('/export', exportRoutes)
  app.route('/cite', citeRoutes)
  app.route('/dashboard', dashboardRoutes)
  app.route('/sync', syncRoutes)
  app.route('/bootstrap', bootstrapRoutes)
  app.route('/capture-session', captureSessionRoutes)

  // New portable routes (Phase 1)
  app.route('/pulse', pulseRoutes)
  app.route('/assemble-context', assembleContextRoutes)
  app.route('/learnings', learningsRoutes)
  app.route('/extract-pr-learnings', extractPrLearningsRoutes)
  app.route('/voice-profile', voiceProfileRoutes)
  app.route('/analyze-voice', analyzeVoiceRoutes)
  app.route('/analyze-codebase', analyzeCodebaseRoutes)
  app.route('/capture', captureThoughtRoutes)
  app.route('/browse', browseRoutes)
  app.route('/forget-cron', forgetCronRoutes)
  app.route('/entity-cron', entityCronRoutes)

  return app
}

// Start server if run directly
const isMain = process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')
if (isMain) {
  const port = parseInt(process.env.PORT || '4100', 10)
  const app = createMemoryServer()

  console.log(`@traqr/memory server starting on port ${port}...`)

  serve({
    fetch: app.fetch,
    port,
  }, (info) => {
    console.log(`@traqr/memory server running at http://localhost:${info.port}`)
  })
}
