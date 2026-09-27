import '@tanstack/react-start/server-only'
import { runInBackground } from '../background-tasks.ts'
import { env } from '../env.ts'
import { onShutdown } from '../lifecycle.ts'
import { authMessages } from './auth-messages.ts'
import { createLogMailer } from './log-mailer.ts'
import type { Mailer, MailMessage } from './mailer.ts'
import { createSmtpMailer } from './smtp-mailer.ts'

const mailer: Mailer = env.smtp ? createSmtpMailer(env.smtp) : createLogMailer({ withContent: !env.isProduction })

// Runs after the `background-tasks` step (../lifecycle.ts), so every pending send has settled.
onShutdown('mailer', () => mailer.close())

const messages = authMessages(env.appUrl)

/**
 * Schedules delivery (../background-tasks.ts) and returns at once: a response never waits for SMTP, so its
 * timing does not reveal whether an account exists.
 */
const schedule = (message: MailMessage): Promise<void> => {
  runInBackground(mailer.send(message))
  return Promise.resolve()
}

/** Better Auth's email callbacks (../auth.ts). */
export const authMail = {
  verifyEmail: (data: { user: { name: string; email: string }; token: string }) =>
    schedule(messages.verifyEmail(data.user, data.token)),
  resetPassword: (data: { user: { name: string; email: string }; token: string }) =>
    schedule(messages.resetPassword(data.user, data.token)),
  existingAccount: (data: { user: { name: string; email: string } }) => schedule(messages.existingAccount(data.user)),
}
