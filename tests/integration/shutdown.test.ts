// Graceful shutdown of the built server under load. This file starts its own server on its own database (the
// shared ones must stay up for the other files), stops it with SIGTERM while two requests show what a drain must
// handle, and checks it stopped cleanly: exit 0, quickly, the Postgres pool closed last and no connection left.
// See docs/operations.md, "Shutdown", and src/server/lifecycle.ts.
import { readFileSync } from 'node:fs'
import { connect } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LOOPBACK, type RunningApp, startApp } from '../../scripts/app-server.ts'
import { dropTestDatabase, openConnections, testDatabaseUrl } from '../../scripts/test-db.ts'

const LOG_FILE = 'test-results/app-server-shutdown.log'
/** srvx drains requests, then the close hook from src/server/lifecycle.ts ends the pool; both are quick here. */
const MAX_SHUTDOWN_MS = 3_000

/**
 * Time for the server to read what the test sent. Without that read it treats the first connection as idle and
 * never runs the sign-in.
 */
const settle = () =>
  // A fixed wait on purpose: the server gives no sign that it has read part of a request (the headers of
  // /api/ready) or a request whose client is gone, so there is no condition to wait for.
  // oxlint-disable-next-line eslint-js/no-restricted-syntax
  new Promise((resolve) => setTimeout(resolve, 20))
const logLines = () => readFileSync(LOG_FILE, 'utf8').split('\n')

/** A raw HTTP/1.1 connection to the Node server, so the test controls when each byte of a request leaves. */
const rawConnection = async (directUrl: string) => {
  const socket = connect(Number(new URL(directUrl).port), '127.0.0.1')
  await new Promise((resolve, reject) => socket.once('connect', resolve).once('error', reject))
  let received = ''
  socket.on('data', (chunk: Buffer) => (received += chunk.toString()))
  const closed = new Promise<string>((resolve) => socket.once('close', () => resolve(received)))
  socket.on('error', () => {})
  return { socket, closed }
}

/** A sign-in whose client hangs up right after sending it: the server still runs its handler. */
const abandonSignIn = async (app: RunningApp) => {
  const connection = await rawConnection(app.directUrl)
  const body = JSON.stringify({ email: app.user.email, password: app.user.password })
  const request = [
    'POST /api/auth/sign-in/email HTTP/1.1',
    'Host: localhost',
    `Origin: ${app.url}`,
    'Content-Type: application/json',
    `Content-Length: ${Buffer.byteLength(body)}`,
    // Its own rate-limit bucket (the server trusts this process as a proxy).
    'X-Forwarded-For: 198.51.100.99',
    '',
    body,
  ]
  connection.socket.write(request.join('\r\n'))
  await settle()
  connection.socket.destroy()
}

/**
 * After the drain: the abandoned sign-in finished, logged as 499 (aborted), before "shutdown complete", which lists
 * the pool, and no query ran on a closed pool.
 */
const expectSignInFinishedBeforePoolClosed = () => {
  const log = logLines()
  const complete = log.findIndex((line) => line.includes('"shutdown complete"'))
  const signIn = log.findIndex((line) => line.includes('"/api/auth/sign-in/email"') && line.includes('"aborted":true'))
  expect(signIn, 'the abandoned sign-in is logged (499, aborted) before "shutdown complete"').not.toBe(-1)
  expect(signIn).toBeLessThan(complete)
  expect(log[complete], '"shutdown complete" lists the pool').toContain('postgres-pool')
  expect(log.filter((line) => /Failed query|Cannot use a pool after calling end/.test(line))).toEqual([])
}

let app: RunningApp
const databaseUrl = testDatabaseUrl('shutdown')

beforeAll(async () => {
  app = await startApp({ databaseUrl, logFile: LOG_FILE, trustedProxies: LOOPBACK })
  // A rendered form page once left TanStack Form's devtools connect loop running, which held the process for 5 s
  // after SIGTERM (src/lib/no-devtools-event-client.ts): the shutdown below must not wait for it.
  expect((await fetch(new URL('/login', app.directUrl))).status).toBe(200)
}, 60_000)

afterAll(async () => {
  // Still unassigned when beforeAll failed before the app started.
  await (app as RunningApp | undefined)?.stop()
  await dropTestDatabase(databaseUrl)
})

describe('shutdown', () => {
  it("runs the server under Node's permission model, as the image does", () => {
    expect(readFileSync(LOG_FILE, 'utf8')).toContain('"permissionModel":true')
  })

  // - A load balancer's request that arrives on an open connection right at SIGTERM: /api/ready must answer 503
  //   with `Connection: close`, so the balancer stops routing here and does not reuse the connection.
  // - A sign-in whose client disconnects just before SIGTERM: srvx's drain does not wait for its handler, which
  //   still hashes the password and writes a session. It must finish, logged as 499, before the pool closes.
  it('drains in-flight work, then closes the pool and exits 0', async () => {
    const ready = await rawConnection(app.directUrl)
    // Headers begun but not ended: the connection is busy, so the drain does not close it as idle.
    ready.socket.write('GET /api/ready HTTP/1.1\r\nHost: localhost\r\n')
    await abandonSignIn(app)
    const stopping = app.stop()
    await expect.poll(() => readFileSync(LOG_FILE, 'utf8'), { timeout: 10_000 }).toContain('"msg":"draining"')
    ready.socket.write('\r\n')
    const [response, stopped] = await Promise.all([ready.closed, stopping])

    expect(response.split('\r\n', 1)[0], '/api/ready during the drain').toMatch(/^HTTP\/1\.1 503 /)
    expect(response, '/api/ready during the drain closes its connection').toMatch(/^connection: close\r$/im)
    expectSignInFinishedBeforePoolClosed()
    expect(stopped).toMatchObject({ code: 0, signal: null })
    expect(stopped.ms).toBeLessThanOrEqual(MAX_SHUTDOWN_MS)
    // The process is gone, so are its sockets; Postgres may take a moment to reap the backends.
    await expect.poll(() => openConnections(databaseUrl), { timeout: 1_000 }).toEqual([])
  })
})
