// Container images the CI scripts run, pinned by digest (tag kept for humans). .github/compose.ci.yaml repeats the
// Playwright one; `pnpm ci:workflows` fails when a copy differs from this file (scripts/image-pins.ts). Renovate
// updates the pins here (a regex manager in .github/renovate.json) and every copy in the same PR. By hand,
// `docker buildx imagetools inspect <name>:<tag>` prints the index digest.
import { readFileSync } from 'node:fs'

export const IMAGES = {
  /** Same version as @playwright/test in package.json (browsers match the installed library): the ci:local runner. */
  playwright:
    'mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27',
  actionlint: 'rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667',
  zizmor: 'ghcr.io/zizmorcore/zizmor:1.30.1@sha256:a2eb396d886c053073405c7a980f2139ba2248ec172243cfa3841e57196e8101',
  /** Secret scan over the git history (`pnpm ci:secrets`, .config/gitleaks.toml). */
  gitleaks: 'ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f',
} as const

/** The package name (package.json), which names the CI's Docker artifacts. */
const packageName = (): string => (JSON.parse(readFileSync('package.json', 'utf8')) as { name: string }).name

/**
 * Prefix for every container, network and volume the scripts create, so they are easy to find and never
 * collide with another project's (`docker ps --filter name=<package name>-ci`). Override with CI_DOCKER_PREFIX.
 */
export const dockerPrefix = (): string => process.env.CI_DOCKER_PREFIX || `${packageName()}-ci`
