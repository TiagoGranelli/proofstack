// scripts/spawn.ts: how the scripts start pnpm, npm and node_modules/.bin tools on each platform, and which
// arguments may pass through cmd.exe when Windows needs a shell for a `.cmd` shim.
import { describe, expect, it } from 'vitest'
import { binInvocation, cmdArgs, npmInvocation, pnpmInvocation } from '../../scripts/spawn.ts'

const linux = { platform: 'linux', env: {}, execPath: '/usr/bin/node' } as const
const windows = { platform: 'win32', env: {}, execPath: 'C:\\node\\node.exe' } as const

describe('pnpmInvocation', () => {
  it('starts the pnpm that runs the script, without a shell, on every platform', () => {
    const native = { npm_execpath: 'C:\\pnpm\\pnpm.exe' }
    expect(pnpmInvocation(['run', 'x'], { ...windows, env: native })).toEqual({
      command: 'C:\\pnpm\\pnpm.exe',
      args: ['run', 'x'],
      shell: false,
    })
    const script = { npm_execpath: '/opt/pnpm/bin/pnpm.cjs' }
    expect(pnpmInvocation(['run', 'x'], { ...linux, env: script })).toEqual({
      command: '/usr/bin/node',
      args: ['/opt/pnpm/bin/pnpm.cjs', 'run', 'x'],
      shell: false,
    })
  })

  it('falls back to pnpm on PATH when another package manager or none runs the script', () => {
    expect(pnpmInvocation(['run', 'x'], { ...linux, env: { npm_execpath: '/usr/lib/npm/npm-cli.js' } })).toEqual({
      command: 'pnpm',
      args: ['run', 'x'],
      shell: false,
    })
    expect(pnpmInvocation(['exec', 'vitest', 'run'], windows)).toEqual({
      command: 'pnpm.cmd',
      args: ['"exec"', '"vitest"', '"run"'],
      shell: true,
    })
  })
})

describe('npmInvocation and binInvocation', () => {
  it('uses the shim through cmd.exe only on Windows', () => {
    expect(npmInvocation(['view', 'effect'], linux)).toEqual({ command: 'npm', args: ['view', 'effect'], shell: false })
    expect(npmInvocation(['view', 'effect'], windows)).toMatchObject({ command: 'npm.cmd', shell: true })
  })

  it('runs node_modules/.bin directly on Linux and macOS, through pnpm exec on Windows', () => {
    expect(binInvocation('oxlint', ['src'], linux)).toEqual({
      command: 'node_modules/.bin/oxlint',
      args: ['src'],
      shell: false,
    })
    expect(binInvocation('oxlint', ['src'], { ...windows, env: { npm_execpath: 'C:\\pnpm\\pnpm.exe' } })).toEqual({
      command: 'C:\\pnpm\\pnpm.exe',
      args: ['exec', 'oxlint', 'src'],
      shell: false,
    })
  })
})

describe('cmdArgs', () => {
  it('quotes every argument, so spaces and cmd.exe operators stay inside one argument', () => {
    expect(cmdArgs(['--flag=a b', 'x&y', 'a|b', '<in>', ''])).toEqual([
      '"--flag=a b"',
      '"x&y"',
      '"a|b"',
      '"<in>"',
      '""',
    ])
  })

  it.each(['say "hi"', '%PATH%', 'line\nbreak', 'C:\\dir\\'])(
    'refuses %j, which cmd.exe could still read as syntax',
    (arg) => {
      expect(() => cmdArgs([arg])).toThrow('cannot pass')
    },
  )
})
