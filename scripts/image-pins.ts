// The copies of scripts/images.ts pins in files that cannot import it. `pnpm ci:workflows` fails when a copy
// differs (pinProblems); `pnpm images:sync` rewrites every copy from scripts/images.ts (syncPins).
import { readFileSync, writeFileSync } from 'node:fs'
import { IMAGES } from './images.ts'

const PINNED_COPIES = ['compose.yaml', 'deploy/compose.production.yaml', '.github/workflows/ci.yml', 'Dockerfile']

/** Each pinned reference with a pattern for `<name>:<tag>[@sha256:...]` of the same image. */
const PATTERNS = Object.values(IMAGES).map((ref) => {
  const name = ref.slice(0, ref.lastIndexOf(':', ref.indexOf('@')))
  const escaped = name.replaceAll(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  return { ref, pattern: new RegExp(`(?<![\\w./-])${escaped}:[\\w.-]+(@sha256:[0-9a-f]{64})?`, 'g') }
})

export const pinProblems = () =>
  PINNED_COPIES.flatMap((file) => {
    const text = readFileSync(file, 'utf8')
    return PATTERNS.flatMap(({ ref, pattern }) =>
      [...text.matchAll(pattern)]
        .filter((match) => match[0] !== ref)
        .map((match) => `${file}: ${match[0]} (scripts/images.ts has ${ref})`),
    )
  })

/** Rewrites every stale copy; returns the files it changed. */
export const syncPins = () =>
  PINNED_COPIES.filter((file) => {
    const text = readFileSync(file, 'utf8')
    const synced = PATTERNS.reduce((current, { ref, pattern }) => current.replaceAll(pattern, ref), text)
    if (synced === text) return false
    writeFileSync(file, synced)
    return true
  })
