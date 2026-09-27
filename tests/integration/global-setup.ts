// Vitest global setup of the `integration` project: starts the built app's two servers on a fresh database
// (startTestServers, scripts/test-servers.ts) and hands them to the tests (`inject('servers')`). The teardown stops
// them and drops the database; Vitest skips it on Ctrl-C, and the next run's sweep drops what is left.
import type { TestProject } from 'vitest/node'
import { startTestServers, type TestServers } from '../../scripts/test-servers.ts'

declare module 'vitest' {
  export interface ProvidedContext {
    servers: TestServers
  }
}

export default async function setup(project: TestProject) {
  const { servers, stop } = await startTestServers('integration')
  project.provide('servers', servers)
  return stop
}
