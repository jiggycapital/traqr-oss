/**
 * Content fingerprint of the LOADED MCP code — the fix for the false-positive
 * staleness flood (TD-896 follow-up).
 *
 * The orient freshness detector used to flag a worktree's memory MCP "STALE"
 * whenever `process_start_time < dist/index.js mtime`. But `build:packages` runs
 * through turbo, and a turbo cache-replay rewrites every `dist/**` mtime to "now"
 * even on a CACHE HIT with zero byte changes (verified 2026-06-24: FULL TURBO,
 * 60ms, mtime 07:54 -> 20:00, `git diff` on dist empty). So every routine build
 * — `/ship`, app builds, `/sync`, rebase-then-rebuild — re-stamped the mtime and
 * made a long-lived MCP child (which only respawns on a full session restart)
 * read as STALE while serving byte-identical code. The scary "treat every result
 * as suspect, confidential leaks" warning then fired on nearly every session.
 *
 * The fix: compare CONTENT, not mtime. The server stamps a sha256 of the dist it
 * actually loaded at spawn (`writeRuntimeMarker`); the detector recomputes the
 * sha256 of the CURRENT dist (`--print-fingerprint`) and compares. Identical
 * bytes -> identical hash -> fresh, regardless of how many times turbo bumped the
 * mtime. A genuine upgrade (rebased to newer source, rebuilt) changes the bytes
 * -> different hash -> correctly STALE until the session restarts. No false
 * positives, no missed true positives.
 */
import { createHash } from 'node:crypto'
import {
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { dirname, join, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'

/** All `*.js` files under `dir`, recursively, as absolute paths. */
function jsFilesUnder(dir: string): string[] {
  let out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    const abs = join(dir, name)
    let st
    try {
      st = statSync(abs)
    } catch {
      continue
    }
    if (st.isDirectory()) out = out.concat(jsFilesUnder(abs))
    else if (name.endsWith('.js')) out.push(abs)
  }
  return out
}

/**
 * Deterministic sha256 over the `*.js` bytes in the given dist dirs, keyed by
 * each file's path relative to its dir. CONTENT, not mtime — a cache-replay that
 * rewrites mtimes but not bytes produces the same digest. Dirs and files are
 * sorted so the hash is independent of filesystem enumeration order.
 */
export function hashDistDirs(dirs: string[]): string {
  const h = createHash('sha256')
  for (const dir of [...dirs].sort()) {
    const files = jsFilesUnder(dir)
      .map((abs) => ({ abs, rel: relative(dir, abs).split(sep).join('/') }))
      .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
    for (const f of files) {
      h.update(f.rel)
      h.update('\0')
      h.update(readFileSync(f.abs))
      h.update('\0')
    }
  }
  return h.digest('hex')
}

/**
 * The dist dirs this running server actually loaded: its own compiled dist plus
 * the `@traqr/memory` lib dist it imports (where the security-sensitive
 * retrieval/decryption code — the reason staleness is dangerous — lives).
 */
export function loadedDistDirs(): string[] {
  // this file compiles to .../memory-mcp/dist/lib/fingerprint.js -> own dist root
  const ownDist = dirname(dirname(fileURLToPath(import.meta.url)))
  const dirs = [ownDist]
  try {
    const req = createRequire(import.meta.url)
    const libEntry = req.resolve('@traqr/memory') // .../memory/dist/index.js
    dirs.push(dirname(libEntry))
  } catch {
    // lib unresolvable (unusual) — own dist still fingerprints meaningfully
  }
  return dirs
}

/** sha256 of the code this process loaded (own dist + @traqr/memory dist). */
export function computeLoadedFingerprint(): string {
  return hashDistDirs(loadedDistDirs())
}

const MARKER_DIR = join(tmpdir(), 'traqr-memory-mcp-runtime')

/** Per-pid marker path the detector reads. Kept deterministic so bash can find it. */
export function markerPathFor(pid: number): string {
  return join(MARKER_DIR, `${pid}.json`)
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Stamp this process's loaded-code fingerprint to a per-pid marker so the orient
 * freshness detector can compare LOADED vs CURRENT code by content. Best-effort:
 * never throws into the boot path (the marker is advisory; a missing marker just
 * makes the detector fall back to the old mtime heuristic). Opportunistically
 * prunes markers whose pid is dead so the dir doesn't accumulate.
 */
export function writeRuntimeMarker(): void {
  try {
    mkdirSync(MARKER_DIR, { recursive: true })
    try {
      for (const f of readdirSync(MARKER_DIR)) {
        const pid = Number(f.replace(/\.json$/, ''))
        if (pid && !pidAlive(pid)) {
          try {
            rmSync(join(MARKER_DIR, f))
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* pruning is opportunistic */
    }
    writeFileSync(
      markerPathFor(process.pid),
      JSON.stringify({
        pid: process.pid,
        fingerprint: computeLoadedFingerprint(),
        cwd: process.cwd(),
        startedAt: new Date().toISOString(),
      }),
    )
  } catch {
    // Marker is advisory — boot must never fail on it.
  }
}
