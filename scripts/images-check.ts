// Container image freshness report, never a gate (like `pnpm deps:check`): for every pin in scripts/images.ts,
// whether its tag now points at another digest (a rebuilt base image, usually with OS security fixes), and
// the newest tag of the same form in the same major line and overall. Reads the registries' HTTP API
// anonymously (Docker Hub, ghcr.io, mcr.microsoft.com); no Docker needed. Exits 1 only when a copy in
// compose.yaml, ci.yml or the Dockerfile differs from scripts/images.ts.
// Dependabot does not update these pins: scripts/images.ts is the single source, and Dependabot's docker and
// docker-compose ecosystems would change only the Dockerfile and compose.yaml copies. To move a pin, edit
// scripts/images.ts, then `pnpm images:sync` rewrites the copies.
// Usage: pnpm images:check          (needs the registries)
//        pnpm images:sync           (rewrites the copies, offline)
import { pinProblems, syncPins } from './image-pins.ts'
import { IMAGES } from './images.ts'

if (process.argv.includes('--sync')) {
  const changed = syncPins()
  console.log(changed.length ? `updated ${changed.join(', ')}` : 'every copy already matches scripts/images.ts')
  process.exit(0)
}

const MANIFEST_TYPES = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ')

/** `name:tag@sha256:...` split into registry host, repository, tag and digest. */
const parse = (ref: string) => {
  const [nameAndTag = '', digest = ''] = ref.split('@')
  const colon = nameAndTag.lastIndexOf(':')
  const [name, tag] = [nameAndTag.slice(0, colon), nameAndTag.slice(colon + 1)]
  const first = name.split('/')[0] ?? ''
  const hosted = name.includes('/') && (first.includes('.') || first.includes(':'))
  const host = hosted ? first : 'registry-1.docker.io'
  const path = hosted ? name.slice(first.length + 1) : name.includes('/') ? name : `library/${name}`
  return { host, path, tag, digest }
}

/** GET or HEAD against a registry, answering its bearer-token challenge once (anonymous pull scope). */
const registry = async (url: string, init: RequestInit = {}) => {
  const first = await fetch(url, init)
  if (first.status !== 401) return first
  const challenge = first.headers.get('www-authenticate') ?? ''
  const field = (key: string) => new RegExp(`${key}="([^"]*)"`).exec(challenge)?.[1]
  const realm = field('realm')
  if (!realm) return first
  const tokenUrl = new URL(realm)
  for (const key of ['service', 'scope']) {
    const value = field(key)
    if (value) tokenUrl.searchParams.set(key, value)
  }
  const { token, access_token } = (await (await fetch(tokenUrl)).json()) as { token?: string; access_token?: string }
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${token ?? access_token}`)
  return fetch(url, { ...init, headers })
}

const tags = async (host: string, path: string) => {
  const all: string[] = []
  let url: string | undefined = `https://${host}/v2/${path}/tags/list?n=1000`
  while (url) {
    const response = await registry(url)
    if (!response.ok) throw new Error(`tags/list: HTTP ${response.status}`)
    all.push(...(((await response.json()) as { tags?: string[] }).tags ?? []))
    const next = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get('link') ?? '')?.[1]
    url = next ? new URL(next, `https://${host}`).toString() : undefined
  }
  return all
}

/** A tag's form: `v1.63.0-noble` is prefix `v`, numbers [1, 63, 0] and suffix `-noble`. */
const shape = (tag: string) => {
  const match = /^([a-z]*)(\d+(?:\.\d+)*)(.*)$/i.exec(tag)
  return match ? { prefix: match[1], numbers: match[2]!.split('.').map(Number), suffix: match[3] } : undefined
}
const compare = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0)
  return 0
}

const rows: string[][] = []
const notes: string[] = []
for (const [key, ref] of Object.entries(IMAGES)) {
  const { host, path, tag, digest } = parse(ref)
  const pinned = shape(tag)
  let tagDigest = '?'
  let inMajor = '?'
  let newest = '?'
  try {
    const head = await registry(`https://${host}/v2/${path}/manifests/${tag}`, {
      method: 'HEAD',
      headers: { accept: MANIFEST_TYPES },
    })
    const current = head.headers.get('docker-content-digest')
    tagDigest = !current ? `? (HTTP ${head.status})` : current === digest ? 'same' : `moved: ${current.slice(0, 19)}…`
    if (pinned) {
      const sameForm = (await tags(host, path))
        .map((candidate) => ({ candidate, form: shape(candidate) }))
        .filter(
          ({ form }) =>
            form &&
            form.prefix === pinned.prefix &&
            form.suffix === pinned.suffix &&
            form.numbers.length === pinned.numbers.length &&
            compare(form.numbers, pinned.numbers) > 0,
        )
        .toSorted((a, b) => compare(b.form!.numbers, a.form!.numbers))
      newest = sameForm[0]?.candidate ?? 'up to date'
      inMajor =
        sameForm.find(({ form }) => form!.numbers[0] === pinned.numbers[0])?.candidate ??
        (sameForm.length ? 'none' : 'up to date')
    }
  } catch (error) {
    notes.push(`${key}: ${error instanceof Error ? error.message : String(error)}`)
  }
  rows.push([key, tag, tagDigest, inMajor, newest])
}

const header = ['Image', 'Pinned tag', 'Tag digest', 'Newer, same major', 'Newest']
const widths = header.map((cell, i) => Math.max(cell.length, ...rows.map((row) => row[i]!.length)))
const line = (row: string[]) =>
  row
    .map((cell, i) => cell.padEnd(widths[i]!))
    .join('  ')
    .trimEnd()
console.log([line(header), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n'))
if (notes.length) console.log(`\nIncomplete (not a failure):\n${notes.map((n) => `  ${n}`).join('\n')}`)
console.log(
  '\nReport only. A moved tag digest is a rebuild of the same version (usually OS security fixes). To move a ' +
    'pin, edit scripts/images.ts (`docker buildx imagetools inspect <name>:<tag>` prints the digest), run ' +
    '`pnpm images:sync`, and keep versions that must match in step (node with .node-version, playwright with ' +
    '@playwright/test).',
)

const problems = pinProblems()
if (problems.length) {
  console.error(`\nCopies that differ from scripts/images.ts (run \`pnpm images:sync\`):\n  ${problems.join('\n  ')}`)
  process.exitCode = 1
}
