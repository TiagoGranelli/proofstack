// How the scripts start pnpm, npm and the tools in node_modules/.bin on every platform, without a shell where
// possible. On Windows these are `.cmd` shims, which Node refuses to start without a shell since the fix for
// CVE-2024-27980 (spawn EINVAL), and a shell would parse the arguments.
// - pnpm: when pnpm runs the script (`pnpm check`), npm_execpath names pnpm itself (a native binary since pnpm
//   11, or a JavaScript file run by node): started directly, no shell on any platform. Otherwise `pnpm` on
//   PATH, which is a shim on Windows.
// - A tool from node_modules/.bin: its path on Linux and macOS; `pnpm exec <tool>` on Windows.
// - A shim that needs cmd.exe gets `shell: true` and every argument in double quotes; an argument cmd.exe
//   could still read as syntax (`"`, `%`, a line break, a trailing backslash) is refused instead.
import {
  spawnSync,
  type SpawnSyncOptions,
  type SpawnSyncOptionsWithStringEncoding,
  type SpawnSyncReturns,
} from 'node:child_process'
import { win32 } from 'node:path'

export type Invocation = { command: string; args: string[]; shell: boolean }
type Host = { platform: NodeJS.Platform; env: NodeJS.ProcessEnv; execPath: string }
const HOST: Host = { platform: process.platform, env: process.env, execPath: process.execPath }

/** The arguments for cmd.exe, each quoted; throws on one it could still expand or split. */
export const cmdArgs = (args: string[]) =>
  args.map((arg) => {
    if (/["%\r\n]|\\$/.test(arg))
      throw new Error(`cannot pass ${JSON.stringify(arg)} through cmd.exe safely; run the command on Linux or macOS`)
    return `"${arg}"`
  })

/** A command that is a `.cmd` shim on Windows (`npm`, `pnpm` from PATH). */
const shim = (name: string, args: string[], host: Host): Invocation =>
  host.platform === 'win32'
    ? { command: `${name}.cmd`, args: cmdArgs(args), shell: true }
    : { command: name, args, shell: false }

export const pnpmInvocation = (args: string[], host: Host = HOST): Invocation => {
  const self = host.env.npm_execpath
  // win32.basename splits at both / and \.
  if (self && /^pnpm/i.test(win32.basename(self)))
    return /\.[cm]?js$/.test(self)
      ? { command: host.execPath, args: [self, ...args], shell: false }
      : { command: self, args, shell: false }
  return shim('pnpm', args, host)
}

export const npmInvocation = (args: string[], host: Host = HOST): Invocation => shim('npm', args, host)

/** A tool installed in node_modules/.bin (`oxlint`, `fallow`, ...). */
export const binInvocation = (name: string, args: string[], host: Host = HOST): Invocation =>
  host.platform === 'win32'
    ? pnpmInvocation(['exec', name, ...args], host)
    : { command: `node_modules/.bin/${name}`, args, shell: false }

export function runSync(invocation: Invocation, options: SpawnSyncOptionsWithStringEncoding): SpawnSyncReturns<string>
export function runSync(invocation: Invocation, options?: SpawnSyncOptions): SpawnSyncReturns<Buffer | string>
export function runSync(invocation: Invocation, options: SpawnSyncOptions = {}) {
  return spawnSync(invocation.command, invocation.args, { ...options, shell: invocation.shell })
}
