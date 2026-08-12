/**
 * Forget Cron Route
 *
 * POST /forget-cron — Soft-delete memories past their forget_after date,
 * then hard-delete memories past their retention_expires_at date.
 * Calls forget_expired_memories RPC (Migration 011) and
 * cleanup_expired_retention RPC (Migration 013).
 */

import { Hono } from 'hono'
import { getMemoryClient } from '../lib/client.js'

const app = new Hono()

app.post('/', async (c) => {
  try {
    const client = getMemoryClient()

    // Step 1: Soft-delete memories past their forget_after date
    const { data: forgottenData, error: forgetError } = await (client.rpc as any)('forget_expired_memories')

    if (forgetError) {
      console.error('[forget-cron] forget_expired_memories RPC error:', forgetError)
    }

    const forgotten = forgottenData ?? 0
    if (forgotten > 0) {
      console.log(`[forget-cron] Soft-deleted ${forgotten} expired memories`)
    }

    // Step 2: Hard-delete memories past their retention expiry (GDPR compliance)
    let retained = 0
    try {
      const { data: retainedData, error: retainError } = await (client.rpc as any)('cleanup_expired_retention')
      if (retainError) {
        console.error('[forget-cron] cleanup_expired_retention RPC error:', retainError)
      } else {
        retained = retainedData ?? 0
        if (retained > 0) {
          console.log(`[forget-cron] Retention cleanup: hard-deleted ${retained} expired memories`)
        }
      }
    } catch {
      // Migration 013 not yet deployed — skip retention cleanup
    }

    return c.json({ success: true, forgotten, retentionDeleted: retained })
  } catch (error) {
    console.error('[forget-cron] Error:', error)
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      500,
    )
  }
})

export default app
