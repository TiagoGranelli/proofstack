// The built Node server (.output/server/index.mjs) as a child process of the test runners and lighthouse
// (startApp, scripts/app-server.ts): started as the production image starts it, polled until ready, stopped the
// way an orchestrator stops it.
import type { ChildProcess } from 'node:child_process'
import { resolve as resolvePath } from 'node:path'
import { spawnToLog, tail } from './process-log.ts'

export type ServerExit = { code: number | null; signal: NodeJS.Signals | null }

export type ServerProcess = {
  child: ChildProcess
  /** SIGTERM, then waits for the exit (SIGKILL after 10 s). Resolves with how long the shutdown took. */
  stop: () => Promise<ServerExit & { ms: number }>
}

/**
 * The production image's flags (Dockerfile CMD, docs/decisions/0012-node-permission-model.md), so every test runs
 * the server under Node's permission model: it may read its bundle and use the network, nothing else.
 */
const SERVER_FLAGS = [
  '--permission',
  `--allow-fs-read=${resolvePath('.output')}`,
  '--allow-net',
  '--disable-warning=ExperimentalWarning',
]

const stopper = (child: ChildProcess): ServerProcess['stop'] => {
  const exited = new Promise<ServerExit>((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })))
  return async () => {
    const started = performance.now()
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      const killer = setTimeout(() => child.kill('SIGKILL'), 10_000)
      await exited
      clearTimeout(killer)
    }
    return { ms: Math.round(performance.now() - started), ...(await exited) }
  }
}

/** Starts the built server, logging to `logFile`. */
export const spawnServer = (env: NodeJS.ProcessEnv, logFile: string): ServerProcess => {
  // srvx skips its graceful shutdown (drain, then Nitro's close hook) when CI or TEST is set, and GitHub
  // Actions sets CI=true. The server runs as it would in production; the test runners keep both variables.
  const { CI: _ci, TEST: _test, ...serverEnv } = env
  const child = spawnToLog(process.execPath, [...SERVER_FLAGS, '.output/server/index.mjs'], { env: serverEnv, logFile })
  return { child, stop: stopper(child) }
}

/** Whether the app at `url` (directly, or through the edge) answers its readiness check. */
export const answersReady = async (url: string): Promise<boolean> => {
  try {
    return (await fetch(`${url}/api/ready`)).ok
  } catch {
    // Not listening yet.
    return false
  }
}

/** Polls /api/ready for up to 30 s; fails at once, with the log's tail, if the server exits. */
export const waitForServer = async (server: ChildProcess, directUrl: string, logFile: string): Promise<void> => {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null)
      throw new Error(`server exited with ${server.exitCode}. Log (${logFile}):\n${tail(logFile)}`)
    if (await answersReady(directUrl)) return
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`server did not become ready in 30 s. Log (${logFile}):\n${tail(logFile)}`)
}
