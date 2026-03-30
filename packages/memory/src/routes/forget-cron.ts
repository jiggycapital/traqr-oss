/**
 * Forget Cron Route
 *
 * POST /forget-cron — Soft-delete memories past their forget_after date.
 * Calls the forget_expired_memories RPC deployed in Migration 011.
 */

import { Hono } from 'hono'
import { getMemoryClient } from '../lib/client.js'

const app = new Hono()

app.post('/', async (c) => {
  try {
    const client = getMemoryClient()
    const { data, error } = await (client.rpc as any)('forget_expired_memories')

    if (error) {
      console.error('[forget-cron] RPC error:', error)
      return c.json({ success: false, error: error.message }, 500)
    }

    const forgotten = data ?? 0
    if (forgotten > 0) {
      console.log(`[forget-cron] Soft-deleted ${forgotten} expired memories`)
    }

    return c.json({ success: true, forgotten })
  } catch (error) {
    console.error('[forget-cron] Error:', error)
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      500,
    )
  }
})

export default app
