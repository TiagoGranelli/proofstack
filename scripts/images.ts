// Container images the CI scripts run, pinned by digest (tag kept for humans). The compose files, the workflows in
// .github/workflows and the Dockerfiles repeat some of them; `pnpm ci:workflows` fails when a copy
// differs from this file (scripts/image-pins.ts). Renovate updates the pins here (a regex manager in
// .github/renovate.json) and every copy in the same PR. By hand, `docker buildx imagetools inspect <name>:<tag>`
// prints the index digest.
import { readFileSync } from 'node:fs'

export const IMAGES = {
  /** Same version as @playwright/test in package.json (browsers match the installed library): the ci:local runner. */
  playwright:
    'mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27',
  /**
   * Same version as devEngines.runtime in package.json (Renovate's `node` group moves both): the base of the
   * Dockerfile and the Node of the eval image (.agents/evals/Dockerfile).
   */
  node: 'node:26.10.0-slim@sha256:ec7758ee051e457b468b32bde57b0879010b325bb9862718e9615225ce4aaae1',
  postgres: 'postgres:18.6@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722',
  caddy: 'caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b',
  /** The mail catcher the test servers send account emails to (compose.yaml `mailpit`). */
  mailpit: 'axllent/mailpit:v1.31.3@sha256:ed9b00c609e77e99c79b93f1178255ebc271868920f2c69a8d166bd5634ed10d',
  actionlint: 'rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667',
  zizmor: 'ghcr.io/zizmorcore/zizmor:1.30.1@sha256:a2eb396d886c053073405c7a980f2139ba2248ec172243cfa3841e57196e8101',
  /** Vulnerability scan of the production image in `pnpm ci:docker` (.config/grype.yaml). */
  grype: 'anchore/grype:v0.119.0@sha256:8c2c9234a345577a6d321a4753aa3ee1276d8975c8452d2344a56b57733ecad3',
  /** Validates deploy/kubernetes.yaml against the Kubernetes schemas in `pnpm ci:workflows`. */
  kubeconform:
    'ghcr.io/yannh/kubeconform:v0.8.0@sha256:faffaf43f95aa6425306e1ab8d6fcad72acb9049158f38e574c085ea1ec0f64e',
  /** Secret scan over the git history (`pnpm ci:secrets`, .config/gitleaks.toml). */
  gitleaks: 'ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f',
} as const

/** The package name (package.json), which names the app's Docker artifacts. */
export const packageName = (): string => (JSON.parse(readFileSync('package.json', 'utf8')) as { name: string }).name

/**
 * Prefix for every container, network and volume the scripts create, so they are easy to find and never
 * collide with another project's (`docker ps --filter name=<package name>-ci`). Override with CI_DOCKER_PREFIX.
 */
export const dockerPrefix = (): string => process.env.CI_DOCKER_PREFIX || `${packageName()}-ci`
