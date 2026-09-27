// src/server/env.ts validates the environment once, at import, and stops the process with a message naming
// the variable. Each test imports a fresh copy of the module under its own environment.
import { describe, expect, it, vi } from 'vitest'
import { stubEnvironment } from './process-fakes.ts'

/** Valid values for every required variable; each test overrides what it checks. */
const BASE = {
  DATABASE_URL: 'postgres://app:not-a-secret@127.0.0.1:5432/app',
  APP_URL: 'https://app.example.com',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  TRUSTED_PROXIES: '',
  DATABASE_POOL_MAX: '',
  DATABASE_URL_POOLED: '',
  SMTP_URL: '',
  MAIL_FROM: '',
  AUTH_SIGN_UP: '',
  TRUSTED_IP_HEADER: '',
  NODE_ENV: 'test',
}

const load = async (overrides: Partial<Record<keyof typeof BASE, string | undefined>> = {}) => {
  stubEnvironment({ ...BASE, ...overrides })
  vi.resetModules()
  return (await import('#/server/env.ts')).env
}

describe('env', () => {
  it('reads a minimal environment with its defaults', async () => {
    expect(await load()).toEqual({
      databaseUrl: BASE.DATABASE_URL,
      databasePoolMax: 10,
      databaseUrlPooled: false,
      appUrl: 'https://app.example.com',
      authSecret: BASE.BETTER_AUTH_SECRET,
      trustedProxies: [],
      smtp: undefined,
      authSignUp: 'closed',
      isProduction: false,
    })
  })

  it('trims values and keeps only the origin of APP_URL', async () => {
    const env = await load({ APP_URL: ' http://localhost:3000/ ', DATABASE_URL: ' postgresql://db/app ' })
    expect([env.appUrl, env.databaseUrl]).toEqual(['http://localhost:3000', 'postgresql://db/app'])
  })

  it('knows production by NODE_ENV', async () => {
    expect((await load({ NODE_ENV: 'production' })).isProduction).toBe(true)
  })

  it.each([
    ['DATABASE_URL', { DATABASE_URL: undefined }, 'Missing required environment variable DATABASE_URL'],
    ['a blank APP_URL', { APP_URL: '   ' }, 'Missing required environment variable APP_URL'],
    ['a DATABASE_URL that is not postgres', { DATABASE_URL: 'mysql://db/app' }, 'DATABASE_URL must be a postgres://'],
    ['an APP_URL that is not a URL', { APP_URL: 'app.example.com' }, 'APP_URL must be an origin such as'],
    ['an APP_URL that is not http', { APP_URL: 'ftp://app.example.com' }, 'APP_URL must use http or https'],
    ['an APP_URL with a path', { APP_URL: 'https://app.example.com/app' }, 'APP_URL must be an origin'],
    ['an APP_URL with a query', { APP_URL: 'https://app.example.com/?a=1' }, 'APP_URL must be an origin'],
    ['an APP_URL with a hash', { APP_URL: 'https://app.example.com/#a' }, 'APP_URL must be an origin'],
    ['a short secret', { BETTER_AUTH_SECRET: 'x'.repeat(31) }, 'BETTER_AUTH_SECRET must have at least 32'],
    ['a pool size of 0', { DATABASE_POOL_MAX: '0' }, 'DATABASE_POOL_MAX must be an integer between 1 and 100'],
    ['a pool size over 100', { DATABASE_POOL_MAX: '101' }, 'DATABASE_POOL_MAX must be an integer'],
    ['a fractional pool size', { DATABASE_POOL_MAX: '2.5' }, 'DATABASE_POOL_MAX must be an integer'],
    ['a pool size that is not a number', { DATABASE_POOL_MAX: 'ten' }, 'DATABASE_POOL_MAX must be an integer'],
    [
      'an unknown sign-up policy',
      { AUTH_SIGN_UP: 'invite' },
      'AUTH_SIGN_UP must be one of closed, open (got "invite")',
    ],
    [
      'a DATABASE_URL_POOLED that is not a boolean',
      { DATABASE_URL_POOLED: 'yes' },
      'DATABASE_URL_POOLED must be one of false, true',
    ],
    ['the replaced TRUSTED_IP_HEADER', { TRUSTED_IP_HEADER: 'x-real-ip' }, 'TRUSTED_IP_HEADER was replaced by'],
  ])('refuses %s', async (_, overrides, message) => {
    await expect(load(overrides)).rejects.toThrow(message)
  })

  it('knows a pooled DATABASE_URL only when told, trimmed', async () => {
    expect((await load({ DATABASE_URL_POOLED: undefined })).databaseUrlPooled).toBe(false)
    expect((await load({ DATABASE_URL_POOLED: 'false' })).databaseUrlPooled).toBe(false)
    expect((await load({ DATABASE_URL_POOLED: ' true ' })).databaseUrlPooled).toBe(true)
  })

  it('reads the pool size within its bounds', async () => {
    expect((await load({ DATABASE_POOL_MAX: ' 1 ' })).databasePoolMax).toBe(1)
    expect((await load({ DATABASE_POOL_MAX: '100' })).databasePoolMax).toBe(100)
  })

  describe('TRUSTED_PROXIES', () => {
    it('reads addresses and CIDR ranges of both families, trimmed, skipping empty entries', async () => {
      const env = await load({ TRUSTED_PROXIES: ' 10.0.0.0/8, ,127.0.0.1,::1/128 , 2001:db8::/32,fd00::1,0.0.0.0/0' })
      expect(env.trustedProxies).toEqual([
        '10.0.0.0/8',
        '127.0.0.1',
        '::1/128',
        '2001:db8::/32',
        'fd00::1',
        '0.0.0.0/0',
      ])
    })

    it('is empty when unset', async () => {
      expect((await load({ TRUSTED_PROXIES: undefined })).trustedProxies).toEqual([])
    })

    it('accepts the largest prefix of each family', async () => {
      expect((await load({ TRUSTED_PROXIES: '10.0.0.1/32,::1/128' })).trustedProxies).toHaveLength(2)
    })

    it.each([
      ['a host name', 'proxy.internal'],
      ['an IPv4 prefix over 32', '10.0.0.0/33'],
      ['an IPv6 prefix over 128', '::1/129'],
      ['a prefix that is not a number', '10.0.0.0/eight'],
      ['a negative prefix', '10.0.0.0/-1'],
      ['an empty prefix', '10.0.0.0/'],
      ['two prefixes', '10.0.0.0/8/8'],
      ['an address out of range', '256.0.0.1'],
      ['an address with a port', '10.0.0.1:8080'],
    ])('refuses %s', async (_, entry) => {
      await expect(load({ TRUSTED_PROXIES: `127.0.0.1,${entry}` })).rejects.toThrow(
        `TRUSTED_PROXIES must list IP addresses or CIDR ranges such as 10.0.0.0/8 (got "${entry}")`,
      )
    })
  })

  describe('AUTH_SIGN_UP and mail', () => {
    const smtp = {
      SMTP_URL: 'smtps://user:password@smtp.example.com:465',
      MAIL_FROM: 'Acme <no-reply@example.com>',
    }

    it('is closed by default, and open only when asked, trimmed', async () => {
      expect((await load({ AUTH_SIGN_UP: undefined })).authSignUp).toBe('closed')
      expect((await load({ AUTH_SIGN_UP: 'closed' })).authSignUp).toBe('closed')
      expect((await load({ AUTH_SIGN_UP: ' open ', ...smtp })).authSignUp).toBe('open')
    })

    it('refuses open sign-up without mail, because new accounts must confirm their address', async () => {
      await expect(load({ AUTH_SIGN_UP: 'open' })).rejects.toThrow('AUTH_SIGN_UP=open needs SMTP_URL and MAIL_FROM')
    })

    it('reads SMTP over STARTTLS or TLS with a sender', async () => {
      expect((await load(smtp)).smtp).toEqual({ url: smtp.SMTP_URL, from: smtp.MAIL_FROM })
      const plain = await load({ SMTP_URL: 'smtp://127.0.0.1:1025', MAIL_FROM: 'no-reply@example.com' })
      expect(plain.smtp).toEqual({ url: 'smtp://127.0.0.1:1025', from: 'no-reply@example.com' })
    })

    it.each([
      ['an SMTP_URL that is not a URL', { SMTP_URL: 'smtp.example.com' }, 'SMTP_URL must be a URL such as'],
      [
        'another protocol',
        { SMTP_URL: 'https://smtp.example.com' },
        'SMTP_URL must use smtp:// (STARTTLS) or smtps://',
      ],
      ['no host', { SMTP_URL: 'smtp://' }, 'SMTP_URL must use smtp:// (STARTTLS) or smtps:// (TLS) and name a host'],
      [
        'no sender',
        { SMTP_URL: 'smtp://smtp.example.com', MAIL_FROM: '' },
        'Missing required environment variable MAIL_FROM',
      ],
      ['a sender without an address', { SMTP_URL: 'smtp://smtp.example.com', MAIL_FROM: 'Acme' }, 'MAIL_FROM must be'],
      ['a sender with two @', { SMTP_URL: 'smtp://smtp.example.com', MAIL_FROM: 'a@b@' }, 'MAIL_FROM must be'],
    ])('refuses %s', async (_, overrides, message) => {
      await expect(load(overrides)).rejects.toThrow(message)
    })
  })
})
