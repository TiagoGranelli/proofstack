// Creates an email/password account with a verified address: the operator vouches for it, so the account can
// sign in at once and no confirmation mail is sent. Works whether public sign-up is open or closed.
// Usage: pnpm user:create <email> <name>
//        node .output/create-user.mjs <email> <name>   (the Docker image: a bundle, scripts/bundle-cli.ts)
// The password comes from CREATE_USER_PASSWORD, else from stdin: typed at a hidden prompt (asked twice)
// in a terminal, or read whole from a pipe (`printf %s "$pw" | pnpm user:create ...`).
// Needs the server's DATABASE_URL, APP_URL and BETTER_AUTH_SECRET (src/server/env.ts validates them).
import { stdin, stderr } from 'node:process'
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { eq } from 'drizzle-orm'
import { auth } from '#/server/auth.ts'
import { db, pool } from '#/server/db/client.ts'
import { user } from '#/server/db/schema/index.ts'

/** A stream to stderr that `mute` silences: readline writes the question, then the echo of what is typed, to it. */
const mutableEcho = () => {
  let muted = false
  const output = new Writable({
    write(chunk: Buffer | string, encoding: BufferEncoding, callback) {
      if (!muted) stderr.write(chunk, encoding)
      callback()
    },
  })
  return { output, mute: () => (muted = true) }
}

/** Asks on the terminal without echoing what is typed. */
const askHidden = (question: string) =>
  new Promise<string>((resolve, reject) => {
    const echo = mutableEcho()
    const rl = createInterface({ input: stdin, output: echo.output, terminal: true, historySize: 0 })
    rl.on('SIGINT', () => {
      rl.close()
      stderr.write('\n')
      reject(new Error('cancelled at the password prompt (Ctrl-C)'))
    })
    rl.question(question, (answer) => {
      rl.close()
      stderr.write('\n')
      resolve(answer)
    })
    echo.mute()
  })

const readPassword = async () => {
  if (process.env.CREATE_USER_PASSWORD) return process.env.CREATE_USER_PASSWORD
  if (stdin.isTTY) {
    const password = await askHidden('Password: ')
    if ((await askHidden('Repeat password: ')) !== password) throw new Error('the passwords do not match')
    return password
  }
  let data = ''
  for await (const chunk of stdin) data += chunk
  return data.replace(/\r?\n$/, '')
}

const [rawEmail, rawName] = process.argv.slice(2)
// Better Auth stores emails lowercased; the existence check and the sign-up must use the same value.
const email = rawEmail?.trim().toLowerCase()
const name = rawName?.trim()
if (!email || !name) {
  console.error(
    'usage: pnpm user:create <email> <name>, or in the image: node .output/create-user.mjs <email> <name>\n' +
      '(password via stdin or CREATE_USER_PASSWORD)',
  )
  process.exit(2)
}

try {
  const password = await readPassword()
  // Checked here so the message can name the limits; Better Auth only says "Password too short".
  const { minPasswordLength, maxPasswordLength } = auth.options.emailAndPassword
  if (password.length < minPasswordLength)
    throw new Error(`password too short (${password.length} characters): use at least ${minPasswordLength}`)
  if (password.length > maxPasswordLength)
    throw new Error(`password too long (${password.length} characters): use at most ${maxPasswordLength}`)
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
  if (existing) throw new Error(`a user with email ${email} already exists`)
  // What sign-up does, minus the verification mail: Better Auth's password hash, user and credential account.
  const context = await auth.$context
  const hash = await context.password.hash(password)
  const created = await context.internalAdapter.createUser(
    { email, name, emailVerified: true },
    { method: 'email-password' },
  )
  await context.internalAdapter.linkAccount({
    userId: created.id,
    providerId: 'credential',
    accountId: created.id,
    password: hash,
  })
  console.log(`created ${created.email}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await pool.end()
}
