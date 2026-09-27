// Named fakes for the process a server module runs in: what `log` (src/server/log.ts) writes, and the environment
// `src/server/env.ts` reads at import. Each undoes itself when the test that called it finishes.
import { onTestFinished, vi } from 'vitest'

type LogLine = Record<string, unknown>

/**
 * Captures stdout and stderr for the rest of the test and returns the lines `log` writes there, parsed, in order.
 * Nothing reaches the terminal meanwhile.
 */
export const captureLog = (): LogLine[] => {
  const lines: LogLine[] = []
  const capture = (chunk: string | Uint8Array) => {
    lines.push(JSON.parse(String(chunk)) as LogLine)
    return true
  }
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(capture)
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(capture)
  onTestFinished(() => {
    stdout.mockRestore()
    stderr.mockRestore()
  })
  return lines
}

/** Sets each variable of `values` for the rest of the test; `undefined` unsets it. */
export const stubEnvironment = (values: Record<string, string | undefined>): void => {
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value)
  onTestFinished(() => {
    vi.unstubAllEnvs()
  })
}
