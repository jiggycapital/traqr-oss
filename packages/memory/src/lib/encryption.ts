/**
 * Application-Level Encryption (TD-715)
 *
 * AES-256-GCM encryption for confidential/restricted memory content.
 * Confidential and restricted memories have their content field encrypted
 * before hitting Supabase. Decryption is transparent via the converter layer.
 *
 * Key: TRAQR_ENCRYPTION_KEY env var (64 hex chars = 32 bytes for AES-256)
 * Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Part of Glasswing Red Alert security infrastructure.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16

export interface EncryptedPayload {
  ciphertext: string  // base64-encoded
  iv: string          // hex-encoded
  authTag: string     // hex-encoded
  keyVersion: number
}

function getEncryptionKey(): Buffer | null {
  const keyHex = process.env.TRAQR_ENCRYPTION_KEY
  if (!keyHex) return null

  const key = Buffer.from(keyHex, 'hex')
  if (key.length !== 32) {
    console.error('[Encryption] TRAQR_ENCRYPTION_KEY must be 64 hex characters (32 bytes)')
    return null
  }
  return key
}

/** Check if encryption is configured and available. */
export function isEncryptionEnabled(): boolean {
  return getEncryptionKey() !== null
}

/** Encrypt plaintext content using AES-256-GCM. Returns null if not configured. */
export function encrypt(plaintext: string): EncryptedPayload | null {
  const key = getEncryptionKey()
  if (!key) return null

  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })

  let encrypted = cipher.update(plaintext, 'utf8', 'base64')
  encrypted += cipher.final('base64')
  const authTag = cipher.getAuthTag()

  return {
    ciphertext: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    keyVersion: 1,
  }
}

/** Decrypt ciphertext using AES-256-GCM. Returns null on failure or if not configured. */
export function decrypt(payload: EncryptedPayload): string | null {
  const key = getEncryptionKey()
  if (!key) return null

  try {
    const iv = Buffer.from(payload.iv, 'hex')
    const authTag = Buffer.from(payload.authTag, 'hex')
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(payload.ciphertext, 'base64', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  } catch (error) {
    console.error('[Encryption] Decryption failed:', error instanceof Error ? error.message : error)
    return null
  }
}
