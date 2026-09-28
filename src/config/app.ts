// The app's public name, in one place: page titles, the site header, the API title, Better Auth's appName and the
// account mail signature read it from here. The package name (`name` in package.json) is the only other place
// the name lives; every internal identifier (databases, env vars, service tags, Docker names) is neutral.
// Renaming the app: docs/adopting.md, "Rename the app". tests/unit/repo-policy.test.ts keeps it that way.
export const APP_NAME = 'Slopproof'

/** A page's document title, such as "Sign in · Slopproof". */
export const pageTitle = (page: string) => `${page} · ${APP_NAME}`
