/**
 * Shell Generator Smoke Tests
 *
 * Validates that all 3 shell generators produce syntactically valid bash
 * and contain expected patterns. Uses `bash -n` for syntax checking.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { writeFileSync, unlinkSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { tmpdir } from 'os';

import { generateAliasContent } from '../alias-generator.js';
import { SOLO_FIXTURE, PRODUCTION_FIXTURE, FULL_FIXTURE } from '../test-fixtures.js';
import type { TraqrConfig } from '../config-schema.js';

// Mock config-resolver for shell-init and MOTD generators
vi.mock('../config-resolver.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config-resolver.js')>();
  return {
    ...actual,
    loadOrgConfig: vi.fn(() => ({
      config: {
        primaryProject: 'testproject',
        projects: {
          testproject: {
            repoPath: '/tmp/traqr-test/testproject',
            worktreesPath: '/tmp/traqr-test/testproject/.worktrees',
            displayName: 'Test Project',
            aliasPrefix: 'tp',
            registeredAt: '2025-01-01T00:00:00Z',
          },
        },
      },
      path: '/tmp/.traqr/config.json',
    })),
    loadProjectConfig: vi.fn(() => ({
      config: {
        ...PRODUCTION_FIXTURE,
      },
      path: '/tmp/traqr-test/testproject/.traqr/config.json',
    })),
  };
});

// ============================================================
// Helpers
// ============================================================

let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'shell-gen-test-'));
});

/**
 * Write content to a temp file, run `bash -n` to syntax-check,
 * and return { valid, stderr }.
 */
function bashSyntaxCheck(content: string, name: string): { valid: boolean; stderr: string } {
  const filePath = join(tempDir, `${name}.sh`);
  writeFileSync(filePath, content, 'utf-8');
  try {
    execSync(`bash -n "${filePath}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    unlinkSync(filePath);
    return { valid: true, stderr: '' };
  } catch (e: unknown) {
    const error = e as { stderr?: string };
    unlinkSync(filePath);
    return { valid: false, stderr: error.stderr || '' };
  }
}

// ============================================================
// Alias Generator
// ============================================================

describe('alias-generator', () => {
  const fixtures: Array<{ name: string; config: TraqrConfig }> = [
    { name: 'SOLO', config: SOLO_FIXTURE },
    { name: 'PRODUCTION', config: PRODUCTION_FIXTURE },
    { name: 'FULL', config: FULL_FIXTURE },
  ];

  for (const { name, config } of fixtures) {
    describe(`${name} fixture (isPrimary: true)`, () => {
      let content: string;

      beforeAll(() => {
        content = generateAliasContent(config, { isPrimary: true });
      });

      it('passes bash -n syntax validation', () => {
        const result = bashSyntaxCheck(content, `alias-${name.toLowerCase()}`);
        expect(result.valid, `bash -n failed:\n${result.stderr}`).toBe(true);
      });

      it('has shebang and core exports', () => {
        expect(content).toContain('#!/bin/bash');
        expect(content).toContain('export TP_MAIN=');
      });

      it('has claude launcher helper', () => {
        expect(content).toContain('_tp_claude()');
      });

      it('has slot management functions', () => {
        expect(content).toContain('tp-slots()');
        expect(content).toContain('tp-sync()');
        expect(content).toContain('tp-ship()');
        expect(content).toContain('tp-dev()');
      });
    });
  }

  describe('SOLO-specific exclusions', () => {
    let content: string;

    beforeAll(() => {
      content = generateAliasContent(SOLO_FIXTURE, { isPrimary: true });
    });

    it('does not have analysis alias', () => {
      expect(content).not.toMatch(/\balias za=/);
      expect(content).not.toContain('analysis');
    });

    it('does not have devops aliases', () => {
      expect(content).not.toMatch(/\balias zd1=/);
    });
  });

  describe('FULL-specific inclusions', () => {
    let content: string;

    beforeAll(() => {
      content = generateAliasContent(FULL_FIXTURE, { isPrimary: true });
    });

    it('has all devops slot aliases', () => {
      expect(content).toContain('zd1');
      expect(content).toContain('zd2');
      expect(content).toContain('zd3');
    });
  });

  describe('non-primary project', () => {
    let content: string;

    beforeAll(() => {
      content = generateAliasContent(PRODUCTION_FIXTURE, { isPrimary: false });
    });

    it('passes bash -n syntax validation', () => {
      const result = bashSyntaxCheck(content, 'alias-nonprimary');
      expect(result.valid, `bash -n failed:\n${result.stderr}`).toBe(true);
    });

    it('does NOT have generic aliases', () => {
      // Generic aliases like `alias zm=` and `cm()` should not appear
      expect(content).not.toMatch(/^alias zm=/m);
      expect(content).not.toMatch(/^cm\(\)/m);
    });

    it('has prefixed aliases', () => {
      expect(content).toContain('alias tpm=');
      expect(content).toContain('tpcm()');
    });
  });
});

// ============================================================
// Shell Init Generator
// ============================================================

describe('shell-init-generator', () => {
  let content: string;

  beforeAll(async () => {
    // Dynamic import after mocks are set up
    const mod = await import('../shell-init-generator.js');
    content = mod.generateShellInitContent();
  });

  it('passes bash -n syntax validation', () => {
    const result = bashSyntaxCheck(content, 'shell-init');
    expect(result.valid, `bash -n failed:\n${result.stderr}`).toBe(true);
  });

  it('has shebang', () => {
    expect(content).toContain('#!/bin/bash');
  });

  it('exports PATH with node_modules/.bin', () => {
    expect(content).toContain('export PATH=');
  });

  it('defines traqr() dispatcher function', () => {
    expect(content).toContain('traqr()');
  });

  it('sources alias files from ~/.traqr/aliases/', () => {
    expect(content).toContain('~/.traqr/aliases/*.sh');
  });

  it('sources MOTD', () => {
    expect(content).toContain('~/.traqr/motd.sh');
  });
});

// ============================================================
// MOTD Generator
// ============================================================

describe('motd-generator', () => {
  let content: string;

  beforeAll(async () => {
    const mod = await import('../motd-generator.js');
    content = mod.generateMotdContent();
  });

  it('passes bash -n syntax validation', () => {
    const result = bashSyntaxCheck(content, 'motd');
    expect(result.valid, `bash -n failed:\n${result.stderr}`).toBe(true);
  });

  it('defines _traqr_motd() function', () => {
    expect(content).toContain('_traqr_motd()');
  });

  it('auto-invokes _traqr_motd', () => {
    expect(content).toMatch(/^_traqr_motd$/m);
  });

  it('overrides legacy _nook_motd()', () => {
    expect(content).toContain('_nook_motd() { :; }');
  });
});
