// Accessibility assertions for E2E specs: an axe scan that fails on any violation, and a keyboard walk that
// records every Tab stop with its accessible name and whether its focus is visible.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { APP_NAME } from '#/config/app.ts'

/** WCAG 2.0, 2.1 and 2.2 at levels A and AA, plus axe's best practices. */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

/**
 * Scans the page as it is now and fails on any violation, listing each rule with the offending selectors.
 * `state` names the UI state in the failure message and in the attached report, e.g. 'dashboard, editing'.
 */
export async function expectAccessible(page: Page, state: string) {
  // Scan the state as it settles, not a frame of a transition: a button that becomes enabled fades in from
  // `disabled:opacity-50`, and its colors fail contrast until the fade ends. Infinite animations (a loading
  // pulse) never finish and are part of the state, so they are not waited for.
  await page.evaluate(async () => {
    for (;;) {
      const running = document
        .getAnimations()
        .filter((a) => a.playState === 'running' && Number.isFinite(Number(a.effect?.getComputedTiming().endTime)))
      if (running.length === 0) return
      await Promise.allSettled(running.map((a) => a.finished))
    }
  })
  const scan = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  await test.info().attach(`axe ${state}.json`, {
    body: JSON.stringify(scan.violations, null, 2),
    contentType: 'application/json',
  })
  const violations = scan.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help} at ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`,
  )
  expect(violations, `axe violations in "${state}"`).toEqual([])
}

export type TabStop = {
  /** Role and accessible name, e.g. `button "Sign out"`, from Playwright's ARIA snapshot. */
  name: string
  /** The element shows a focus indicator: a non-zero outline or a box-shadow ring. */
  visibleFocus: boolean
}

/**
 * Presses Tab (Shift+Tab with `backwards`) from the current focus until focus has gone past every control
 * of the page, and returns every stop on the way. Fails if that takes more than `max` presses (a focus trap,
 * or more controls than expected), or if focus is lost to the document on the way.
 *
 * "Past every control" is a temporary, focusable sentinel at the very end of `body` (at the very start when
 * going backwards): what the browser does once Tab leaves the last control differs and is not part of the
 * page. Chromium moves focus to its own UI and `document.activeElement` becomes `body`; Firefox under
 * Playwright keeps focus on the last control and `document.hasFocus()` stays true, which looks exactly like
 * a trap. Focus that reaches the sentinel has left every control in the page's own order, in every engine.
 */
export async function tabThrough(page: Page, options: { backwards?: boolean; max?: number } = {}): Promise<TabStop[]> {
  const { backwards = false, max = 40 } = options
  await page.evaluate((atStart) => {
    const sentinel = Object.assign(document.createElement('span'), { tabIndex: 0, id: 'tab-walk-end' })
    if (atStart) document.body.prepend(sentinel)
    else document.body.append(sentinel)
  }, backwards)
  try {
    return await walkToSentinel(page, { backwards, max })
  } finally {
    await page.evaluate(() => document.getElementById('tab-walk-end')?.remove())
  }
}

/** Presses Tab (or Shift+Tab) until focus reaches the sentinel of `tabThrough`, and returns the stops on the way. */
const walkToSentinel = async (page: Page, { backwards, max }: { backwards: boolean; max: number }) => {
  const stops: TabStop[] = []
  const walked = () => stops.map((stop) => stop.name).join(' → ')
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab')
    const stop = await focusedStop(page)
    if (stop === 'lost') throw new Error(`focus was lost to the document after ${walked() || 'no stops'}`)
    if (stop === 'sentinel') return stops
    stops.push(stop)
  }
  throw new Error(`focus did not get past the page after ${max} key presses: ${walked()}`)
}

/** Where focus is now: a control, as a tab stop; the sentinel of `tabThrough`; or nowhere (lost to the document). */
const focusedStop = async (page: Page): Promise<TabStop | 'sentinel' | 'lost'> => {
  const focused = page.locator(':focus')
  if ((await focused.count()) === 0) return 'lost'
  if (await focused.evaluate((element) => element.id === 'tab-walk-end')) return 'sentinel'
  const snapshot = await focused.ariaSnapshot()
  // `- button "Sign out"`, or YAML-quoted when the name has a colon: `- 'button "Edit post: First"'`.
  const [, role, label] = /^- '?([\w-]+)(?: "((?:[^"\\]|\\.)*)")?/.exec(snapshot) ?? []
  const visibleFocus = await focused.evaluate((element) => {
    const style = getComputedStyle(element)
    const outline = style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0
    return element.matches(':focus-visible') && (outline || style.boxShadow !== 'none')
  })
  return { name: label === undefined ? `${role}` : `${role} "${label}"`, visibleFocus }
}

/**
 * Tab stops from the top of the page. Focus starts on a temporary, untabbable element before everything
 * else (blurring would not do: the browser resumes Tab from the last focused element).
 */
export async function tabOrder(page: Page, max?: number) {
  await page.evaluate(() => {
    const start = Object.assign(document.createElement('span'), { tabIndex: -1, id: 'tab-order-start' })
    document.body.prepend(start)
    start.focus()
  })
  try {
    return await tabThrough(page, { max })
  } finally {
    await page.evaluate(() => document.getElementById('tab-order-start')?.remove())
  }
}

const ACCOUNT_LINKS = {
  'signed out': `
    - link "Sign in"`,
  'signed in': `
    - text: /\\S/
    - link "Dashboard"
    - link "Account"
    - button "Sign out"`,
}

/**
 * What every page starts with, as an ARIA snapshot: the skip link, then the site header with the main
 * navigation, whose account links depend on `session`; the page's own `main` follows.
 */
export const siteHeader = (session: keyof typeof ACCOUNT_LINKS) => `
- link "Skip to content"
- banner:
  - navigation "Main":
    - link "${APP_NAME}"
    - link "About"${ACCOUNT_LINKS[session]}`

/** The footer every page ends with: what the app is and the theme choice. */
export const SITE_FOOTER = `
- contentinfo:
  - paragraph
  - group "Theme":
    - radio "System"
    - radio "Light"
    - radio "Dark"`
