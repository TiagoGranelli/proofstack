// The copies of scripts/images.ts pins in files that cannot import it. Renovate moves every copy of an image in
// one PR (same depName); `pnpm ci:workflows` fails when a hand edit leaves a copy behind.
import { readFileSync } from 'node:fs'
import { IMAGES } from './images.ts'

const PINNED_COPIES = [
  'compose.yaml',
  'deploy/compose.smoke.yaml',
  'deploy/compose.production.yaml',
  '.github/compose.ci.yaml',
  '.github/workflows/ci.yml',
  'Dockerfile',
  '.agents/evals/Dockerfile',
]

/** Each pinned reference with a pattern for `<name>:<tag>[@sha256:...]` of the same image. */
const PATTERNS = Object.values(IMAGES).map((ref) => {
  const name = ref.slice(0, ref.lastIndexOf(':', ref.indexOf('@')))
  const escaped = name.replaceAll(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  return { ref, pattern: new RegExp(`(?<![\\w./-])${escaped}:[\\w.-]+(@sha256:[0-9a-f]{64})?`, 'g') }
})

export const pinProblems = (): string[] =>
  PINNED_COPIES.flatMap((file) => {
    const text = readFileSync(file, 'utf8')
    return PATTERNS.flatMap(({ ref, pattern }) =>
      [...text.matchAll(pattern)]
        .filter((match) => match[0] !== ref)
        .map((match) => `${file}: ${match[0]} (scripts/images.ts has ${ref})`),
    )
  })
