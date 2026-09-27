import '@tanstack/react-start/server-only'
import { log } from '../log.ts'
import type { Mailer } from './mailer.ts'

/**
 * Delivers nothing: records each message in the log instead. Used when SMTP_URL is unset. With `withContent`
 * (development) the entry holds the recipient and the text, links included, so a developer can follow them;
 * otherwise (production) only the subject, because the text carries single-use tokens and logs must not.
 */
export const createLogMailer = (options: { withContent: boolean }): Mailer => ({
  async send(message) {
    log('warn', 'mail not delivered: SMTP_URL is unset', {
      subject: message.subject,
      ...(options.withContent ? { to: message.to, text: message.text } : {}),
    })
  },
  close() {},
})
