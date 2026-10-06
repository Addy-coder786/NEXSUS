import { defineConfig } from 'tsup';

/**
 * Production bundle for the API. `@nexus/shared` ships as raw TypeScript (main: ./src/index.ts),
 * so it must be bundled into dist instead of being required at runtime. Every other dependency
 * stays external and is installed with `npm ci --omit=dev` in the runtime image.
 */
export default defineConfig({
  entry: ['src/server.ts'],
  format: ['cjs'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  splitting: false,
  noExternal: ['@nexus/shared'],
});
