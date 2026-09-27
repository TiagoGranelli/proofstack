// The shutdown steps (src/server/lifecycle.ts): one at a time, in a fixed order whatever the registration order,
// so the Postgres pool never closes under a background task that still queries it.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { onShutdown, runShutdown } from '#/server/lifecycle.ts'

const logged = () => {
  const lines: Array<Record<string, unknown>> = []
  const capture = (chunk: string | Uint8Array) => {
    lines.push(JSON.parse(String(chunk)) as Record<string, unknown>)
    return true
  }
  vi.spyOn(process.stdout, 'write').mockImplementation(capture)
  vi.spyOn(process.stderr, 'write').mockImplementation(capture)
  return lines
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runShutdown', () => {
  it('runs the steps one after another in their fixed order and logs that order', async () => {
    const lines = logged()
    const events: string[] = []
    const step = (name: string, ms: number) => async () => {
      events.push(`${name} start`)
      await new Promise((resolve) => setTimeout(resolve, ms))
      events.push(`${name} end`)
    }
    // Registered in the order the modules happen to load, not the order they must close in.
    onShutdown('postgres-pool', step('postgres-pool', 0))
    onShutdown('effect-api', step('effect-api', 0))
    onShutdown('mailer', step('mailer', 5))
    onShutdown('background-tasks', step('background-tasks', 10))
    onShutdown('auth-cleanup', step('auth-cleanup', 0))

    await runShutdown()

    expect(events).toEqual([
      'auth-cleanup start',
      'auth-cleanup end',
      'background-tasks start',
      'background-tasks end',
      'mailer start',
      'mailer end',
      'effect-api start',
      'effect-api end',
      'postgres-pool start',
      'postgres-pool end',
    ])
    expect(lines.at(-1)).toMatchObject({
      msg: 'shutdown complete',
      cleanups: ['auth-cleanup', 'background-tasks', 'mailer', 'effect-api', 'postgres-pool'],
    })
  })

  it('logs a failed step and still runs the later ones, once', async () => {
    const lines = logged()
    const pool = vi.fn<() => void>()
    onShutdown('mailer', () => {
      throw new Error('smtp gone')
    })
    onShutdown('postgres-pool', pool)

    await runShutdown()
    await runShutdown()

    expect(pool).toHaveBeenCalledOnce()
    expect(lines[0]).toMatchObject({ level: 'error', msg: 'shutdown cleanup failed', cleanup: 'mailer' })
    expect(lines[1]).toMatchObject({ msg: 'shutdown complete', cleanups: ['mailer', 'postgres-pool'] })
    expect(lines[2]).toMatchObject({ msg: 'shutdown complete', cleanups: [] })
  })
})
