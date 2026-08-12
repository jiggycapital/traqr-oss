import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        root: '.',
        include: ['src/**/*.{test,spec}.{ts,mts}'],
        exclude: ['node_modules', 'dist'],
    },
});
