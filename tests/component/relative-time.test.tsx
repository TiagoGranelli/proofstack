// RelativeTime: the same UTC date from the server and during hydration (no mismatch), then the browser's relative,
// local reading, with the exact time kept in `datetime` and on hover.
import { describe, expect, it } from 'vitest'
import { RelativeTime } from '#/components/time/relative-time.tsx'
import { renderInApp, serverRendered } from './test-utils.tsx'

const fiveMinutesAgo = () => new Date(Date.now() - 5 * 60_000 - 5_000).toISOString()

describe('RelativeTime', () => {
  it('renders the UTC date on the server, hydrates without a mismatch, then reads relative', async () => {
    const iso = fiveMinutesAgo()
    const rendered = await serverRendered(<RelativeTime iso={iso} />)
    const time = () => rendered.container.querySelector('time')!
    const utcDate = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(iso))
    expect(time().textContent).toBe(utcDate)
    expect(time().title).toMatch(/ UTC$/)
    rendered.hydrate()
    await expect.poll(() => time().textContent).toBe('5 minutes ago')
    expect(rendered.mismatches).toEqual([])
    expect(time().dateTime).toBe(iso)
    expect(time().title).not.toMatch(/UTC/)
  })

  it('reads relative at once when rendered in the browser (a client-side navigation)', async () => {
    const iso = fiveMinutesAgo()
    const { container } = await renderInApp(<RelativeTime iso={iso} />)
    const time = container.querySelector('time')!
    expect(time.textContent).toBe('5 minutes ago')
    expect(time.getAttribute('datetime')).toBe(iso)
  })
})
