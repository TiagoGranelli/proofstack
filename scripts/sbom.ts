// Software bills of materials for a release, CycloneDX JSON in sbom/ (not a gate; attach them to the release):
//   sbom/proofstack-npm.cdx.json    the production npm dependencies from the lockfile (`pnpm sbom --prod`)
//   sbom/proofstack-image.cdx.json  everything in the production image, OS packages included (syft, pinned by
//                                   digest in scripts/images.ts, offline, from a `docker save` archive)
// Usage: pnpm sbom:release [--image=<ref>] [--no-image]
//   --image=<ref>  describe that local image; default: build the Dockerfile as <prefix>-app:sbom and remove it
//   --no-image     only the npm SBOM (no Docker)
// (`pnpm sbom` is pnpm's own command, hence the name.)
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { xSync } from 'tinyexec'
import { dockerPrefix, IMAGES } from './images.ts'

const OUT = resolve('sbom')
const version = spawnSync('git', ['describe', '--always', '--dirty'], { encoding: 'utf8' }).stdout.trim()
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)

const fail = (message: string): never => {
  console.error(`sbom: ${message}`)
  process.exit(1)
}
const docker = (args: string[]) => {
  const result = spawnSync('docker', args, { stdio: ['ignore', 'inherit', 'inherit'] })
  if (result.status !== 0) fail(`docker ${args.slice(0, 2).join(' ')} failed (${result.status ?? result.signal})`)
}

mkdirSync(OUT, { recursive: true })
const npm = xSync(
  'pnpm',
  ['sbom', '--sbom-format', 'cyclonedx', '--sbom-type', 'application', '--prod', '--lockfile-only'],
  { nodeOptions: { maxBuffer: 256 * 1024 * 1024 } },
)
if (npm.exitCode !== 0) fail(`pnpm sbom failed:\n${npm.stderr}`)
writeFileSync(join(OUT, 'proofstack-npm.cdx.json'), npm.stdout)
console.log(`wrote sbom/proofstack-npm.cdx.json (${version})`)

if (!process.argv.includes('--no-image')) {
  const requested = option('image')
  const built = requested ? undefined : `${dockerPrefix()}-app:sbom`
  const image = requested ?? `${dockerPrefix()}-app:sbom`
  const dir = mkdtempSync(join(tmpdir(), 'proofstack-sbom-'))
  try {
    if (built) docker(['build', '--tag', built, '.'])
    docker(['save', '--output', join(dir, 'image.tar'), image])
    docker(
      ['run', '--rm', '--network', 'none', '--memory', '2g', '--volume', `${dir}:/scan`, IMAGES.syft]
        .concat(['docker-archive:/scan/image.tar', '--source-name', 'proofstack', '--source-version', version])
        .concat(['--output', 'cyclonedx-json=/scan/image.cdx.json', '--quiet']),
    )
    copyFileSync(join(dir, 'image.cdx.json'), join(OUT, 'proofstack-image.cdx.json'))
    console.log(`wrote sbom/proofstack-image.cdx.json (${image})`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    if (built) spawnSync('docker', ['image', 'rm', built], { stdio: 'ignore' })
  }
}
