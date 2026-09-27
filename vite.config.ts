import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'

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
        if (log.code === 'MODULE_LEVEL_DIRECTIVE' && /use client/.test(log.message)) return
        handler(level, log)
      },
    },
  },
  plugins: [
    tailwindcss(),
    // Inline the route CSS (~6 KB brotli) into the HTML: no render-blocking stylesheet request.
    // Experimental in Start; needs the side-effect `import '#/styles/app.css'` in __root.tsx.
    tanstackStart({ server: { build: { inlineCss: true } } }),
    nitro({
      // startup: validates env before listening. http: security headers, CSP and request logs for
      // every response, static files included.
      plugins: ['./src/server/nitro/startup.ts', './src/server/nitro/http.ts'],
      // Start's own prerender output is not served by Nitro yet (TanStack/router#7473),
      // so finite static pages are prerendered by Nitro instead.
      // failOnError: a page that cannot be prerendered (e.g. missing env) fails the build instead of
      // silently shipping without its static copy.
      prerender: { routes: ['/about'], crawlLinks: false, failOnError: true },
      // Build-time .br/.gz copies of static assets, served by Nitro when the client accepts them.
      compressPublicAssets: { brotli: true, gzip: true },
    }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
})
