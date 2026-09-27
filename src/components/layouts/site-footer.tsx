import { ThemeToggle } from '#/components/layouts/theme-toggle.tsx'
import { APP_NAME } from '#/config/app.ts'

/** The footer on every page: what the app is, and the theme choice. */
export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-6 text-sm text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">{APP_NAME}</span> · short posts, one checked contract
        </p>
        <ThemeToggle />
      </div>
    </footer>
  )
}
