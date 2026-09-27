// Bundles the operator commands, each with its dependencies, into one file in .output/, so a production image
// can run them with only .output/ and drizzle/ (no node_modules). Run after `pnpm build`.
//   scripts/migrate.ts      -> .output/migrate.mjs      (drizzle-orm, pg)
//   scripts/create-user.ts  -> .output/create-user.mjs  (the server's auth and database modules)
// Usage: node scripts/bundle-cli.ts
import { build } from 'vite'

const COMMANDS = { 'scripts/migrate.ts': 'migrate.mjs', 'scripts/create-user.ts': 'create-user.mjs' }

// One build per command: a single file each, sharing nothing.
for (const [entry, file] of Object.entries(COMMANDS)) {
  await build({
    configFile: false,
    logLevel: 'warn',
    publicDir: false,
    build: {
      ssr: entry,
      outDir: '.output',
      emptyOutDir: false,
      minify: false,
      target: 'node26',
      rolldownOptions: {
        // React Router's "use client" markers mean nothing to a command.
        onLog: (level, log, handler) => {
          if (log.code !== 'MODULE_LEVEL_DIRECTIVE') handler(level, log)
        },
        output: { format: 'es', entryFileNames: file, codeSplitting: false },
        // pg-native: an optional binding that pg only loads when asked to. The others are virtual modules of
        // the app build that TanStack Start's request handler imports dynamically, when it handles a request,
        // which a command never does (Better Auth's tanstackStartCookies plugin brings the handler along).
        external: ['pg-native', /^#tanstack-(router|start)-entry$/, /^tanstack-start-[a-z-]+:v$/],
      },
    },
    ssr: { noExternal: true, target: 'node' },
  })
  console.log(`wrote .output/${file}`)
}
