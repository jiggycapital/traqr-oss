/**
 * Tests for the content fingerprint — the fix for the false-positive staleness
 * flood (TD-896 follow-up). The load-bearing property: the fingerprint keys on
 * file CONTENT, not mtime, so a turbo cache-replay (rewrites dist mtimes but not
 * bytes) yields an IDENTICAL hash and no longer false-fires "STALE".
 */
import { hashDistDirs } from './fingerprint.js'
import { mkdtempSync, writeFileSync, mkdirSync, utimesSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert'

const dir = mkdtempSync(join(tmpdir(), 'fp-test-'))
mkdirSync(join(dir, 'sub'), { recursive: true })
writeFileSync(join(dir, 'index.js'), 'export const a = 1\n')
writeFileSync(join(dir, 'sub', 'tools.js'), 'export const b = 2\n')
writeFileSync(join(dir, 'index.d.ts'), 'export declare const a: number\n') // non-.js: ignored

const h1 = hashDistDirs([dir])
assert.match(h1, /^[0-9a-f]{64}$/, 'returns a 64-char sha256 hex')
assert.strictEqual(hashDistDirs([dir]), h1, 'deterministic across calls')

// CORE PROPERTY: mtime change WITHOUT a content change must NOT move the hash.
// This is exactly the turbo cache-replay case that the old mtime check false-fired on.
const future = new Date(Date.now() + 120_000)
utimesSync(join(dir, 'index.js'), future, future)
assert.strictEqual(hashDistDirs([dir]), h1, 'mtime bump must NOT change the content fingerprint')

// A real content change MUST move the hash (true-positive detection preserved).
writeFileSync(join(dir, 'index.js'), 'export const a = 999\n')
assert.notStrictEqual(hashDistDirs([dir]), h1, 'content change MUST change the fingerprint')

// Adding a new compiled file MUST move the hash (catches new modules in dist).
writeFileSync(join(dir, 'index.js'), 'export const a = 1\n') // revert
assert.strictEqual(hashDistDirs([dir]), h1, 'reverting content restores the hash')
writeFileSync(join(dir, 'sub', 'extra.js'), 'export const c = 3\n')
assert.notStrictEqual(hashDistDirs([dir]), h1, 'a new .js file MUST change the fingerprint')

rmSync(dir, { recursive: true, force: true })
console.log('fingerprint.test.ts: ok')
