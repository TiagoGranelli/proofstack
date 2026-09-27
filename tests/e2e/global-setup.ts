// Playwright global setup: starts the built app's two servers on a fresh database (startTestServers,
// scripts/test-servers.ts) and returns the teardown that stops them and drops the database. The environment set
// here reaches the workers, which load playwright.config.ts again (its baseURL reads APP_URL) and create their
// authors with scripts/create-user.ts on the app's database (tests/e2e/support/app.ts).
// Not Playwright's `webServer`: it starts before this setup, needs a fixed port (parallel runs in several
// worktrees would collide) and can silently reuse a stale server.
import { startTestServers } from '../../scripts/test-servers.ts'

export default async function globalSetup() {
  const { servers, stop } = await startTestServers('e2e')
  Object.assign(process.env, servers.env, {
    CLOSED_APP_URL: servers.closedAppUrl,
    MAILPIT_URL: servers.mailpitUrl,
  })
  return stop
}
