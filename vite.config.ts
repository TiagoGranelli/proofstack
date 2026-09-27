import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'
import { writeBuildStamp } from './scripts/build-freshness.ts'
import { documentHeaders } from './src/lib/content-security-policy.ts'
import { inlineSourceHashes } from './src/server/nitro/prerender-csp.ts'

export default defineConfig({
  server: {
    port: 3000,
    strictPort: true,
    // Build output, reports and agent/vendored-source folders never feed the dev graph; watching them
    // makes `pnpm build` or a Lighthouse run during `pnpm dev` churn the watcher.
    watch: {
      ignored: [
        '**/.output/**',
        '**/.fallow/**',
        '**/.lighthouseci/**',
        '**/lighthouse-report/**',
        '**/playwright-report/**',
        '**/repos/**',
        '**/.agents/**',
        '**/.claude/**',
      ],
    },
  },
  build: {
    rolldownOptions: {
      // Radix and TanStack Query ship `"use client"` directives for React Server Components. They are
      // meaningless here and the bundler drops them, one warning per module. Everything else still shows.
      onLog(level, log, handler) {
        if (log.code === 'MODULE_LEVEL_DIRECTIVE' && log.message.includes('use client')) return
        handler(level, log)
      },
    },
  },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    nitro({
      // startup: validates env and logs process-level errors. http: security headers, the fallback CSP and
      // request logs for every response, static files included.
      plugins: ['./src/server/nitro/startup.ts', './src/server/nitro/http.ts'],
      // Finite static pages are prerendered by Nitro, the deployment layer (ADR 0004).
      // failOnError: a page that cannot be prerendered (e.g. missing env) fails the build instead of
      // silently shipping without its static copy.
      prerender: { routes: ['/about'], crawlLinks: false, failOnError: true },
      hooks: {
        // A static page cannot carry a per-request nonce, so its CSP allows exactly its own inline scripts
        // and styles by sha256 hash. Written as a route rule header, which Nitro applies to the static file;
        // the server bundle is built after prerendering, so the rule is part of it.
        'prerender:generate'(route, nitroBuild) {
          if (route.error || !route.contents || !route.contentType?.includes('text/html')) return
          const rule = nitroBuild.options.routeRules[route.route]
          nitroBuild.options.routeRules[route.route] = {
            ...rule,
            headers: { ...rule?.headers, ...documentHeaders(inlineSourceHashes(route.contents)) },
          }
        },
        // What this build was made from, so the test runners refuse a stale .output (scripts/build-freshness.ts).
        compiled(nitroBuild) {
          if (!nitroBuild.options.dev) writeBuildStamp(nitroBuild.options.rootDir)
        },
      },
      // Build-time .br/.gz copies of static assets, served by Nitro when the client accepts them.
      compressPublicAssets: { brotli: true, gzip: true },
    }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
})
