import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Vite builds and serves the demo app; the gates do not depend on it. The router plugin writes src/routeTree.gen.ts
// from the files in src/routes and splits each route into its own chunk; it must come before the React plugin. The
// React Compiler runs through the stable Babel preset (ADR 0006), so components are memoized without useMemo or
// useCallback written by hand.
export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    tailwindcss(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
})
