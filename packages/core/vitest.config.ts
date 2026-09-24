import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Pinned to THIS FILE's directory, not the cwd. vitest's default root is the
        // cwd, so `root: '.'` — what stood here — merely restated that default: run
        // from the package dir it worked, and `npm run test:core` from the repo root
        // resolved `src/**` against the REPO root and found zero files, exiting 1.
        // The alias had never run a single core test. Deriving the root from
        // import.meta.url makes both invocations resolve the same directory.
        root: fileURLToPath(new URL('.', import.meta.url)),
        include: ['src/**/*.{test,spec}.{ts,mts}'],
        exclude: ['node_modules', 'dist'],
    },
});
