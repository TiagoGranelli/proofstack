# AGENTS.md

This branch of Slopproof is a small React app, a word counter with two routes, that carries the template's quality
gates. The app is a stand-in: the gates are the product. A change is done when `pnpm check` passes, plus
`pnpm test:e2e` for anything a user can see, and `pnpm build && pnpm lighthouse` for anything that ships to the
browser.

## Where code goes

| Path | Role | May import |
| --- | --- | --- |
| `src/lib/` | Pure functions: no React, no app code | nothing in `src` |
| `src/components/` | UI that knows no route | `lib` |
| `src/routes/`, `src/main.tsx`, `index.html`, `src/styles/` | The app layer: TanStack Router file routes (client-side only), the router's entry, Tailwind | `components`, `lib` |

- Boundaries are Fallow zones in `.fallowrc.json`. A new top-level `src/` directory needs a zone before it can be
  used.
- Imports use relative paths with explicit `.ts` or `.tsx` extensions (Oxlint `import/extensions`).
- Naming: files and folders are kebab-case (Oxlint `unicorn/filename-case`; folders by
  `tests/unit/repo-policy.test.ts`). TanStack route names keep their prefixes (`__root.tsx`, `_layout.tsx`, `$id.tsx`,
  `-private/`, `(group)/`).
- Import the file that defines a symbol. Barrel files (`index.ts` re-exporting a folder) fail Oxlint
  `oxc/no-barrel-file`.
- A new page is a file in `src/routes/` with its title in `head()`, plus an axe state, a landmark snapshot and a
  tab-order row in `tests/e2e/` (`tests/unit/route-coverage.test.ts` fails without them), and a Lighthouse entry in
  `PAGES` (`scripts/lighthouse-policy.ts`).

## Code style

Code is read by agents one file at a time: a module fits one read, a name greps to its definition, and a
failure says what was wrong. Oxlint (`.oxlintrc.json`) enforces the numbers; the rest is for review. Tests:
[tests/AGENTS.md](tests/AGENTS.md).

- **Size.** Functions up to 20 lines, components (`.tsx`) up to 80, files up to 300, blank and comment lines not
  counted (`max-lines-per-function`, `max-lines`). Over a limit, split by responsibility, not by moving lines:
  a component extracts a child component, a long function becomes named steps, a switch that maps codes to text
  becomes a table.
- **Nesting.** At most two nested blocks per function (`max-depth`), three nested callbacks
  (`max-nested-callbacks`), JSX four elements deep (`react/jsx-max-depth`), three parameters, more go in an
  options object (`max-params`). Return early; no nested ternaries (`no-nested-ternary`).
- **Names.** A name says what the value is, specifically enough that `rg -w <name>` finds its definition and its
  uses: `outcome`, `listed`, `lintRun`, never `result`, `info`, `item`, `tmp` (`id-denylist`). When a library
  imposes a vague key such as `data`, keep it as the key and destructure into a specific name
  (`({ data: credentials })`). Name a module after what it does, never `utils.ts` or `helpers.ts`.
- **Types.** No `any` (`no-explicit-any`, `no-unsafe-*`): read an untyped library value as `unknown` and narrow
  it. Exports of `src/lib` and `scripts` declare their return type (`explicit-module-boundary-types`); components
  and hooks infer theirs.
- **Errors.** A message names the offending value and the shape expected:
  `` `${name} must be an integer between ${min} and ${max} (got "${raw}")` `` (`unicorn/error-message` only
  rejects an empty one). Never echo a secret, a password or user content: give its length, scheme or path.
- **Comments.** Say why, not what. Keep them when you refactor, update them when the reason changes. A line that
  exists because of an upstream bug or limit links the issue (`oxc#23695`) and says when to remove it.
  Exports of `src/lib` get a JSDoc sentence on intent, plus a one-line example when the types do not make the call
  obvious.
- **React.** The React Compiler memoizes components ([ADR 0006](docs/decisions/0006-react-compiler-babel-preset.md)):
  write no `useMemo`, `useCallback` or `memo` for performance. Oxlint's React Compiler rules (`react/todo`,
  `react/unsupported-syntax` and the rest) fail on code the compiler cannot optimize.
- **Logging.** `console` is for scripts (`no-console`).

## Workflows

Each multi-step workflow is a project skill in `.agents/skills/` (linked into `.claude/skills/`). Load it first:

| Task | Skill |
| --- | --- |
| Any dependency bump, a Renovate PR, `pnpm audit:check`, a failed install | `upgrade-deps` |

**First setup.** `pnpm install` (it downloads the pinned Node and installs the pre-commit hook), then
`pnpm exec playwright install chromium`.

## Verify

Read [tests/AGENTS.md](tests/AGENTS.md) before you write or change a test: it says which layer a behavior belongs
in and how each layer works.

| Command | Covers |
| --- | --- |
| `pnpm check` | Every gate that needs no build (format, type-aware lint, typecheck, dead code, boundaries, complexity, duplication, security sinks, unit and component tests with coverage, route coverage, repository rules), about 5 s. Run it before every hand-off; the lefthook pre-commit hook runs the jobs your staged files touch |
| `pnpm test:unit\|test:component [filter ...]` | One fast layer; `pnpm test:fast` runs both with coverage |
| `pnpm format`, `pnpm lint:fix` | Autofixes |
| `pnpm test:e2e [filter ...]` | Builds the app, serves it with `vite preview` on port 4173, and runs the Playwright tests in Chromium: flows, axe, landmarks, tab order |
| `pnpm build && pnpm lighthouse [--page=<name>]` | The Lighthouse gate over HTTPS and HTTP/2 (`scripts/lighthouse-policy.ts`) |
| `pnpm ci:local [job ...]` | The CI jobs in the Playwright Ubuntu container (needs Docker) |

Every gate's failure message says how to fix it. What each gate covers, how to make a reviewed exception, the
Lighthouse policy and the less common commands (`audit:check`) are in [docs/agents/gates.md](docs/agents/gates.md).

## Memory safety

A misconfigured lint once used 17 GB of memory.

- To check a few files, pass explicit paths: `pnpm lint src/x.ts`, `pnpm exec oxfmt --check src/x.ts`.
- Keep `node_modules/**` and build output (`dist/**`) out of every tool's scope. `.oxlintrc.json`, `.oxfmtrc.json`
  and `.fallowrc.json` list both in `ignorePatterns`, and `tsconfig.json` includes only `src`, `scripts`, `tests` and
  `*.config.ts`. A new tool or config needs the same exclusions.
- Run heavy commands one at a time (`pnpm build`, type-aware lint, `pnpm test:e2e`, `pnpm lighthouse`). On Linux,
  a memory cap keeps a runaway tool from taking the machine down:
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 -- pnpm check`.

## Generated files

Regenerate these files; edit their sources instead. Claude Code refuses edits to the route tree
(`.claude/settings.json`): a refused edit means change the source and run the command.

- `src/routeTree.gen.ts`: written by the router's Vite plugin on `pnpm dev` and `pnpm build`, from `src/routes/`.
- `pnpm-lock.yaml`: `pnpm install`, `pnpm add`, `pnpm remove`.

## Version policy

Dependencies are pinned exactly, fresh releases are quarantined for a day, and `oxfmt` (0.x) is upgraded on its own
with `pnpm check` passing. The `upgrade-deps` skill holds the full policy; load it before changing `package.json` or
`pnpm-workspace.yaml`.

## Sharp edges

- **TypeScript.** The project pins TypeScript 7.0.2, and `tsconfig.json` uses no setting only 7 knows, so
  TypeScript 6 checks it too ([ADR 0002](docs/decisions/0002-typescript-7.md)). `scripts/*.ts` run through Node's
  type stripping, so use erasable syntax only (no enums, namespaces, or constructor parameter properties). The
  TanStack Router lint plugin runs without type information under Oxlint (`pnpm-workspace.yaml` explains the peer
  rule).
- **Titles.** `index.html` has no `<title>`: the router's `HeadContent` renders each route's `head()` title, and
  React 19 moves it into `<head>`. A second `<title>` in `index.html` would win and every page would share it.

## Library docs and skills

- **TanStack Router:** run `pnpm dlx @tanstack/intent@0.4.0 list`, then
  `pnpm dlx @tanstack/intent@0.4.0 load <package>#<skill>` for the matching skill (for example,
  `@tanstack/router-core#router-core/code-splitting`). The `Load:` lines that `intent list` prints use
  `@tanstack/intent@latest`; replace `@latest` with `@0.4.0`.
- **Fallow and Playwright traces:** see [docs/agents/skills.md](docs/agents/skills.md).

## Decisions

Architecture decisions are recorded in [docs/decisions/](docs/decisions/README.md). Read the relevant ADR before
reversing a choice, for example moving the React Compiler to its Rust path or measuring Lighthouse over plain HTTP.
