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
    // `Object.create(null)` objects have no constructor, whatever the lib types say.
    const { constructor, _tag: tag } = error as { constructor?: { name: string }; _tag?: unknown }
    return { type: constructor?.name ?? 'Object', ...(typeof tag === 'string' ? { _tag: tag } : {}) }
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
export const log = (level: Level, msg: string, fields: Fields = {}): void => {
  const entry: Fields = { time: new Date().toISOString(), level, msg }
  for (const [key, value] of Object.entries(fields)) entry[key] = key === 'error' ? serializeError(value) : value
  const line = `${JSON.stringify(entry)}\n`
  if (level === 'error') process.stderr.write(line)
  else process.stdout.write(line)
}
