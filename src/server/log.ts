import '@tanstack/react-start/server-only'

type Level = 'debug' | 'info' | 'warn' | 'error'
type Fields = Record<string, unknown>

// Only the first line of a message is kept and stacks are reduced to their frames: Drizzle and pg
// append the SQL parameters (emails, session tokens) on later lines.
const firstLine = (text: string) => text.split('\n', 1)[0] ?? ''
const frames = (stack: string | undefined) =>
  stack
    ?.split('\n')
    .filter((line) => line.trimStart().startsWith('at '))
    .join('\n')

const serializeError = (error: unknown, depth = 0): unknown => {
  if (typeof error === 'string') return firstLine(error)
  if (error === null || typeof error !== 'object') return error
  // Other thrown objects (Effect data classes, library error shapes) can hold request or response
  // data in any field: keep only what identifies them.
  if (!(error instanceof Error)) {
    const tag = (error as { _tag?: unknown })._tag
    return { type: error.constructor?.name ?? 'Object', ...(typeof tag === 'string' ? { _tag: tag } : {}) }
  }
  const code = (error as { code?: unknown }).code
  return {
    name: error.name,
    message: firstLine(error.message),
    ...(code === undefined ? {} : { code }),
    stack: frames(error.stack),
    ...(error.cause !== undefined && depth < 3 ? { cause: serializeError(error.cause, depth + 1) } : {}),
  }
}

/**
 * One JSON object per line on stdout (stderr for errors), for log collectors.
 * Never pass request headers, cookies, bodies or query strings: they can carry credentials.
 */
export const log = (level: Level, msg: string, fields: Fields = {}) => {
  const entry: Fields = { time: new Date().toISOString(), level, msg }
  for (const [key, value] of Object.entries(fields)) entry[key] = key === 'error' ? serializeError(value) : value
  const line = `${JSON.stringify(entry)}\n`
  if (level === 'error') process.stderr.write(line)
  else process.stdout.write(line)
}

/**
 * Routes `console.error` and `console.warn` through `log`. Framework code (h3 inside TanStack Start,
 * the server-function and SSR pipelines, srvx) reports failures there as raw multi-line stacks with
 * `cause` chains, bypassing the sanitizing above; Start renders those errors into responses itself,
 * so they never reach Nitro's `error` hook. Only strings (first line) and the first Error argument are
 * kept; other arguments can be request data and are dropped.
 */
const NITRO_PROCESS_TRAP = /^\[(unhandledRejection|uncaughtException)\]$/

export const captureConsole = () => {
  for (const level of ['error', 'warn'] as const) {
    console[level] = (...args: unknown[]) => {
      // Nitro's own process handlers print these; src/server/nitro/startup.ts already logs them.
      if (typeof args[0] === 'string' && NITRO_PROCESS_TRAP.test(args[0])) return
      const error = args.find((arg) => arg instanceof Error)
      const text = args.filter((arg): arg is string => typeof arg === 'string').join(' ')
      log(level, level === 'error' ? 'framework error' : 'framework warning', {
        ...(text ? { detail: firstLine(text).slice(0, 500) } : {}),
        ...(error ? { error } : {}),
      })
    }
  }
}
