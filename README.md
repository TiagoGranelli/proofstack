<p align="center">
  <img src="docs/assets/banner.png" alt="Slopproof: a full-stack template where a coding agent's mistakes fail a command." width="800">
</p>

<p align="center">
  <strong>Nobody reviews 10,000 lines. Make the codebase refuse the slop instead.</strong><br>
  The rules a careful team would enforce are already checks.<br>
  Each failure tells the agent what to do instead, and it fixes the code before you read the diff.
</p>

<p align="center">
  <a href="https://github.com/TiagoGranelli/slopproof/actions/workflows/ci.yml"><img src="https://github.com/TiagoGranelli/slopproof/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/TiagoGranelli/slopproof/releases"><img src="https://img.shields.io/github/v/release/TiagoGranelli/slopproof" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
</p>

<p align="center">
  <a href="#review-is-the-bottleneck-now">Why</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#or-let-your-agent-set-it-up">Agent prompt</a> ·
  <a href="#what-gets-checked">Checks</a> ·
  <a href="#what-you-start-with">The app</a> ·
  <a href="docs/adopting.md">Adopting</a> ·
  <a href="docs/method.md">Other stacks</a>
</p>

---

## Review is the bottleneck now

Writing code stopped being the slow part. An agent writes a feature in minutes, and it fixes a bug just as fast.
The slow part is you, reading the diff.

Nobody reads a 10,000-line pull request line by line. People scroll, look at the tests and approve. Once agents
write most of your code, you have already stopped reviewing the way you used to, whether you say so or not.

So stop pretending. Reading agent output line by line does not scale, and at that volume it catches less than
you think. What you need is a reason to trust what ships without reading all of it:

- an architecture the agent cannot break without a command failing;
- tests that run the real thing: the database, five browsers, the keyboard, the security headers;
- a backup you have restored at least once, and a deploy you can roll back
  ([docs/operations.md](docs/operations.md#backups-and-restore)).

Slopproof is that, in place before the first feature. Review what the product should do and let the gates judge
how it was built. When something still gets through, fixing it is as fast as writing it was.

## See it refuse one

Ask an agent to show how many posts there are, and it writes a component that reads the database:

```tsx
// src/features/posts/components/post-count.tsx
import { count } from 'drizzle-orm'
import { db } from '#/server/db/client.ts'
import { post } from '#/server/db/schema/posts.ts'

export async function PostCount() {
  const [row] = await db.select({ total: count() }).from(post)
  return <p>{row?.total ?? 0} posts</p>
}
```

Here, `pnpm check` rejects it and says where the data should come from:

![Output of pnpm check: three lint errors saying UI code must not import the database or src/server and should go through the generated SDK, two architecture boundary violations, and a summary where lint and deadcode fail with instructions and the other twelve jobs pass](docs/assets/check-catches-db-import.png)

<sub>A real run on a scratch copy of the repository, with a few lines of pnpm and Fallow noise removed.</sub>

An agent builds the most common version it has seen, and a new project has nothing that pushes back. Rules in
a prompt or an `AGENTS.md` are suggestions: the agent can skip them, and you find out in review, if you look.
A rule that fails a command is one it cannot skip.

![Two workflows side by side. Without Slopproof: you ask, the agent writes, you review, and every mistake comes back to you (reading the database from the UI, one query per row, no test for the error case, a page never tried with a keyboard). With Slopproof: pnpm check sits between the agent and your review and sends failures back to the agent, so you review a diff that already passed architecture boundaries, query budgets, accessibility in five browsers and contract drift. Four gates run in order: a hook on every edit, pnpm check with 14 jobs in about 16 seconds, pnpm verify:app on the built app with a real Postgres, and CI with Lighthouse and an image scan.](docs/assets/with-and-without.png)

## Is it for you

It fits if:

- agents write most of your code and you can no longer read every line of it;
- you want to merge what an agent wrote because it passed, without reading all of it;
- the app will grow, and other people and other agents will keep changing it.

It does not fit if:

- you want something cheap and fast for a prototype. An agent takes substantially longer to deliver a feature
  here, because it writes the tests and has to pass every check. That time is the review you no longer do;
- you need production-stable dependencies today ([Status](#status)).

## What gets checked

Every row is something agents do when nothing stops them, and the check that stops it here.

| An agent tends to | The check |
| --- | --- |
| Read the database from a component | Architecture rules are lint errors: UI can't import the server, a feature can't import another feature |
| Change the API and forget the client | The OpenAPI document, the generated client, the server and the tests must agree, and a check regenerates the files |
| Change a table without a migration | The drift check names the missing migration and the command that creates it |
| Write a 200-line function | 20 lines per function, 80 per component, 300 per file, two levels of nesting, cognitive complexity 15 |
| Copy a block instead of sharing it | No duplicated blocks outside tests |
| Run one query per row | Each repository method has a query budget, and an N+1 fails a test that lists the statements |
| Skip the error cases | Every status the API declares must be provoked by a test |
| Never try the page with a keyboard | Axe on every page state, landmarks and tab order, in Chromium, Firefox, WebKit and two phone profiles |
| Add an inline script | The Content-Security-Policy allows no `unsafe-inline`, and a violation fails any end-to-end test |
| Ship a slow page | Lighthouse on four pages, mobile and desktop: 100 in accessibility, best practices and SEO, 95 in performance |
| Install whatever is newest | Exact pins, a one-day wait on new releases, `pnpm audit`, a license allowlist, secret and image scans |

An agent cannot quietly switch a check off: every exception is a visible edit with its reason next to it, and
changes to the check files go to a code owner.
[docs/agents/gates.md](docs/agents/gates.md) describes each check and how to make an exception.

For the agent itself: `AGENTS.md` stays under 200 lines, each multi-step workflow is a skill, and the Claude Code
settings format and lint each edited file, refuse edits to generated files and block `git commit --no-verify`.
Four eval tasks with hidden checks run in [Harbor](https://docs.harborframework.com/), so you can measure whether
a change to the instructions helps.

## What you start with

![The example app's home page in the light theme: a list of short posts by two authors, a header with the signed-in user, and a footer with a System, Light and Dark theme switch](docs/assets/app-home.png)

A working app that you change into yours:

- **Accounts.** Email and password, sign-up closed or open with email verification, password reset, a list of
  active sessions and account deletion. The login form works before the JavaScript loads.
- **An example feature.** Short posts, through every layer, so the agent has a working reference for each one.
  Delete it when you start your own.
- **The UI details agents skip.** Themes without a flash on load, a skip link, route announcements, visible
  focus, field errors that screen readers announce, and a delete confirmation that Enter alone never confirms.
- **One container to deploy.** Recipes for a single server with Docker Compose and Caddy, for Fly.io and for
  Kubernetes.

The stack is TypeScript end to end: TanStack Start, Effect, Drizzle, Postgres and Better Auth.
[docs/stack.md](docs/stack.md) says why each piece is there and what its risk is.

## Quick start

You need pnpm 12 and Docker. `pnpm install` downloads the Node version the project pins.

On GitHub, click **Use this template**. Or copy it without GitHub:

```sh
npx giget gh:TiagoGranelli/slopproof my-app
cd my-app
pnpm install && pnpm bootstrap && pnpm dev
```

`pnpm bootstrap` creates `.env` with a secret, starts Postgres and a local mail inbox in Docker, and applies the
migrations. The app runs at http://localhost:3000. Create an account with
`pnpm user:create you@example.com "Your Name"`, which asks for the password.

Renaming the app, removing the example feature and deploying are in [docs/adopting.md](docs/adopting.md).

### Or let your agent set it up

Paste this into Claude Code, Codex or another coding agent, in an empty folder, with your own name and
description in the first two lines:

```text
App name: Acme Notes
What it does: a place for a small team to keep shared notes

Start this app from the Slopproof template.

1. Copy the template into this folder with `npx giget gh:TiagoGranelli/slopproof .`, run `git init`, then
   `pnpm install && pnpm bootstrap`. It needs pnpm 12 and Docker; stop and tell me if either is missing.
2. Read AGENTS.md and docs/adopting.md before changing anything.
3. Rename the app as "Rename the app" in docs/adopting.md says, and rewrite README.md for this app. Keep the
   LICENSE notice and docs/decisions/ (the code links to those records). Clear what describes the template and
   not this app: start CHANGELOG.md again with an empty "Unreleased" section, and delete the images in
   docs/assets/ and CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md and ISSUE_TEMPLATE/ in .github/.
4. Put my GitHub user in .github/CODEOWNERS.
5. Keep the posts example for now: it is the reference for every layer. After my first feature works, remove it
   with docs/removing-the-example.md.
6. Run `pnpm check`, `pnpm check:drift` and `pnpm build && pnpm verify:app`. Fix what fails, then make the first
   commit.
7. Tell me what you changed and ask me what the first feature is.
```

After that, ask for features in plain words. The agent finds `AGENTS.md` and the skills on its own.

## Another stack

The method works outside TypeScript: [docs/method.md](docs/method.md) lists the seven steps and the tools that
do the same jobs in Python, Rails and Go. For React and TypeScript on another stack, the
[`minimal`](https://github.com/TiagoGranelli/slopproof/tree/minimal) branch has only the gates.

## Status

The first release is [0.1.0](CHANGELOG.md). CI runs every job in `pnpm check`, the drift checks against Postgres,
the integration and end-to-end tests in five browser projects, contract coverage, Lighthouse, and the Docker
image build and scan.

Some dependencies are pre-release: Nitro 3 is a beta, Hey API is a `next` snapshot and TanStack Start still calls
itself a release candidate. The project runs on TypeScript 7 and Node 26. Upgrades are pinned and gated, one per
pull request, but expect some to need work.

The agent evals run with Harbor, but results from real agents are not published yet.

No set of checks proves that code is correct, and neither does a tired reviewer on page 40 of a diff. The gates
catch whole classes of mistakes every time, and what gets past them is cheap to fix.

## Docs

| | |
| --- | --- |
| [docs/adopting.md](docs/adopting.md) | From "Use this template" to your own deployed app, and taking template updates later |
| [AGENTS.md](AGENTS.md) | The architecture map and the rules that agents and people follow |
| [docs/agents/gates.md](docs/agents/gates.md) | What each check covers and how to make an exception |
| [docs/agents/evals.md](docs/agents/evals.md) | Running the agent evals |
| [docs/operations.md](docs/operations.md) | Configuration, deployment and security |
| [docs/decisions/](docs/decisions/README.md) | Architecture decisions |

Contributions are welcome: [CONTRIBUTING.md](.github/CONTRIBUTING.md). Security reports go through
[SECURITY.md](.github/SECURITY.md). Everyone taking part follows the [Code of Conduct](.github/CODE_OF_CONDUCT.md).

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.png">
    <img src="docs/assets/logo.png" alt="" width="72">
  </picture>
  <br>
  MIT license.
</p>
