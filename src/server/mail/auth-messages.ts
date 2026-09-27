import '@tanstack/react-start/server-only'
import { APP_NAME } from '#/config/app.ts'
import type { MailMessage } from './mailer.ts'

interface Recipient {
  readonly name: string
  readonly email: string
}

const signature = `\n\n— ${APP_NAME}`

/**
 * The account emails, as plain text. Links point at the app's own pages (/verify-email, /reset-password) with
 * the token in the query string; those pages call Better Auth. `appUrl` is the public origin (APP_URL).
 */
export const authMessages = (appUrl: string) => {
  const link = (path: string, token?: string) => {
    const url = new URL(path, appUrl)
    if (token !== undefined) url.searchParams.set('token', token)
    return url.href
  }
  return {
    verifyEmail: (to: Recipient, token: string): MailMessage => ({
      to: to.email,
      subject: 'Confirm your email address',
      text:
        `Hi ${to.name},\n\nConfirm that this is your email address by opening this link:\n\n` +
        `${link('/verify-email', token)}\n\nThe link works for one hour. If you did not create an account, ` +
        `ignore this message.${signature}`,
    }),
    resetPassword: (to: Recipient, token: string): MailMessage => ({
      to: to.email,
      subject: 'Reset your password',
      text:
        `Hi ${to.name},\n\nSomeone asked to reset the password of your account. To choose a new one, open this ` +
        `link:\n\n${link('/reset-password', token)}\n\nThe link works once, for one hour. A new password signs ` +
        `out every session. If you did not ask for this, ignore this message: your password stays the same.` +
        signature,
    }),
    existingAccount: (to: Recipient): MailMessage => ({
      to: to.email,
      subject: 'Someone tried to sign up with your email address',
      text:
        `Hi ${to.name},\n\nSomeone tried to create an account with this email address, which already has one. ` +
        `If it was you, sign in at ${link('/login')}, or choose a new password at ${link('/forgot-password')}. ` +
        `Otherwise, ignore this message.${signature}`,
    }),
  }
}
