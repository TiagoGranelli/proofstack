// Fetches a filtered, read-only snapshot of an upstream repository into repos/<name>/ and records
// its provenance in repos/<name>/UPSTREAM.md. Streams the GitHub tarball (never clones), keeps only
// the listed subpaths plus the root license, and aborts past the size caps.
//
// Usage:
//   node scripts/vendor-source.ts <preset>                     ref derived from the installed package version
//   node scripts/vendor-source.ts <preset> --ref <tag|sha>     explicit ref, preset paths
//   node scripts/vendor-source.ts <name> --repo <owner/repo> --ref <tag|sha> --path <subpath> [--path ...]
// Options: --max-download-mb <n> (default 200), --max-extract-mb <n> (default 30)
// Presets: effect, tanstack-start, better-auth, hey-api. Requires an authenticated `gh` CLI.
// See docs/agents/dependency-sources.md for when to use this and why repos/ is not committed.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { parseArgs } from 'node:util'
import { createGunzip } from 'node:zlib'

interface Preset {
  readonly repo: string
  /** Installed package whose version selects the upstream tag, so the snapshot matches the lockfile. */
  readonly pkg: string
  readonly tag: (version: string) => string
  readonly paths: ReadonlyArray<string>
}

const PRESETS: Record<string, Preset> = {
  // node_modules/effect already ships src/, AGENTS.md and ai-docs/; upstream tests are the missing usage examples.
  effect: {
    repo: 'Effect-TS/effect',
    pkg: 'effect',
    tag: (v) => `effect@${v}`,
    paths: [
      'packages/effect/test/unstable/httpapi',
      'packages/effect/test/unstable/http',
      'packages/effect/test/schema',
    ],
  },
  // Start/Router packages ship src/ and skills/; the prose docs are not published to npm.
  'tanstack-start': {
    repo: 'TanStack/router',
    pkg: '@tanstack/react-start',
    tag: (v) => `@tanstack/react-start@${v}`,
    paths: ['docs/start/framework/react', 'docs/router/guide', 'docs/router/routing', 'docs/router/api'],
  },
  // better-auth ships only dist/; docs explain options and plugin behavior.
  'better-auth': {
    repo: 'better-auth/better-auth',
    pkg: 'better-auth',
    tag: (v) => `v${v}`,
    paths: ['docs/content/docs'],
  },
  // @hey-api/openapi-ts ships only dist/; plugin sources document the generated SDK shape.
  'hey-api': {
    repo: 'hey-api/openapi-ts',
    pkg: '@hey-api/openapi-ts',
    tag: (v) => `@hey-api/openapi-ts@${v}`,
    paths: ['packages/openapi-ts/src', 'examples/openapi-ts-tanstack-react-query'],
  },
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    repo: { type: 'string' },
    ref: { type: 'string' },
    path: { type: 'string', multiple: true },
    'max-download-mb': { type: 'string', default: '200' },
    'max-extract-mb': { type: 'string', default: '30' },
  },
})

const fail = (message: string): never => {
  console.error(`vendor-source: ${message}`)
  process.exit(1)
}
/** Inside the download pipeline: throw so the staging directory is cleaned up. */
const abort = (message: string): never => {
  throw new Error(message)
}

const name = positionals[0] ?? fail(`missing <name>. Presets: ${Object.keys(PRESETS).join(', ')}`)
if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) fail(`invalid name "${name}"`)
const preset = PRESETS[name]

const installedVersion = (pkg: string) => {
  const manifest = join('node_modules', pkg, 'package.json')
  if (!existsSync(manifest)) return fail(`${pkg} is not installed; run pnpm install or pass --ref`)
  return (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version
}

const repo = values.repo ?? preset?.repo ?? fail('--repo <owner/repo> is required without a preset')
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) fail(`invalid repo "${repo}"`)
const ref =
  values.ref ?? (preset ? preset.tag(installedVersion(preset.pkg)) : fail('--ref is required without a preset'))
const paths = (values.path ?? preset?.paths ?? fail('--path is required without a preset')).map((p) =>
  posix.normalize(p).replaceAll(/^\/+|\/+$/g, ''),
)
if (paths.length === 0 || paths.some((p) => p === '.' || p.startsWith('..'))) fail('paths must be repository subpaths')
const maxDownload = Number(values['max-download-mb']) * 1024 * 1024
const maxExtract = Number(values['max-extract-mb']) * 1024 * 1024

const gh = (args: ReadonlyArray<string>) => {
  const result = spawnSync('gh', args, { encoding: 'utf8' })
  if (result.error) fail(`gh is required: ${result.error.message}`)
  if (result.status !== 0) fail(`gh ${args.join(' ')} failed: ${result.stderr.trim()}`)
  return result.stdout.trim()
}

const sha = gh(['api', `repos/${repo}/commits/${encodeURIComponent(ref)}`, '--jq', '.sha'])
const license = gh(['api', `repos/${repo}`, '--jq', '.license.spdx_id // "NONE"'])
if (license === 'NONE' || license === 'NOASSERTION') {
  console.warn(`vendor-source: ${repo} declares no recognized license; keep the snapshot local and do not commit it`)
}

// Minimal streaming reader for the ustar/pax archives produced by `git archive` (GitHub tarballs).
class ByteReader {
  private chunks: Buffer[] = []
  private length = 0
  private readonly source: AsyncIterator<Buffer>
  constructor(source: AsyncIterator<Buffer>) {
    this.source = source
  }

  private async fill(n: number) {
    while (this.length < n) {
      const next = await this.source.next()
      if (next.done) return false
      this.chunks.push(next.value)
      this.length += next.value.length
    }
    return true
  }

  async read(n: number) {
    if (!(await this.fill(n))) return undefined
    const [first] = this.chunks
    const all = first && this.chunks.length === 1 ? first : Buffer.concat(this.chunks)
    const rest = all.subarray(n)
    this.chunks = rest.length > 0 ? [rest] : []
    this.length = rest.length
    return all.subarray(0, n)
  }

  async skip(n: number) {
    let remaining = n
    while (remaining > 0) {
      if (this.length === 0 && !(await this.fill(1))) return
      const head = this.chunks.shift()
      if (!head) return
      if (head.length <= remaining) {
        remaining -= head.length
        this.length -= head.length
      } else {
        this.chunks.unshift(head.subarray(remaining))
        this.length -= remaining
        remaining = 0
      }
    }
  }
}

const field = (block: Buffer, start: number, length: number) => {
  const raw = block.subarray(start, start + length)
  const end = raw.indexOf(0)
  return raw.subarray(0, end === -1 ? length : end).toString('utf8')
}

const parsePax = (data: Buffer) => {
  const records = new Map<string, string>()
  let offset = 0
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset)
    const length = Number(data.subarray(offset, space).toString())
    if (!length) break
    const record = data.subarray(space + 1, offset + length - 1).toString('utf8')
    const eq = record.indexOf('=')
    records.set(record.slice(0, eq), record.slice(eq + 1))
    offset += length
  }
  return records
}

const isRootLicense = (path: string) => !path.includes('/') && /^(licen[cs]e|copying)(\.|$)/i.test(path)
const selected = (path: string) => isRootLicense(path) || paths.some((p) => path === p || path.startsWith(`${p}/`))

const reposDir = 'repos'
const target = join(reposDir, name)
const staging = join(reposDir, `.staging-${name}-${process.pid}`)
rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })

let downloaded = 0
let extracted = 0
let files = 0
let archiveCommit: string | undefined
const matched = new Set<string>()
const skippedLinks: string[] = []

const child = spawn('gh', ['api', `repos/${repo}/tarball/${sha}`], { stdio: ['ignore', 'pipe', 'inherit'] })
const childExit = new Promise<number | null>((resolve) => child.once('close', resolve))

const counter = new Transform({
  transform(chunk: Buffer, _encoding, callback) {
    downloaded += chunk.length
    if (downloaded > maxDownload)
      callback(new Error(`download exceeded --max-download-mb ${values['max-download-mb']}`))
    else callback(null, chunk)
  },
})

/** A tar header block (ustar, with pax records applied by the caller). */
const readHeader = (block: Buffer) => {
  const size = Number.parseInt(field(block, 124, 12).trim() || '0', 8)
  const fileName = field(block, 0, 100)
  const prefix = field(block, 345, 155)
  return {
    size,
    padded: Math.ceil(size / 512) * 512,
    type: String.fromCodePoint(block[156] ?? 0x30),
    path: prefix ? `${prefix}/${fileName}` : fileName,
  }
}
type TarEntry = ReturnType<typeof readHeader>

const readBody = async (reader: ByteReader, entry: TarEntry) =>
  (await reader.read(entry.padded))?.subarray(0, entry.size) ?? abort('truncated archive')

/** The entry's path in the repository, without the archive's top-level "<owner>-<repo>-<sha>/"; undefined if unsafe. */
const repositoryPath = (archivePath: string) => {
  const path = posix.normalize(archivePath.split('/').slice(1).join('/')).replace(/\/+$/, '')
  const safe = path !== '' && path !== '.' && !path.startsWith('..') && !posix.isAbsolute(path)
  return safe ? path : undefined
}

const isRegularFile = (type: string) => type === '0' || type === '\0'
const isLink = (type: string) => type === '1' || type === '2'

const writeFile = async (reader: ByteReader, entry: TarEntry, path: string) => {
  extracted += entry.size
  if (extracted > maxExtract) abort(`extracted size exceeded --max-extract-mb ${values['max-extract-mb']}`)
  const data = await readBody(reader, entry)
  const out = join(staging, path)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, data)
  files++
  for (const p of paths) if (path === p || path.startsWith(`${p}/`)) matched.add(p)
}

/** Writes a selected regular file; skips everything else, noting selected links (they are not extracted). */
const extractEntry = async (reader: ByteReader, entry: TarEntry, archivePath: string) => {
  const path = repositoryPath(archivePath)
  const wanted = path !== undefined && selected(path)
  if (wanted && isRegularFile(entry.type)) return writeFile(reader, entry, path)
  if (wanted && isLink(entry.type)) skippedLinks.push(path)
  return reader.skip(entry.padded)
}

/** A tar archive ends with zero-filled blocks. */
const isEndOfArchive = (block: Buffer) => block.every((b) => b === 0)

const extract = async (source: AsyncIterable<Buffer>) => {
  const reader = new ByteReader(source[Symbol.asyncIterator]())
  let pax = new Map<string, string>()
  for (let block = await reader.read(512); block && !isEndOfArchive(block); block = await reader.read(512)) {
    const entry = readHeader(block)
    // pax headers: 'g' (global) carries the commit id, 'x' overrides the next entry's fields.
    if (entry.type === 'g') archiveCommit = parsePax(await readBody(reader, entry)).get('comment')
    else if (entry.type === 'x') pax = parsePax(await readBody(reader, entry))
    else {
      await extractEntry(reader, entry, pax.get('path') ?? entry.path)
      pax = new Map()
    }
  }
}

try {
  await pipeline(child.stdout, counter, createGunzip(), extract)
  const code = await childExit
  if (code !== 0) abort(`gh tarball download exited with ${code}`)
  if (archiveCommit && archiveCommit !== sha) abort(`archive commit ${archiveCommit} does not match ${sha}`)
  const missing = paths.filter((p) => !matched.has(p))
  if (missing.length > 0) abort(`no files matched: ${missing.join(', ')}`)
} catch (error) {
  child.kill()
  rmSync(staging, { recursive: true, force: true })
  fail(error instanceof Error ? error.message : String(error))
}

const command = ['node scripts/vendor-source.ts', name]
if (!preset || values.repo) command.push('--repo', repo)
if (!preset || values.ref) command.push('--ref', ref)
if (!preset || values.path) for (const p of paths) command.push('--path', p)
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`

writeFileSync(
  join(staging, 'UPSTREAM.md'),
  `# ${name}: vendored upstream snapshot (read-only)

Reference material for coding agents. Do not edit, import, lint or build these files; regenerate instead.

| Field | Value |
| --- | --- |
| Repository | https://github.com/${repo} |
| Ref | \`${ref}\` |
| Commit | \`${sha}\`${archiveCommit ? ' (verified against the tarball header)' : ''} |
| License | ${license} (GitHub API, default branch); root license file copied when present |
| Paths | ${paths.map((p) => `\`${p}\``).join(', ')} |
| Contents | ${files} files, ${mb(extracted)} extracted from a ${mb(downloaded)} tarball |
| Fetched | ${new Date().toISOString()} |
| Command | \`${command.join(' ')}\` |
${skippedLinks.length > 0 ? `\nSkipped ${skippedLinks.length} symlinks/hardlinks: ${skippedLinks.map((p) => `\`${p}\``).join(', ')}\n` : ''}`,
)

rmSync(target, { recursive: true, force: true })
renameSync(staging, target)
console.log(
  `vendored ${repo} ${ref} (${sha.slice(0, 12)}) into ${target}: ${files} files, ${mb(extracted)} (downloaded ${mb(downloaded)})`,
)
