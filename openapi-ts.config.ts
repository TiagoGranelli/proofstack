import { defineConfig } from '@hey-api/openapi-ts'

// openapi.json is generated from src/contract by `pnpm openapi:generate`; both are committed.
export default defineConfig({
  input: './openapi.json',
  output: { path: './src/sdk', clean: true },
  // An operation with a query parameter named `cursor` is paginated: the TanStack Query plugin gives it
  // `*InfiniteOptions` that pass each page param as `query.cursor`. Only `cursor`, so a future `page` or
  // `offset` parameter does not silently become an infinite query too.
  parser: { pagination: { keywords: ['cursor'] } },
  plugins: [
    '@hey-api/client-fetch',
    '@hey-api/typescript',
    '@hey-api/sdk',
    { name: '@tanstack/react-query', infiniteQueryOptions: true, infiniteQueryKeys: true },
  ],
})
