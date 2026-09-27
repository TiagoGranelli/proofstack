// Child processes whose output goes to a log file (the app server, the edge), and the log's tail for failure
// messages.
import { type ChildProcess, spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Starts `command` with stdout and stderr in `logFile` (truncated first). */
export const spawnToLog = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; logFile: string },
): ChildProcess => {
  mkdirSync(dirname(options.logFile), { recursive: true })
  const log = openSync(options.logFile, 'w')
  const child = spawn(command, args, { stdio: ['ignore', log, log], env: options.env })
  closeSync(log)
  return child
}

/** Last lines of a log file, for failure messages. */
export const tail = (file: string, lines = 60): string =>
  existsSync(file) ? readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n') : '(no log)'
