// Container images the CI scripts run, pinned by digest (tag kept for humans). compose.yaml,
// .github/workflows/ci.yml and the Dockerfile repeat some of them; `pnpm ci:workflows` fails when a copy
// differs from this file.
// Update a pin: `docker buildx imagetools inspect <name>:<tag>` prints the index digest.
import { spawnSync } from 'node:child_process'

export const IMAGES = {
  /** Same version as @playwright/test in package.json (browsers match the installed library). */
  playwright:
    'mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27',
  /**
   * Same version as .node-version; its Node replaces the Playwright image's in the ci:local runner. Also the base
   * of the Dockerfile.
   */
  node: 'node:26.8.1-slim@sha256:c0753125a3789977aefe869cbebccf70e3cfd7ea84ca48547458f02e4f1d7146',
  postgres: 'postgres:18.6@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722',
  caddy: 'caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b',
  /** The mail catcher verify:app sends account emails to (compose.yaml `mailpit`). */
  mailpit: 'axllent/mailpit:v1.31.2@sha256:74d609a42ec279aa63c6b4622a6fa9b5408d1ad5b1d76a1c4be40a265ce0863d',
  actionlint: 'rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667',
  zizmor: 'ghcr.io/zizmorcore/zizmor:1.30.1@sha256:a2eb396d886c053073405c7a980f2139ba2248ec172243cfa3841e57196e8101',
} as const

/**
 * Prefix for every container, network and volume the scripts create, so they are easy to find and never
 * collide with another checkout's (`docker ps --filter name=proofstack-ci`). Override with
 * PROOFSTACK_DOCKER_PREFIX.
 */
export const dockerPrefix = () => process.env.PROOFSTACK_DOCKER_PREFIX || 'proofstack-ci'

/**
 * Waits up to 30 s for the Postgres container `container` (IMAGES.postgres) to accept connections. -h forces
 * TCP: the image's init phase answers on the socket before the real server is up.
 */
export const waitForPostgres = async (container: string) => {
  for (let i = 0; i < 60; i++) {
    const ready = spawnSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'proofstack'], {
      stdio: 'ignore',
    })
    if (ready.status === 0) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('Postgres did not become ready in 30 s')
}
