// Calls the account server functions (src/lib/auth.functions.ts) over HTTP, as the browser's compiled client
// does, so the integration tests reach them without a browser. Two details of TanStack Start are mirrored here
// and fail loudly if they change: the production id of a server function (sha256 of `<file>--<export>
// _createServerFn_handler`) and Seroval's JSON nodes for plain values, the wire format of the input and the
// answer.
import { createHash } from 'node:crypto'
import { expect } from 'vitest'
import type * as AuthFunctions from '#/lib/auth.functions.ts'
import { appUrl } from './helpers.ts'

type Json = null | undefined | boolean | number | string | Json[] | { [key: string]: Json }
type Node = Record<string, unknown>

/** Seroval escapes these in strings; the tests only send and read plain ones. */
const ESCAPED = /[\\"\n\r\b\t\f\u2028\u2029<]/
const plain = (text: string) => {
  if (ESCAPED.test(text)) throw new Error(`server function values must be plain strings, got ${JSON.stringify(text)}`)
  return text
}

// Constants (t: 2): null, undefined, true, false. Objects and arrays are numbered in pre-order.
const encode = (value: Json, ids = { next: 0 }): Node => {
  if (value === null) return { t: 2, s: 0 }
  if (value === undefined) return { t: 2, s: 1 }
  if (typeof value === 'boolean') return { t: 2, s: value ? 2 : 3 }
  if (typeof value === 'number') return { t: 0, s: value }
  if (typeof value === 'string') return { t: 1, s: plain(value) }
  const i = ids.next++
  if (Array.isArray(value)) return { t: 9, i, a: value.map((item) => encode(item, ids)), o: 0 }
  const keys = Object.keys(value).map(plain)
  return { t: 10, i, p: { k: keys, v: keys.map((key) => encode(value[key], ids)) }, o: 0 }
}

const decode = (node: Node): unknown => {
  switch (node.t) {
    case 0:
      return node.s
    case 1:
      return plain(node.s as string)
    case 2:
      return [null, undefined, true, false][node.s as number]
    case 9:
      return (node.a as Node[]).map(decode)
    // Objects; 11 is one without a prototype (Start's `context`).
    case 10:
    case 11: {
      const { k, v } = node.p as { k: string[]; v: Node[] }
      return Object.fromEntries(k.map((key, index) => [plain(key), decode(v[index]!)]))
    }
    // What the function threw, through Start's error plugin: only its message crosses (`Internal error`).
    case 25:
      if (node.c === '$TSR/Error') return new Error(decode((node.s as { message: Node }).message) as string)
      throw new Error(`unexpected Seroval plugin node ${JSON.stringify(node)}`)
    default:
      throw new Error(`unexpected Seroval node ${JSON.stringify(node)}`)
  }
}

const idOf = (name: string) =>
  createHash('sha256').update(`src/lib/auth.functions.ts--${name}_createServerFn_handler`).digest('hex')

type AuthFunction = keyof typeof AuthFunctions
/** What a server function resolved with, as the browser would see it. */
type Answer<F extends AuthFunction> = Awaited<ReturnType<(typeof AuthFunctions)[F]>>

/**
 * Calls server function `name` with `data` as the client of `headers` (cookie, x-forwarded-for) from our origin,
 * on the main server or on `baseUrl`.
 * `response` is the raw HTTP answer (headers, Set-Cookie); `value` is what the function returned, or undefined
 * when it threw, and then `thrown` is the message the browser would get.
 */
export const callAuthFunction = async <F extends AuthFunction>(
  name: F,
  options: { method?: 'GET' | 'POST'; data?: Json; headers?: Record<string, string>; baseUrl?: string } = {},
): Promise<{ response: Response; value: Answer<F> | undefined; thrown?: string }> => {
  const method = options.method ?? 'POST'
  const url = new URL(`/_serverFn/${idOf(name)}`, options.baseUrl ?? appUrl)
  // The client sends Seroval's `toJSON` envelope (root node, feature flags, no marks); the answer is the root
  // node alone (`toCrossJSON`).
  const payload = JSON.stringify({ t: encode({ data: options.data }), f: 127, m: [] })
  if (method === 'GET') url.searchParams.set('payload', payload)
  const response = await fetch(url, {
    method,
    headers: {
      'x-tsr-serverFn': 'true',
      origin: appUrl,
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
    ...(method === 'POST' ? { body: payload } : {}),
  })
  const text = await response.clone().text()
  // Nitro's bare 500 for an id Start does not know (docs/decisions/0009-unknown-server-function-id.md).
  expect(text, `server function ${name} has id ${idOf(name)}`).not.toContain('"unhandled":true')
  const answer = response.headers.get('content-type')?.includes('json') ? decode(JSON.parse(text) as Node) : undefined
  if (answer instanceof Error) return { response, value: undefined, thrown: answer.message }
  const { result, error } = (answer ?? {}) as { result?: unknown; error?: unknown }
  if (error instanceof Error) return { response, value: undefined, thrown: error.message }
  return { response, value: result as Answer<F> | undefined }
}
