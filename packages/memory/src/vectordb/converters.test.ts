/**
 * Converter decryption-gate tests (TD-884 fork B).
 *
 * Pins rowToMemory / rowToSearchResult: the single decrypt choke-point. With a
 * ceiling (accessLevel/maxClassification), over-tier content is NEVER decrypted —
 * it stays as the stored [ENCRYPTED] placeholder, even though the key is present.
 * Without opts the behavior is byte-identical to before (internal callers unchanged).
 *
 * Uses the REAL AES-256-GCM module with a throwaway test key (round-trip), so the
 * test proves the actual decrypt path is gated — not a mock. Deterministic, no DB.
 *
 * Run: npx tsx packages/memory/src/vectordb/converters.test.ts
 */

// Set a throwaway 32-byte key BEFORE importing anything that reads it. The module
// reads process.env at call-time, but set it up top to be safe/explicit.
process.env.TRAQR_ENCRYPTION_KEY = '0'.repeat(64) // 64 hex chars = 32 bytes

import { rowToMemory, rowToSearchResult } from './converters.js'
import type { MemoryRow, SearchResultRow } from './converters.js'
import { encrypt, isEncryptionEnabled } from '../lib/encryption.js'

let passed = 0
let failed = 0

function assert(label: string, condition: boolean) {
  if (condition) {
    console.log(`  PASS  ${label}`)
    passed++
  } else {
    console.log(`  FAIL  ${label}`)
    failed++
  }
}

const PLACEHOLDER = '[ENCRYPTED]'
const SECRET = 'the confidential plaintext that must not leak over-tier'

// A complete MemoryRow with sane defaults; override what each case needs.
function makeRow(overrides: Partial<MemoryRow> = {}): MemoryRow {
  return {
    id: 'mem-1',
    user_id: 'u1',
    project_id: null,
    content: PLACEHOLDER,
    summary: 'a summary (plaintext column)',
    category: 'insight',
    tags: [],
    context_tags: [],
    domain: null,
    topic: null,
    embedding: null,
    embedding_model: 'test',
    embedding_model_version: '1',
    source_type: 'manual',
    source_ref: null,
    source_project: 'traqr',
    original_confidence: 1,
    last_validated: new Date().toISOString(),
    related_to: [],
    is_contradiction: false,
    is_archived: false,
    archived_at: null,
    archive_reason: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    classification: 'confidential',
    ...overrides,
  }
}

// Build an encrypted row at a given classification carrying SECRET as ciphertext.
function encryptedRow(classification: string | null): MemoryRow {
  const payload = encrypt(SECRET)
  if (!payload) throw new Error('test setup: encryption not enabled (key not set?)')
  return makeRow({
    classification: classification as MemoryRow['classification'],
    content: PLACEHOLDER,
    encrypted_content: payload.ciphertext,
    encryption_iv: payload.iv,
    encryption_tag: payload.authTag,
    encryption_key_version: payload.keyVersion,
  })
}

console.log('\n--- converter decryption gate (TD-884 fork B) ---')

assert('test key is loaded (encryption enabled)', isEncryptionEnabled() === true)

// 0. Sanity: the round-trip actually decrypts with no ceiling (backward compat —
//    internal/trusted callers see content exactly as before).
{
  const m = rowToMemory(encryptedRow('confidential'))
  assert('no opts → confidential content decrypts (unchanged behavior)', m.content === SECRET)
  assert('no opts → classification preserved', m.classification === 'confidential')
}

// 1. THE GATE: over-tier caller never decrypts — content stays the placeholder.
//    exploration ceiling = 'internal' < confidential.
{
  const m = rowToMemory(encryptedRow('confidential'), { accessLevel: 'exploration' })
  assert('over-tier (exploration vs confidential) → NOT decrypted', m.content === PLACEHOLDER)
  assert('over-tier → secret never appears in content', !m.content.includes('plaintext'))
  assert('over-tier → classification still surfaced (only content is gated)', m.classification === 'confidential')
}

// 2. In-tier caller decrypts. standard ceiling = 'confidential' ≥ confidential.
{
  const m = rowToMemory(encryptedRow('confidential'), { accessLevel: 'standard' })
  assert('in-tier (standard vs confidential) → decrypts', m.content === SECRET)
}

// 3. Exact-tier and above decrypt (privileged/admin ceiling = restricted).
{
  const restr = encryptedRow('restricted')
  assert('privileged vs restricted → decrypts', rowToMemory(restr, { accessLevel: 'privileged' }).content === SECRET)
  assert('admin vs restricted → decrypts', rowToMemory(encryptedRow('restricted'), { accessLevel: 'admin' }).content === SECRET)
  assert('exploration vs restricted → NOT decrypted', rowToMemory(encryptedRow('restricted'), { accessLevel: 'exploration' }).content === PLACEHOLDER)
}

// 4. maxClassification overrides accessLevel: admin would see confidential, but an
//    explicit 'internal' ceiling blocks it.
{
  const m = rowToMemory(encryptedRow('confidential'), { accessLevel: 'admin', maxClassification: 'internal' })
  assert('maxClassification override (admin + internal) → confidential NOT decrypted', m.content === PLACEHOLDER)
}

// 5. NULL classification hydrates to 'internal' → in-tier at exploration → decrypts.
//    (Encrypted-but-unclassified is an edge; the gate must not over-redact it.)
{
  const m = rowToMemory(encryptedRow(null), { accessLevel: 'exploration' })
  assert('NULL classification → internal → decrypts at exploration', m.content === SECRET)
  assert('NULL classification → surfaced as internal', m.classification === 'internal')
}

// 6. Unencrypted rows are untouched by the gate (no encrypted_content → nothing to
//    gate; plain content passes through at every tier).
{
  const plain = makeRow({ classification: 'public', content: 'plain public content' })
  assert('unencrypted row → content unchanged at exploration', rowToMemory(plain, { accessLevel: 'exploration' }).content === 'plain public content')
  assert('unencrypted row → content unchanged with no opts', rowToMemory(plain).content === 'plain public content')
}

// 7. rowToSearchResult threads opts through to the same gate.
{
  const srBase = encryptedRow('confidential') as SearchResultRow
  srBase.current_confidence = 1
  srBase.similarity = 0.9
  srBase.relevance_score = 0.9
  const over = rowToSearchResult(srBase, { accessLevel: 'exploration' })
  assert('rowToSearchResult over-tier → NOT decrypted', over.content === PLACEHOLDER)
  assert('rowToSearchResult carries search fields', over.similarity === 0.9 && over.relevanceScore === 0.9)
  const inTier = rowToSearchResult(srBase, { accessLevel: 'standard' })
  assert('rowToSearchResult in-tier → decrypts', inTier.content === SECRET)
}

console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('CONVERTER DECRYPTION-GATE TESTS FAILED')
  process.exit(1)
} else {
  console.log('All converter decryption-gate tests passed!')
}
