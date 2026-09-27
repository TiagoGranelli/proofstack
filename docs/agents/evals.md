# Agent evals

A change to `AGENTS.md`, a skill or a hook changes how coding agents work in this repository. The tasks in
`.agents/evals/tasks/` measure that: an agent gets a realistic task in a fresh container and is graded by the same
gates a human change must pass, plus hidden checks it never sees. Run them before and after a change to the agent
instructions and compare the rewards.

The tasks use the [Harbor](https://docs.harborframework.com/) task format (the harness behind Terminal-Bench), and
Harbor runs them: it builds the container, installs and runs the agent (Claude Code, Codex and others are built
in), uploads the hidden checks after the agent finishes, runs the verifier and records rewards, timings and
trajectories. It runs a paid agent, so it is not part of `pnpm check` or CI.

## Running

Needs Docker and Harbor (`uv tool install harbor`). Build the base image from the commit you want to test (it
copies the working tree, so commit or stash first), then run the tasks:

```sh
docker build -f .agents/evals/Dockerfile -t app-eval .
harbor run -p .agents/evals/tasks -a claude-code -m anthropic/<model>
harbor run -p .agents/evals/tasks/add-post-title -a codex -m openai/<model>
harbor view jobs
```

The agent reads its API key from your environment (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`); nothing in the
repository holds keys. Results go to `jobs/` (ignored by git). Check the tasks themselves without a paid agent:
`-a oracle` applies the reference solution where a task has one (reward 1), and `-a nop` does nothing (reward 0,
because the hidden checks fail on the baseline).

## How a task is built

- `.agents/evals/Dockerfile`: the base image. Playwright's Ubuntu image with Node and pnpm, the repository at `/app`
  without `.agents/evals/`, installed, as one fresh commit "Baseline" with the pre-commit hook active. The agent sees
  neither the hidden checks nor this repository's history.
- `.agents/evals/tasks/<id>/`:
  - `instruction.md`: the prompt, with acceptance criteria that name every file, export and label the hidden
    checks rely on.
  - `task.toml`: timeouts and resources (4 CPUs, 6 GB).
  - `environment/Dockerfile`: `FROM app-eval`, plus the planted bug for a bug-fix task, folded into the
    baseline commit.
  - `tests/test.sh` runs `.agents/evals/grade.sh` (in the image at `/opt/eval/grade.sh`); the other files in
    `tests/` are the hidden checks, named `<layer>.test.ts[x]`.
  - `solution/solve.sh` (optional): the reference solution for Harbor's oracle agent.
- `.agents/evals/grade.sh`, after the agent: measures the diff against the baseline, runs `pnpm check` and
  `pnpm check:drift contract migrations auth`, copies each hidden check to `tests/<layer>/eval-hidden.test.ts[x]`
  and runs it with `pnpm test:<layer>`. It writes `/logs/verifier/reward.json`: `reward` (1 when all three pass),
  `check`, `drift`, `hidden`, `files_changed`, `insertions` and `deletions`.

## Tasks

| Task | Kind | Hidden checks |
| --- | --- | --- |
| `add-post-title` | A field end to end: migration, contract, handler, SDK, UI | api: create, list, update and remove a title; 400 for empty, untrimmed and 81-character titles; the field in `openapi.json`; a migration adding the column |
| `bulk-delete-posts` | An endpoint with a new typed error | api: deletes and counts; all-or-nothing `PostsNotFound` with the offending ids in order; 400 for 0 or 51 ids; 401 without a session; the operation in `openapi.json`; the tag in `api-error.ts` |
| `add-profile-page` | A page with a form, through a Better Auth server function | component: the form's field, trimmed save, disabled blank save, failure alert; unit: the route file, the endpoint allowlist, the server function and its test stub, the a11y and keyboard suites |
| `fix-post-length-check` | A planted bug | component: a body at the limit with surrounding whitespace is not flagged, in the composer and the editor; one over still is |

The planted bug also weakens the component test that would have caught it, so `pnpm check` passes on the buggy
baseline and only the hidden checks tell a fix from no fix. Only `fix-post-length-check` has a reference solution;
the first real agent run that passes another task can become its `solution/`.

Checked on 2026-09-27 with Harbor 0.23.0: `-a oracle` on `fix-post-length-check` scored reward 1 (check, drift
and hidden 1; one file, +2 −2), and `-a nop` on all four tasks scored reward 0 with check and drift 1 and hidden 0.

## Adding a task

1. Create `.agents/evals/tasks/<id>/` with `instruction.md`, `task.toml`, `environment/Dockerfile` and `tests/test.sh`
   (copy them from a task of the same kind).
2. Write the hidden checks as `tests/<layer>.test.ts[x]` for `unit`, `api` or `component`. They import the
   layer's helpers by the path they will have in `tests/<layer>/` (`./harness.ts`, `./api-mocks.ts`), so Oxlint,
   Fallow and `tsc` skip `.agents/evals/`. Prefer HTTP through `webHandler` over the typed client, so a check does not
   depend on how the agent typed the contract.
3. Prove them: `harbor run -p .agents/evals/tasks/<id> -a nop` must score 0, and `-a oracle` 1 when you add a solution.
