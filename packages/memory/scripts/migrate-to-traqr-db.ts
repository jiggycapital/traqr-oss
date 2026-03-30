#!/usr/bin/env npx tsx
/**
 * One-time migration: Copy all memories from old Supabase (NookTraqr)
 * to new Supabase (traqr-db on sean@traqr.dev).
 *
 * Copies embeddings as-is — no re-embedding needed.
 *
 * Usage:
 *   npx tsx packages/memory/scripts/migrate-to-traqr-db.ts
 *
 * Env vars (from .env.local):
 *   OLD_SUPABASE_URL, OLD_SUPABASE_KEY  — source (NookTraqr)
 *   NEW_SUPABASE_URL, NEW_SUPABASE_KEY  — destination (traqr-db)
 */

import { createClient } from '@supabase/supabase-js'

const OLD_URL = process.env.OLD_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const OLD_KEY = process.env.OLD_SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const NEW_URL = process.env.NEW_SUPABASE_URL || ''
const NEW_KEY = process.env.NEW_SUPABASE_KEY || ''

if (!OLD_URL || !OLD_KEY) {
  console.error('Missing OLD_SUPABASE_URL / OLD_SUPABASE_KEY')
  process.exit(1)
}
if (!NEW_URL || !NEW_KEY) {
  console.error('Missing NEW_SUPABASE_URL / NEW_SUPABASE_KEY')
  process.exit(1)
}

const oldClient = createClient(OLD_URL, OLD_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const newClient = createClient(NEW_URL, NEW_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const TABLE = 'traqr_memories'
const HISTORY_TABLE = 'traqr_memory_history'
const BATCH_SIZE = 50

async function migrate() {
  console.log(`Source: ${OLD_URL}`)
  console.log(`Destination: ${NEW_URL}`)

  // 1. Count source memories
  const { count: totalCount, error: countErr } = await (oldClient.from(TABLE) as any)
    .select('id', { count: 'exact', head: true })
  if (countErr) {
    console.error('Failed to count source memories:', countErr.message)
    process.exit(1)
  }
  console.log(`\nSource has ${totalCount} memories`)

  // 2. Check destination is empty
  const { count: destCount } = await (newClient.from(TABLE) as any)
    .select('id', { count: 'exact', head: true })
  if (destCount && destCount > 0) {
    console.log(`Destination already has ${destCount} memories — aborting to prevent duplicates`)
    console.log('Drop and recreate if you want a fresh migration.')
    process.exit(1)
  }

  // 3. Fetch all memories in batches
  let offset = 0
  let migrated = 0
  let errors = 0

  while (offset < (totalCount || 0)) {
    const { data: batch, error: fetchErr } = await (oldClient.from(TABLE) as any)
      .select('*')
      .range(offset, offset + BATCH_SIZE - 1)
      .order('created_at', { ascending: true })

    if (fetchErr) {
      console.error(`Fetch error at offset ${offset}:`, fetchErr.message)
      errors++
      offset += BATCH_SIZE
      continue
    }

    if (!batch || batch.length === 0) break

    // Strip any fields the new schema might not have, keep everything else
    const rows = batch.map((row: any) => ({
      id: row.id,
      user_id: row.user_id || 'a0000000-0000-0000-0000-000000000001',
      project_id: row.project_id || 'b0000000-0000-0000-0000-000000000001',
      domain_id: row.domain_id || null,
      content: row.content,
      summary: row.summary,
      category: row.category,
      tags: row.tags || [],
      context_tags: row.context_tags || [],
      embedding: row.embedding,
      embedding_model: row.embedding_model,
      embedding_model_version: row.embedding_model_version,
      needs_reembedding: row.needs_reembedding || false,
      source_type: row.source_type,
      source_ref: row.source_ref,
      source_project: row.source_project || 'default',
      original_confidence: row.original_confidence,
      last_validated: row.last_validated,
      related_to: row.related_to || [],
      is_contradiction: row.is_contradiction || false,
      is_archived: row.is_archived || false,
      archived_at: row.archived_at,
      archive_reason: row.archive_reason,
      durability: row.durability || 'permanent',
      expires_at: row.expires_at,
      is_portable: row.is_portable ?? true,
      is_universal: row.is_universal ?? false,
      agent_type: row.agent_type,
      times_returned: row.times_returned || 0,
      times_cited: row.times_cited || 0,
      last_returned_at: row.last_returned_at,
      last_cited_at: row.last_cited_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))

    const { error: insertErr } = await (newClient.from(TABLE) as any).insert(rows)
    if (insertErr) {
      console.error(`Insert error at offset ${offset}:`, insertErr.message)
      errors++
    } else {
      migrated += rows.length
    }

    process.stdout.write(`\r  Migrated ${migrated}/${totalCount} memories (${errors} errors)`)
    offset += BATCH_SIZE
  }

  console.log(`\n\nMemories: ${migrated} migrated, ${errors} errors`)

  // 4. Migrate history table
  const { data: history, error: histErr } = await (oldClient.from(HISTORY_TABLE) as any)
    .select('*')
    .order('changed_at', { ascending: true })
    .limit(1000)

  if (histErr) {
    console.log('History migration skipped:', histErr.message)
  } else if (history && history.length > 0) {
    const { error: histInsertErr } = await (newClient.from(HISTORY_TABLE) as any).insert(history)
    if (histInsertErr) {
      console.log('History insert error:', histInsertErr.message)
    } else {
      console.log(`History: ${history.length} records migrated`)
    }
  } else {
    console.log('History: no records to migrate')
  }

  console.log('\nDone! Verify with: memory_search in a new session.')
}

migrate().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
