# Agent evals

A change to `AGENTS.md`, a skill or a hook changes how coding agents work in this repository. `pnpm agent-eval`
measures that: it gives an agent CLI a realistic task in a throwaway checkout and grades the result with the
same gates a human change must pass, plus hidden checks the agent never sees. Run it before and after a change
to the agent instructions and compare the results.

It runs a paid agent, so it is not part of `pnpm check` or CI.

## Running

```sh
EVAL_AGENT_CMD='claude -p --permission-mode bypassPermissions "$(cat "$EVAL_PROMPT_FILE")"' pnpm agent-eval
EVAL_AGENT_CMD='codex exec --sandbox workspace-write - < "$EVAL_PROMPT_FILE"' pnpm agent-eval add-post-title
pnpm agent-eval --list          # the tasks
pnpm agent-eval --self-test     # the harness itself, with stub agents (no paid agent, about 3 minutes)
```

Options: `--agent='<command>'` instead of `EVAL_AGENT_CMD`, `--ref=<git ref>` to test another commit (default
`HEAD`; uncommitted changes are not part of the checkout), `--keep` to keep the checkout for inspection.

The agent command runs with `sh -c` in the checkout, with these variables set:

| Variable | Value |
| --- | --- |
| `EVAL_PROMPT_FILE` | The task's prompt (the Markdown after its frontmatter), in a file next to the checkout |
| `EVAL_TASK` | The task id |
| `EVAL_WORKDIR` | The checkout |
| `EVAL_SOURCE` | This repository (the stub agents of the self-test read their patches from it) |

The agent CLI reads its credentials from its own environment or login; the harness never handles keys and
redacts `key=`, `token=`, `secret=` and `password=` values from the command it records. Keep the agent's
project instructions on: `claude --bare` skips `CLAUDE.md`, skills and hooks, which is what the eval measures.
An agent run in bypass mode acts without asking, which is why the checkout is a throwaway copy outside this
repository.

## What one run does

1. **Checkout.** `git archive <ref>` without `evals/`, unpacked into a new directory under
   `EVAL_WORKDIR_ROOT` (default `~/.cache/proofstack/evals`, on disk because `pnpm install` hard-links from the
   store). The task's `setup` patch is applied (the planted bug), then `git init` and one commit, "Baseline".
   It is a new repository rather than a `git worktree`, so the agent cannot find the hidden checks, the reference
   solutions or the bug's origin in this repository's refs or history. `pnpm install --frozen-lockfile --offline`
   installs the dependencies and, through `prepare`, the pre-commit hook.
2. **Agent.** The command runs until it exits or the task's `timeout_minutes` passes.
3. **Diff.** Files, insertions and deletions against the baseline, with generated files (`src/sdk`,
   `openapi.json`, the route tree, `drizzle/meta`) counted apart.
4. **Gates.** `pnpm check` and `pnpm check:drift contract migrations auth` in the checkout.
5. **Hidden checks.** Each file `evals/checks/<task>/<layer>.test.ts[x]` is copied to
   `tests/<layer>/eval-<task>.test.ts[x]` and run with `pnpm test:<layer> eval-<task>`.
6. **Result.** The task passes when the gates and the hidden checks all pass. The record goes to
   `evals/results/<time>-<label>-<task>.json` (pass, each gate with its time, agent time and exit, diff size),
   the logs to the directory of the same name. `evals/results/` is ignored by git. The checkout is deleted unless
   `--keep`.

## Tasks

| Task | Kind | Hidden checks |
| --- | --- | --- |
| `add-post-title` | A field end to end: migration, contract, handler, SDK, UI | api: create, list, update and remove a title; 400 for empty, untrimmed and 81-character titles; the field in `openapi.json`; a migration adding the column |
| `bulk-delete-posts` | An endpoint with a new typed error | api: deletes and counts; all-or-nothing `PostsNotFound` with the offending ids in order; 400 for 0 or 51 ids; 401 without a session; the operation in `openapi.json`; the tag in `api-error.ts` |
| `add-profile-page` | A page with a form, through a Better Auth server function | component: the form's field, trimmed save, disabled blank save, failure alert; unit: the route file, the endpoint allowlist, the server function and its test stub, the a11y and keyboard suites |
| `fix-post-length-check` | A planted bug (`setup/fix-post-length-check.patch`) | component: a body at the limit with surrounding whitespace is not flagged, in the composer and the editor; one over still is |

The setup of `fix-post-length-check` also weakens the component test that would have caught the bug, so
`pnpm check` passes on the buggy baseline and only the hidden checks tell a fix from no fix.

## Adding a task

1. `evals/tasks/<id>.md`: frontmatter (`title`, `kind`, `timeout_minutes`, and for a planted bug `setup` and
   `solution`, paths relative to `evals/`), then the prompt with its acceptance criteria. Name every file,
   export and label the hidden checks rely on in the criteria: the checks may only test what the prompt promises.
2. `evals/checks/<id>/<layer>.test.ts[x]` for `unit`, `api` or `component`. They import the layer's helpers by
   the path they will have in `tests/<layer>/` (`./harness.ts`, `./api-mocks.ts`), so Oxlint, Fallow and
   `tsc` skip `evals/`. Prefer HTTP through `webHandler` over the typed client, so a check does not depend on how
   the agent typed the contract.
3. Prove the checks: they must fail on the baseline (run with `--agent=true`) and pass on a correct solution
   (`--agent='git apply "$EVAL_SOURCE/evals/solutions/<id>.patch"'` when you commit one).

## Self-test

`pnpm agent-eval --self-test` runs `fix-post-length-check` three times with stub agents and expects:

| Stub | Command | Expected |
| --- | --- | --- |
| good patch | `git apply evals/solutions/fix-post-length-check.patch` | pass |
| no-op | `true` | fail: the hidden checks fail, while `pnpm check` passes |
| bad patch | `git apply evals/stubs/bad-fix-post-length-check.patch` (a fudged limit and a hand edit of `openapi.json`) | fail: `pnpm check`, drift and the hidden checks fail |

Only `fix-post-length-check` has a committed reference solution. The hidden checks of the other tasks are proven
to fail on the baseline; the first real agent run that passes one is the reference for it.
