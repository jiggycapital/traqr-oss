#!/usr/bin/env node
// run-tsx-tests.mjs — run every src/**/*.test.ts under the current package with tsx, one
// process per file, and grade the set as a whole. Shared by packages/memory and
// packages/memory-mcp; run with cwd = the package directory (`npm test` does that).
//
// It lives INSIDE packages/memory rather than the root scripts/ because the OSS mirror
// (sync-oss.yml) syncs packages/{core,cli,memory,memory-mcp} and never scripts/ — a root
// path would make `npm test` in the mirror fail on a module it cannot find.
//
// TD-1388. packages/memory's "test" script was one `&&` chain naming 18 files on a single
// line (memory-mcp: same shape, 3 files). Every PR that added a test file edited that one
// line, so every such PR conflicted with every other one — three collided on 2026-09-04/05.
// Discovery replaces enumeration: a new test file is picked up by existing on disk, and the
// package.json line never moves again.
//
// These packages do NOT use vitest. Each test file is a standalone tsx script with a
// homegrown printer — some end `Results: N passed, M failed`, others a bare `N passed,
// M failed`, and memory-mcp's fingerprint.test.ts prints something else entirely — and
// every one of them `process.exit(1)`s on any failure. So the EXIT CODE is the grade; the
// summary line is parsed only for the per-file numbers (the LAST `N passed, M failed` match,
// which fits both printer shapes). A file with no such line is reported as `no summary line`
// and graded on exit code alone. A parsed failed-count > 0 is also red, so a printer that
// forgets to exit 1 cannot pass.
//
// The `&&` chain stopped at the first red, so one failing file hid every file after it; this
// runner runs EVERY file and reports each one. And a glob that matches nothing must never
// read as green: zero discovered files is exit 1, and the denominator (file count) is
// printed next to the numerators in the total.
//
// Usage (memory: `node scripts/run-tsx-tests.mjs`; memory-mcp: `node ../memory/scripts/…`):
//   node scripts/run-tsx-tests.mjs          run everything; exit 1 on any red
//   node scripts/run-tsx-tests.mjs --list   print the discovered files, run nothing
//
// RUN_TSX_TESTS_BIN=<path> names the child binary (invoked as `<bin> <file>`) in place of
// the default lookup: the nearest node_modules/.bin/tsx walking up from cwd, else `npx tsx`.
// The runner's vitest test (root scripts/run-tsx-tests.test.ts) points it at a stand-in so
// its fixtures can be plain JS wearing .test.ts — hermetic and fast, independent of tsx.

import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const SKIP_DIRS = new Set(['node_modules', 'dist']);
const SUMMARY = /(\d+) passed, (\d+) failed/g;

function discover(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) found.push(...discover(full));
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      found.push(full);
    }
  }
  return found;
}

function resolveChild(cwd) {
  const override = process.env.RUN_TSX_TESTS_BIN?.trim();
  if (override) return { cmd: override, args: [] };
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    const bin = path.join(dir, 'node_modules', '.bin', 'tsx');
    if (existsSync(bin)) return { cmd: bin, args: [] };
    if (path.dirname(dir) === dir) return { cmd: 'npx', args: ['tsx'] };
  }
}

function main(argv) {
  const unknown = argv.filter((a) => a !== '--list');
  if (unknown.length > 0) {
    console.error(`run-tsx-tests: unknown argument(s): ${unknown.join(' ')}`);
    return 2;
  }
  const cwd = process.cwd();
  const srcDir = path.join(cwd, 'src');
  const files = discover(srcDir).map((f) => path.relative(cwd, f)).sort();

  if (files.length === 0) {
    console.error(`run-tsx-tests: no test files found under ${srcDir}`);
    return 1;
  }
  if (argv.includes('--list')) {
    for (const file of files) console.log(file);
    return 0;
  }

  const { cmd, args } = resolveChild(cwd);
  let passed = 0, failed = 0, nonZero = 0;

  for (const file of files) {
    const res = spawnSync(cmd, [...args, file], {
      cwd,
      stdio: ['inherit', 'pipe', 'inherit'],
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const stdout = res.stdout ?? '';
    process.stdout.write(stdout); // the per-assertion PASS/FAIL lines still show
    if (res.error) console.error(`run-tsx-tests: ${file}: ${res.error.message}`);

    // status is null when the child died to a signal or never spawned — red either way.
    const status = res.status;
    const exit = status ?? `null (${res.signal ?? res.error?.code ?? 'spawn failed'})`;
    if (status !== 0) nonZero++;

    const last = [...stdout.matchAll(SUMMARY)].at(-1);
    if (last) {
      passed += Number(last[1]);
      failed += Number(last[2]);
      console.log(`${file}: ${last[1]} passed, ${last[2]} failed, exit ${exit}`);
    } else {
      console.log(`${file}: no summary line, exit ${exit}`);
    }
  }

  console.log(
    `run-tsx-tests: ${files.length} files · ${passed} passed · ${failed} failed · ${nonZero} non-zero exit(s)`,
  );
  return nonZero > 0 || failed > 0 ? 1 : 0;
}

// exitCode, not process.exit(): a piped stdout is asynchronous on macOS, and process.exit()
// would drop the total line before it reached the pipe.
process.exitCode = main(process.argv.slice(2));
