// describeApiError turns whatever the SDK threw into the sentence the UI shows. It must never show raw
// server output, and every contract error tag has its own message. Pure function: no app needed.
import { describe, expect, it } from 'vitest'
import { apiErrorTag, describeApiError, fieldIssue } from '#/lib/api-error.ts'

const ACTION = 'save the post'

describe('describeApiError', () => {
  it('asks to check the connection when the request never got a response', () => {
    expect(describeApiError(new TypeError('Failed to fetch'), ACTION)).toEqual({
      message: 'Could not save the post. Check your connection and try again.',
      signIn: false,
    })
  })

  // Non-JSON bodies (CSRF "Forbidden", a proxy's HTML 502 page), empty bodies and other shapes.
  const untagged: Array<[string, unknown]> = [
    ['a plain-text body', 'Forbidden'],
    ['an HTML error page', '<html><body>502 Bad Gateway: upstream 10.0.0.7</body></html>'],
    ['an empty body', {}],
    ['null', null],
    ['undefined', undefined],
    ['a number', 500],
    ['a non-string tag', { _tag: 42, message: 'internal detail' }],
    ['a generic Error', new Error('socket hang up at 10.0.0.7')],
  ]
  it.each(untagged)('shows a generic retry message for %s, never the raw output', (_, error) => {
    const view = describeApiError(error, ACTION)
    expect(view).toEqual({ message: 'Could not save the post. Try again.', signIn: false })
  })

  it('lists every validation issue', () => {
    const error = {
      _tag: 'ValidationError',
      message: 'Invalid request payload',
      issues: [
        { path: ['body'], message: 'Expected a value with a length of at most 280.' },
        { path: ['title'], message: 'Missing key.' },
      ],
    }
    expect(describeApiError(error, ACTION)).toEqual({
      message: 'Could not save the post: Expected a value with a length of at most 280. Missing key.',
      signIn: false,
    })
  })

  it('falls back to the validation message when there are no issues', () => {
    const error = { _tag: 'ValidationError', message: 'Invalid request payload', issues: [] }
    expect(describeApiError(error, ACTION).message).toBe('Could not save the post: Invalid request payload')
  })

  it('offers to sign in again when the session has ended', () => {
    expect(describeApiError({ _tag: 'Unauthorized', message: 'Authentication required' }, ACTION)).toEqual({
      message: 'Your session has ended. Sign in again to continue.',
      signIn: true,
    })
  })

  it('explains a post that is gone', () => {
    expect(describeApiError({ _tag: 'PostNotFound', id: 'a' }, ACTION)).toEqual({
      message: 'This post no longer exists. It may have been deleted elsewhere.',
      signIn: false,
    })
  })

  it('explains a temporary outage without the server detail', () => {
    expect(describeApiError({ _tag: 'ServiceUnavailable', message: 'Database unavailable' }, ACTION)).toEqual({
      message: 'The service is temporarily unavailable. Try again in a moment.',
      signIn: false,
    })
  })

  it('says how long to wait after too many writes', () => {
    expect(describeApiError({ _tag: 'RateLimited', message: 'slow down', retryAfter: 42 }, ACTION)).toEqual({
      message: 'Could not save the post: too many changes in a short time. Try again in 42 seconds.',
      signIn: false,
    })
    expect(describeApiError({ _tag: 'RateLimited', message: 'slow down', retryAfter: 1 }, ACTION).message).toBe(
      'Could not save the post: too many changes in a short time. Try again in 1 second.',
    )
  })

  it('treats a tag from a newer server as a generic failure', () => {
    expect(describeApiError({ _tag: 'SlowDown', message: 'slow down' }, ACTION)).toEqual({
      message: 'Could not save the post. Try again.',
      signIn: false,
    })
  })
})

describe('apiErrorTag', () => {
  it('returns the contract tag of an API error', () => {
    expect(apiErrorTag({ _tag: 'PostNotFound', id: 'a' })).toBe('PostNotFound')
  })

  it.each([['Forbidden'], [{}], [null], [new TypeError('Failed to fetch')], [{ _tag: 1 }]])(
    'returns undefined for %j',
    (error) => {
      expect(apiErrorTag(error)).toBeUndefined()
    },
  )
})

describe('fieldIssue', () => {
  const invalid = {
    _tag: 'ValidationError',
    message: 'Invalid request payload',
    issues: [
      { path: [], message: 'Missing body.' },
      { path: ['body'], message: 'Use at most 280 characters.' },
      { path: ['body', 'nested'], message: 'A later issue for the same field.' },
    ],
  }

  it('finds the first issue that names the field', () => {
    expect(fieldIssue(invalid, 'body')).toBe('Use at most 280 characters.')
  })

  it.each<[string, unknown]>([
    ['another field', invalid],
    ['a ValidationError without issues', { ...invalid, issues: [] }],
    ['another tagged error', { _tag: 'Unauthorized', message: 'Authentication required' }],
    ['a network failure', new TypeError('Failed to fetch')],
    ['nothing', null],
  ])('has nothing for %s', (name, error) => {
    expect(fieldIssue(error, name === 'another field' ? 'title' : 'body')).toBeUndefined()
  })
})
