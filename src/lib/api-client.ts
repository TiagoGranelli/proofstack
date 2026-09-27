import { createIsomorphicFn } from '@tanstack/react-start'
import { client as browserClient } from '#/sdk/client.gen.ts'
import { createInProcessApiClient } from '#/server/api/in-process-client.ts'

if (typeof window !== 'undefined') {
  browserClient.setConfig({ baseUrl: window.location.origin, credentials: 'same-origin' })
}

/** Generated SDK client: in-process dispatch during SSR, same-origin fetch in the browser. */
export const apiClient = createIsomorphicFn()
  .server(() => createInProcessApiClient())
  .client(() => browserClient)
