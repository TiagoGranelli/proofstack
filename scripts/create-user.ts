// Creates an email/password account. Public sign-up is disabled over HTTP.
// Usage: pnpm user:create <email> <name>
// The password comes from PROOFSTACK_USER_PASSWORD, else from stdin: typed at a hidden prompt (asked twice)
// in a terminal, or read whole from a pipe (`printf %s "$pw" | pnpm user:create ...`).
import { stdin, stderr } from 'node:process'
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { eq } from 'drizzle-orm'
import { auth } from '#/server/auth.ts'
import { db, pool } from '#/server/db/client.ts'
import { user } from '#/server/db/schema/index.ts'

/** Asks on the terminal without echoing what is typed: readline writes the echo to a muted stream. */
const askHidden = (question: string) =>
  new Promise<string>((resolve, reject) => {
    let muted = false
    const output = new Writable({
      write(chunk, encoding, callback) {
        if (!muted) stderr.write(chunk, encoding)
        callback()
      },
    })
    const rl = createInterface({ input: stdin, output, terminal: true, historySize: 0 })
    rl.on('SIGINT', () => {
      rl.close()
      stderr.write('\n')
      reject(new Error('cancelled'))
    })
    rl.question(question, (answer) => {
      rl.close()
      stderr.write('\n')
      resolve(answer)
    })
    muted = true
  })

const readPassword = async () => {
  if (process.env.PROOFSTACK_USER_PASSWORD) return process.env.PROOFSTACK_USER_PASSWORD
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
  console.error('usage: pnpm user:create <email> <name>  (password via stdin or PROOFSTACK_USER_PASSWORD)')
  process.exit(2)
}

try {
  const password = await readPassword()
  // Checked here so the message can name the limits; Better Auth only says "Password too short".
  const { minPasswordLength, maxPasswordLength } = auth.options.emailAndPassword
  if (password.length < minPasswordLength)
    throw new Error(`password too short: use at least ${minPasswordLength} characters`)
  if (password.length > maxPasswordLength)
    throw new Error(`password too long: use at most ${maxPasswordLength} characters`)
  // signUpEmail reports success for existing emails (enumeration protection), so check first.
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
  if (existing) throw new Error(`a user with email ${email} already exists`)
  const result = await auth.api.signUpEmail({ body: { email, name, password } })
  console.log(`created ${result.user.email}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await pool.end()
}
