// TanStack Form's core imports the devtools event client with no production guard (TanStack/form#2132). On the
// server, rendering a form started its connect loop, which kept the process alive for about 5 s after SIGTERM. The
// production build swaps it for a silent client (src/lib/no-devtools-event-client.ts, vite.config.ts): no copy of
// the real one may reach the browser or the server bundle. shutdown.test.ts checks the exit time itself.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

/** Event names only the real client dispatches: strings, so they survive minification. */
const DEVTOOLS_EVENT_CLIENT = /tanstack-connect-success|tanstack-dispatch-event/

const scriptsUnder = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.m?js$/.test(file))
    .map((file) => join(dir, file))

it('ships no devtools event client to the browser or in the server', () => {
  const scripts = [...scriptsUnder('.output/public'), ...scriptsUnder('.output/server')]
  expect(scripts.length).toBeGreaterThan(0)
  expect(scripts.filter((file) => DEVTOOLS_EVENT_CLIENT.test(readFileSync(file, 'utf8')))).toEqual([])
})
