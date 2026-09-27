// Stands in for #/lib/api-client.ts in the `component` Vitest project (resolve.alias in vitest.config.ts).
// The real module is isomorphic: Start's compiler removes its server branch (the in-process Effect handler,
// which needs the database) from client bundles, and Vitest does not run that compiler. This is the client
// branch as it runs in the browser: same-origin fetch, answered by the MSW worker.
import { client } from '#/sdk/client.gen.ts'

client.setConfig({ baseUrl: window.location.origin, credentials: 'same-origin' })

export const apiClient = () => client
