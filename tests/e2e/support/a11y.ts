// Accessibility assertions for E2E specs: an axe scan that fails on any violation, and a keyboard walk that
// records every Tab stop with its accessible name and whether its focus is visible.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/** WCAG 2.0, 2.1 and 2.2 at levels A and AA, plus axe's best practices. */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

/**
 * Scans the page as it is now and fails on any violation, listing each rule with the offending selectors.
 * `state` names the UI state in the failure message and in the attached report, e.g. 'dashboard, editing'.
 */
export async function expectAccessible(page: Page, state: string) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  await test.info().attach(`axe ${state}.json`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: 'application/json',
  })
  const violations = results.violations.map(
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
 * Presses Tab (Shift+Tab with `backwards`) from the current focus until focus leaves the document and
 * returns every stop. Fails if focus has not left after `max` presses (a focus trap, or more controls than
 * expected).
 */
export async function tabThrough(page: Page, options: { backwards?: boolean; max?: number } = {}): Promise<TabStop[]> {
  const { backwards = false, max = 40 } = options
  const stops: TabStop[] = []
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab')
    const focused = page.locator(':focus')
    if ((await focused.count()) === 0) return stops
    const snapshot = await focused.ariaSnapshot()
    // `- button "Sign out"`, or YAML-quoted when the name has a colon: `- 'button "Edit post: First"'`.
    const [, role, label] = /^- '?([\w-]+)(?: "((?:[^"\\]|\\.)*)")?/.exec(snapshot) ?? []
    const visibleFocus = await focused.evaluate((element) => {
      const style = getComputedStyle(element)
      const outline = style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0
      return element.matches(':focus-visible') && (outline || style.boxShadow !== 'none')
    })
    stops.push({ name: label === undefined ? `${role}` : `${role} "${label}"`, visibleFocus })
  }
  throw new Error(`focus did not leave the page after ${max} key presses: ${stops.map((s) => s.name).join(' → ')}`)
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

/** The page-level landmarks every page has: the site header with the main navigation, then `main`. */
export const SITE_HEADER = `
- banner:
  - navigation "Main":
    - link "ProofStack"
    - link "About"
    - link "Dashboard"`
