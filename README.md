# Slopproof, minimal branch

Quality gates for React and TypeScript projects built with coding agents. The rules a careful team enforces in
review are written as checks, so the agent runs one command before it hands the work back, and every failure says
how to fix it.

This branch carries only the gates, on a small demo app. The full-stack template, with an API contract, a database,
accounts and a deploy path, is on [`main`](https://github.com/TiagoGranelli/slopproof/tree/main).

## The problem

When you don't say how something should be built, a coding agent builds it the most common way it has seen: a
function typed `any`, a variable called `result`, a 150-line component, a field without a label. You can write the
rules in a prompt or an `AGENTS.md`, but the agent can still skip them, and you find out in review.

Here, those rules fail a command. A recreated example: asked to show a reading time next to the word count, an
agent writes this helper and calls it from the counter component.

```ts
// src/lib/reading-time.ts
export function readingTime(text: any) {
  const result = text.split(' ').length
  return Math.ceil(result / 200) + ' min read'
}
```

`pnpm check` fails before anyone reads the diff. This is a real run on this branch, shortened, with lefthook's icons
removed:

```text
src/lib/reading-time.ts:1:35: error typescript(no-explicit-any): Unexpected `any`. help: Use `unknown` instead, ...
src/lib/reading-time.ts:1:17: error typescript(explicit-module-boundary-types): Missing return type on function
src/lib/reading-time.ts:2:9: error eslint(id-denylist): Identifier 'result' is restricted.
src/components/word-counter.tsx:3:1: error import(extensions): Missing file extension in import declaration.
FAIL  |component (chromium)| tests/component/word-counter.test.tsx > WordCounter > starts empty at zero words
  Expected element to have text content: 0 words
  Received: 0 words, 1 min read
lint: run `pnpm lint:fix`, then fix what remains as the message says ...
tests: fix the failing test or the code it covers ...
```

The component test also shows a bug in the helper: an empty text reads as one minute.

## Who it is for

People with their own React project who want these checks without the rest of Slopproof. The gates assume React 19
with the React Compiler and TypeScript 6 or 7, on pnpm, on macOS or Linux. The demo uses Vite, TanStack Router and
Tailwind; the list below says which gates depend on them, and the rest do not.

## Try it here

You need pnpm 12. `pnpm install` downloads the Node version the project pins and installs the pre-commit hook.

```sh
pnpm install
pnpm exec playwright install chromium
pnpm check                      # every static gate and the fast tests, about 5 s
pnpm test:e2e                   # the production build in Chromium: flows, axe, landmarks, tab order
pnpm build && pnpm lighthouse   # performance, accessibility, best practices, SEO
```

Then point your agent at the repository and ask for a change. It finds `AGENTS.md` on its own.

## Copy the gates into your project

Take the steps in order; each one works without the ones after it. Copy the files, then trim what names this demo:
folders, ignore lists, pages. Every dependency is pinned exactly in `package.json`; install the same versions
with `pnpm add -D --save-exact`.

1. **Format, lint and types.** `.oxfmtrc.json`, `.oxlintrc.json`, `tsconfig.json`; `oxfmt`, `oxlint`,
   `oxlint-tsgolint`, `oxlint-plugin-eslint`, `typescript`. Scripts `format`, `format:check`, `lint`, `lint:fix`,
   `typecheck`. Catches functions over 20 lines (components over 80, files over 300), deep nesting, vague names,
   `any` and other type escapes, floating promises, code the React Compiler cannot optimize, and accessibility
   mistakes in JSX. Drop the `jsPlugins` you don't use (`eslint-plugin-playwright`,
   `@tanstack/eslint-plugin-router`) with the rules that name them, and `sortTailwindcss` without Tailwind.
2. **Dead code and boundaries.** `.fallowrc.json`; `fallow`. Scripts `deadcode`, `security:check`. Catches unused
   files, exports and dependencies, imports that cross folder boundaries, complex functions and copy-pasted
   blocks. Rewrite `boundaries.zones` for your folders.
3. **Tests.** `vitest.config.ts`, `tests/unit/repo-policy.test.ts`; `vitest`, `@vitest/browser-playwright`,
   `@vitest/coverage-v8`, `vitest-browser-react`, `playwright`, `fast-check`, and for the React Compiler in component
   tests `@vitejs/plugin-react`, `@rolldown/plugin-babel`, `babel-plugin-react-compiler`, `@babel/core`. Scripts
   `test:unit`, `test:component`, `test:fast`. Components run in a real Chromium, pure functions need 100% coverage
   once they are in `COVERAGE_GATE`, and the repository rules fail on a range version, a lint suppression without a
   reason or an `AGENTS.md` that grew too long.
4. **One command.** `.config/lefthook.yml`; `lefthook`. Scripts `prepare` and `check`. The hook runs the jobs a
   commit touches; `pnpm check` runs them all.
5. **The browser.** `playwright.config.ts`, `tests/e2e/`; `@playwright/test`, `@axe-core/playwright`. Script
   `test:e2e`. Fails on WCAG 2.2 AA violations, a changed landmark structure, a control the keyboard can't reach or
   whose focus is invisible. With TanStack Router file routes, also `scripts/route-coverage.ts` and
   `tests/unit/route-coverage.test.ts`: a new page fails until it has all three checks.
6. **Lighthouse.** `scripts/lighthouse*.ts`; `lighthouse`, `tinyexec`, `@vitejs/plugin-basic-ssl`. Script
   `lighthouse`. Serves the build with Vite's preview server over HTTPS and HTTP/2 and fails below 100 in
   accessibility, best practices or SEO, below the performance bar, or over the budgets in
   `scripts/lighthouse-policy.ts`. The runner needs Vite; the policy does not.
7. **Supply chain.** `pnpm-workspace.yaml`, `.github/renovate.json`. Script `audit:check`. Exact pins, a one-day
   quarantine on new releases, no install scripts unless listed, and a failed install when a package loses its
   trusted publisher.
8. **The agent.** `AGENTS.md` (keep "Code style", "Verify" and "Memory safety"; rewrite the rest), `CLAUDE.md`,
   `.claude/settings.json`, `scripts/format-edited-file.ts`. Claude Code formats and lints each file it edits and
   reads the failures; the settings refuse `git commit --no-verify` and edits to generated files.
9. **CI.** `.github/workflows/ci.yml`, `.github/actions/setup/`, `scripts/ci-jobs.ts`, `.config/gitleaks.toml`, and
   for `pnpm ci:local` (the same jobs in the Playwright container) `scripts/ci-local.ts`, `.github/compose.ci.yaml`,
   `scripts/images.ts`, `scripts/image-pins.ts`, `.github/zizmor.yml`. CI adds a secret scan of the whole history
   and a lint of the workflows.

[docs/agents/gates.md](docs/agents/gates.md) describes every gate and how to make a reviewed exception. The checks
lower the chance that a mistake gets through; they can't prove that the code is correct.

## Docs

- [AGENTS.md](AGENTS.md): the layout, the code style and the commands, for agents and people.
- [docs/agents/gates.md](docs/agents/gates.md): what each gate covers, its escape hatches, the Lighthouse policy.
- [docs/minimal-branch.md](docs/minimal-branch.md): how this branch relates to `main`.
- [docs/decisions/](docs/decisions/README.md): the decisions behind TypeScript, the React Compiler and Lighthouse.

Contributions are welcome: [CONTRIBUTING.md](.github/CONTRIBUTING.md). Security reports go through
[SECURITY.md](.github/SECURITY.md). Everyone taking part follows the [Code of Conduct](.github/CODE_OF_CONDUCT.md).

MIT license.
