import { describe, it, expect } from 'vitest';
import { parseBool, findWhitespacePaddedEnvKeys } from '../env-bool.js';

describe('parseBool', () => {
  it('parses clean values', () => {
    expect(parseBool('true', false)).toBe(true);
    expect(parseBool('false', true)).toBe(false);
  });

  it('falls back to the default when unset or empty', () => {
    expect(parseBool(undefined, true)).toBe(true);
    expect(parseBool(undefined, false)).toBe(false);
    expect(parseBool('', true)).toBe(true);
    expect(parseBool('   ', false)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(parseBool('TRUE', false)).toBe(true);
    expect(parseBool('False', true)).toBe(false);
  });

  it('does not coerce unrecognised values — it defers to the default', () => {
    // Silently treating garbage as a boolean is the bug class this ends.
    expect(parseBool('yes', false)).toBe(false);
    expect(parseBool('1', false)).toBe(false);
    expect(parseBool('yes', true)).toBe(true);
    expect(parseBool('0', true)).toBe(true);
  });

  // ---- TD-1087 regression: the exact corruption `vercel env pull` produces ----

  describe('the "true\\n" corruption from vercel env pull', () => {
    // A value authored in the Vercel store as "true\n" — a literal backslash-n
    // inside double quotes — is expanded by dotenv into a real trailing newline.
    const CORRUPT_TRUE = 'true\n';
    const CORRUPT_FALSE = 'false\n';

    it('reproduces the raw defect both operators had', () => {
      // Fail-CLOSED: a feature you switched ON stays OFF.
      expect(CORRUPT_TRUE === 'true').toBe(false);
      // Fail-OPEN: a switch you turned OFF stays ON. This is the dangerous one.
      expect(CORRUPT_FALSE !== 'false').toBe(true);
    });

    it('parses a corrupted true as true regardless of the default', () => {
      expect(parseBool(CORRUPT_TRUE, false)).toBe(true);
      expect(parseBool(CORRUPT_TRUE, true)).toBe(true);
    });

    it('parses a corrupted false as false — the off-switch survives', () => {
      expect(parseBool(CORRUPT_FALSE, true)).toBe(false);
      expect(parseBool(CORRUPT_FALSE, false)).toBe(false);
    });

    it('handles the other whitespace shapes the same way', () => {
      expect(parseBool(' true ', false)).toBe(true);
      expect(parseBool('true\r\n', false)).toBe(true);
      expect(parseBool('\tfalse\t', true)).toBe(false);
    });
  });

  it('makes the default explicit rather than encoding it in the operator', () => {
    // The old call sites differed only in `===` vs `!==`, which is where the
    // fail-open/fail-closed choice hid. Both directions are now stated.
    expect(parseBool(undefined, true)).toBe(true);   // was: !== 'false'
    expect(parseBool(undefined, false)).toBe(false); // was: === 'true'
  });
});

describe('findWhitespacePaddedEnvKeys', () => {
  const env = {
    CLEAN: 'true',
    PADDED_NEWLINE: 'true\n',
    PADDED_SPACE: ' secret ',
    EMPTY: '',
    ABSENT: undefined,
  } as NodeJS.ProcessEnv;

  it('finds only the padded keys', () => {
    expect(findWhitespacePaddedEnvKeys(Object.keys(env), env).sort()).toEqual([
      'PADDED_NEWLINE',
      'PADDED_SPACE',
    ]);
  });

  it('returns key names only, never values', () => {
    const found = findWhitespacePaddedEnvKeys(Object.keys(env), env);
    expect(found.join()).not.toContain('secret');
  });

  it('ignores absent and empty values', () => {
    expect(findWhitespacePaddedEnvKeys(['ABSENT', 'EMPTY', 'MISSING'], env)).toEqual([]);
  });
});
