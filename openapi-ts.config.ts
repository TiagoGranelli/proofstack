import { defineConfig } from '@hey-api/openapi-ts'

// openapi.json is generated from src/contract by `pnpm openapi:generate`; both are committed.
export default defineConfig({
  input: './openapi.json',
  output: { path: './src/sdk', clean: true },
  plugins: ['@hey-api/client-fetch', '@hey-api/typescript', '@hey-api/sdk', '@tanstack/react-query', 'msw'],
})
