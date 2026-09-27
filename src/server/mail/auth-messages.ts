import '@tanstack/react-start/server-only'
import { APP_NAME } from '#/config/app.ts'
import type { MailMessage } from './mailer.ts'

interface Recipient {
  readonly name: string
  readonly email: string
}

const signature = `\n\n— ${APP_NAME}`

/** An absolute link to one of the app's pages, with the token in the query string when there is one. */
type LinkTo = (path: string, token?: string) => string

const verifyEmail = (linkTo: LinkTo, to: Recipient, token: string): MailMessage => ({
  to: to.email,
  subject: 'Confirm your email address',
  text:
    `Hi ${to.name},\n\nConfirm that this is your email address by opening this link:\n\n` +
    `${linkTo('/verify-email', token)}\n\nThe link works for one hour. If you did not create an account, ` +
    `ignore this message.${signature}`,
})

const resetPassword = (linkTo: LinkTo, to: Recipient, token: string): MailMessage => ({
  to: to.email,
  subject: 'Reset your password',
  text:
    `Hi ${to.name},\n\nSomeone asked to reset the password of your account. To choose a new one, open this ` +
    `link:\n\n${linkTo('/reset-password', token)}\n\nThe link works once, for one hour. A new password signs ` +
    `out every session. If you did not ask for this, ignore this message: your password stays the same.` +
    signature,
})

const existingAccount = (linkTo: LinkTo, to: Recipient): MailMessage => ({
  to: to.email,
  subject: 'Someone tried to sign up with your email address',
  text:
    `Hi ${to.name},\n\nSomeone tried to create an account with this email address, which already has one. ` +
    `If it was you, sign in at ${linkTo('/login')}, or choose a new password at ${linkTo('/forgot-password')}. ` +
    `Otherwise, ignore this message.${signature}`,
})

/** The account emails, each addressed to one recipient. */
interface AuthMessages {
  readonly verifyEmail: (to: Recipient, token: string) => MailMessage
  readonly resetPassword: (to: Recipient, token: string) => MailMessage
  readonly existingAccount: (to: Recipient) => MailMessage
}

/**
 * The account emails, as plain text. Links point at the app's own pages (/verify-email, /reset-password) with
 * the token in the query string; those pages call Better Auth. `appUrl` is the public origin (APP_URL).
 *
 * @example authMessages('https://app.example.com').verifyEmail({ name: 'Ada', email: 'ada@example.com' }, token)
 */
export const authMessages = (appUrl: string): AuthMessages => {
  const linkTo: LinkTo = (path, token) => {
    const url = new URL(path, appUrl)
    if (token !== undefined) url.searchParams.set('token', token)
    return url.href
  }
  return {
    verifyEmail: (to, token) => verifyEmail(linkTo, to, token),
    resetPassword: (to, token) => resetPassword(linkTo, to, token),
    existingAccount: (to) => existingAccount(linkTo, to),
  }
}
