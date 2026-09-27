// Bundles scripts/migrate.ts with drizzle-orm and pg into .output/migrate.mjs, so a production image
// can run migrations with only .output/ and drizzle/ (no node_modules). Run after `pnpm build`.
// Usage: node scripts/migrate-bundle.ts
import { build } from 'vite'

await build({
  configFile: false,
  logLevel: 'warn',
  publicDir: false,
  build: {
    ssr: 'scripts/migrate.ts',
    outDir: '.output',
    emptyOutDir: false,
    minify: false,
    target: 'node26',
    rolldownOptions: {
      output: { format: 'es', entryFileNames: 'migrate.mjs', codeSplitting: false },
      // Optional native binding that pg only loads when asked to.
      external: ['pg-native'],
    },
  },
  ssr: { noExternal: true, target: 'node' },
})
console.log('wrote .output/migrate.mjs')
