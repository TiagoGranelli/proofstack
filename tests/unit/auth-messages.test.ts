// The account emails link to the app's own pages with the token in the query string. Pure: no app, no SMTP.
import { describe, expect, it } from 'vitest'
import { authMessages } from '#/server/mail/auth-messages.ts'

const messages = authMessages('https://app.example.com')
const to = { name: 'Ada', email: 'ada@example.com' }
const links = (text: string) => text.match(/https:\/\/\S+/g) ?? []

describe('authMessages', () => {
  it('links the verification mail to /verify-email with the token', () => {
    const mail = messages.verifyEmail(to, 'a.b+c/d=')
    expect(mail).toMatchObject({ to: 'ada@example.com', subject: 'Confirm your email address' })
    expect(links(mail.text)).toEqual(['https://app.example.com/verify-email?token=a.b%2Bc%2Fd%3D'])
    expect(new URL(links(mail.text)[0]!).searchParams.get('token')).toBe('a.b+c/d=')
  })

  it('links the reset mail to /reset-password with the token', () => {
    const mail = messages.resetPassword(to, 'reset-token')
    expect(mail.subject).toBe('Reset your password')
    expect(links(mail.text)).toEqual(['https://app.example.com/reset-password?token=reset-token'])
  })

  it('points the owner of an existing address to sign-in and password reset, without a token', () => {
    const mail = messages.existingAccount(to)
    expect(links(mail.text).map((link) => link.replace(/[.,]$/, ''))).toEqual([
      'https://app.example.com/login',
      'https://app.example.com/forgot-password',
    ])
    expect(mail.text).not.toContain('token')
  })
})
