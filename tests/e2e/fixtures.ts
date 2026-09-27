import { expect, test as base } from '@playwright/test'

export type CspViolation = {
  page: string
  directive: string
  blocked: string
  sample: string
  disposition: string
}

type ReportViolation = (violation: Omit<CspViolation, 'page'>) => void

/**
 * Every E2E test runs with a Content-Security-Policy violation collector: each `securitypolicyviolation`
 * event in any page of the test's browser context is reported to the test, which fails if any arrived.
 * A test that provokes violations on purpose reads and empties `cspViolations` itself.
 */
export const test = base.extend<{ cspViolations: CspViolation[] }>({
  cspViolations: [
    async ({ context }, use) => {
      const violations: CspViolation[] = []
      await context.exposeBinding('reportCspViolation', ({ page }, violation: Omit<CspViolation, 'page'>) => {
        violations.push({ page: page.url(), ...violation })
      })
      await context.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          const report = (window as unknown as { reportCspViolation: ReportViolation }).reportCspViolation
          report({
            directive: event.effectiveDirective,
            blocked: event.blockedURI,
            sample: event.sample,
            disposition: event.disposition,
          })
        })
      })
      await use(violations)
      expect(violations, 'Content-Security-Policy violations').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
