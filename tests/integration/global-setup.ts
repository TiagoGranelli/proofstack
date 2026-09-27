// Vitest global setup: the integration tests need the running app that `pnpm verify:app` provides.
const REQUIRED = [
  'APP_URL',
  'TEST_USER_EMAIL',
  'TEST_USER_PASSWORD',
  'TEST_USER_NAME',
  'TEST_OTHER_USER_EMAIL',
  'TEST_OTHER_USER_PASSWORD',
  'TEST_OTHER_USER_NAME',
  'CLOSED_APP_URL',
  'MAILPIT_URL',
] as const

export default async function setup() {
  const missing = REQUIRED.filter((name) => !process.env[name])
  if (missing.length)
    throw new Error(
      `Missing ${missing.join(', ')}. These tests run against a live app: use \`pnpm build && pnpm verify:app\`, ` +
        'which starts one on a fresh test database and sets these variables.',
    )
  const url = `${process.env.APP_URL}/api/ready`
  const res = await fetch(url).catch((error: unknown) => {
    throw new Error(`${url} is unreachable (${String(error)}). Start the app with \`pnpm verify:app\`.`)
  })
  if (!res.ok) throw new Error(`${url} answered ${res.status}; the app is not ready.`)
}
