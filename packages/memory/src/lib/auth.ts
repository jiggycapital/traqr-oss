/**
 * Portable Auth Middleware for @traqr/memory
 *
 * Bearer token auth using INTERNAL_API_KEY or CRON_SECRET env vars.
 * If neither is set, auth is skipped (dev mode).
 */

import type { Context, Next } from 'hono'

export function getInternalSecret(): string | undefined {
  return process.env.INTERNAL_API_KEY || process.env.CRON_SECRET
}

/**
 * Verify Bearer token auth on a Hono context.
 * Returns true if auth passes or no secret is configured.
 */
export function verifyAuth(c: Context): boolean {
  const secret = getInternalSecret()
  if (!secret) return true // No secret = dev mode, skip auth
  const auth = c.req.header('authorization')
  return auth === `Bearer ${secret}`
}

/**
 * Hono middleware that enforces internal auth.
 * Returns 401 if auth fails.
 */
export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  if (!verifyAuth(c)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
}
