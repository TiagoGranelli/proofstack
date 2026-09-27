// Setup for every component test file: the MSW worker intercepts the app's requests, handlers are reset
// after each test, and a request to /api that no handler answered fails the test (instead of reaching the
// Vitest server and failing somewhere less obvious).
import { afterAll, afterEach, beforeAll, expect } from 'vitest'
import { worker } from './api-mocks.ts'

const unhandled: string[] = []

beforeAll(async () => {
  await worker.start({
    quiet: true,
    // Vitest's own module requests pass through the worker too; only the app's API calls must be mocked.
    onUnhandledRequest: (request) => {
      const url = new URL(request.url)
      if (url.pathname.startsWith('/api/')) unhandled.push(`${request.method} ${url.pathname}`)
    },
  })
})

afterEach(() => {
  worker.resetHandlers()
  const missing = unhandled.splice(0)
  expect(missing, 'requests without an MSW handler (add one with worker.use)').toEqual([])
})

afterAll(() => worker.stop())
