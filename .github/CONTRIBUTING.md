# Contributing

Thanks for helping. This file covers changes to the template itself. If you are building an app from it,
see [docs/adopting.md](../docs/adopting.md) instead.

## Before you start

- For a bug, open an issue with the steps to reproduce it (the bug template asks for what we need).
- For a feature or a change to a gate, open an issue first. The template stays small on purpose, and a new
  dependency or a looser gate needs a reason that holds for most adopters.
- Security problems go through a private advisory, never an issue: see [SECURITY.md](SECURITY.md).

## Making a change

Set up as in the [README](../README.md#quick-start). [AGENTS.md](../AGENTS.md) has the architecture, the
workflows and the rules; it is written for coding agents and applies to people as well.

- Keep one change per pull request, and commit in logical steps.
- Generated files (`openapi.json`, `src/sdk/`, `src/routeTree.gen.ts`, `drizzle/`) are regenerated, never
  edited by hand, and committed with their source.
- Keep example code in posts-named files where you can, so the `minimal` branch (below) merges cleanly.
- Keep the app's name out of code: import `APP_NAME` or `pageTitle` from `src/config/app.ts` and use neutral
  identifiers (`tests/unit/repo-policy.test.ts` checks).
- Every exception to a gate is a visible edit next to its reason.

Before you open the pull request, run:

```sh
pnpm check                       # also run by the pre-commit hook
pnpm check:drift                 # contract, migrations, auth, database
pnpm build && pnpm verify:app    # for contract, database, auth or UI changes; needs Mailpit (pnpm mail:up)
```

`pnpm ci:local` runs every CI job in containers if you want the full picture without GitHub.

## The minimal branch

`minimal` is `main` without the posts example, for adopters who start without it
([docs/minimal-branch.md](../docs/minimal-branch.md) lists exactly what it removes and adds). Pull requests go
to `main`; maintainers bring each change over by merging:

```sh
git switch minimal
git merge main
```

Resolve conflicts by keeping `minimal`'s side wherever the example was removed, and carry over what the change
adds to shared code. A new example-only file is deleted on `minimal`; a change to shared code that the example
also touches may need the edit described in docs/minimal-branch.md. CI runs on pushes to both branches
(`pnpm check`, `pnpm check:drift`, `pnpm verify:app`, the rest), so push the merge and let it run before a
release. Tag releases on `main`; `minimal` follows the same versions.

## Changelog

Add a line under `## [Unreleased]` in [CHANGELOG.md](../CHANGELOG.md) for anything an adopter would notice. If
adopters must do something when they take your change (run a command, edit a file, apply a migration by
hand), write it under an `### Upgrade notes` heading in the same section.

## Releases

Maintainers release by tag:

1. Move the `## [Unreleased]` entries under `## [X.Y.Z] - YYYY-MM-DD`, keep an empty `## [Unreleased]` above
   it, and make sure the upgrade notes are complete.
2. Set `"version": "X.Y.Z"` in `package.json`.
3. Commit both, then tag and push the tag:

   ```sh
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

The release workflow (`.github/workflows/release.yml`) checks that `package.json` and CHANGELOG.md have the
version and publishes the GitHub Release with that CHANGELOG section as its notes. It can also be run by
hand for an existing tag.

The repository has "Template repository" turned on in its settings, so "Use this template" is available.

## Conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
