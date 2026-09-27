# Dependency sources for agents

Recommendation (2026-09-27): **commit no vendored sources for now.** `repos/` is ignored through
`repos/.gitignore`. When upstream code or docs would help, fetch a filtered snapshot on demand with
`scripts/vendor-source.ts`.

## What agents already have

- `node_modules/effect`: `src/` (20 MB, the exact version), `AGENTS.md`, and `ai-docs/`.
- `@tanstack/react-start`, `router-core`, `router-plugin`, and `start-*-core`: `src/` and 22 skills
  (21 in the Start and Router core packages plus 1 in `router-plugin`; see [skills.md](skills.md)).
- `better-auth` and `@hey-api/openapi-ts`: compiled `dist/` only. It is readable, but it has no docs
  and no tests.

## Measured snapshots (presets in `scripts/vendor-source.ts`)

| Preset | Upstream (license) | Ref and commit | Full tree at ref | Tarball download | Snapshot | Adds beyond `node_modules` |
| --- | --- | --- | --- | --- | --- | --- |
| `effect` | Effect-TS/effect (MIT) | `effect@4.0.0-rc.117`, `14a3f140095f` | 4,153 files, 42.7 MB | 8.1 MB | 97 files, 1.61 MB | HttpApi, Http, and Schema tests as usage examples |
| `tanstack-start` | TanStack/router (MIT) | `@tanstack/react-start@1.168.58`, `ddad69a4a4b1` | 12,214 files, 44.0 MB | 18.8 MB | 166 files, 1.06 MB | Start (React) and Router prose docs |
| `better-auth` | better-auth/better-auth (MIT) | `v1.7.6`, `229a02a65218` | 2,311 files, 47.8 MB | 28.5 MB | 198 files, 1.85 MB | Docs for options, plugins, and adapters |
| `hey-api` | hey-api/openapi-ts (MIT) | `@hey-api/openapi-ts@0.99.0`, `c9dc0b94b0bf` | 6,815 files, 77.0 MB | 23.0 MB | 608 files, 1.75 MB | Plugin sources and the TanStack Query example |

A test of the custom `--repo/--ref/--path` form fetched `packages/openapi-ts` at the same tag: 587 files,
2.02 MB, about 4 s. It ran under a 256 MB memory cap, and 40 of 40 sampled files matched upstream git blob
hashes. All test snapshots were deleted afterwards.

## Why nothing is committed

- Real utility is occasional. Effect and TanStack sources are already in `node_modules` at the lockfile
  version. The Better Auth and Hey API docs and sources help in specific cases, and fetching one takes
  seconds.
- Committed copies must be regenerated in every PR that bumps the dependency, or they describe the wrong
  version. Effect and Start are RC releases with weekly updates.
- Everyone who clones the template would inherit about 6 MB of third-party files and the exclusions they
  require.

Revisit this if agents need sources in sandboxes without `gh` or network access, or if a package stops
publishing `src/`.

## Usage

```sh
node scripts/vendor-source.ts effect            # ref derived from node_modules/effect/package.json
node scripts/vendor-source.ts hey-api --ref @hey-api/openapi-ts@0.99.0
node scripts/vendor-source.ts my-name --repo owner/repo --ref <tag|sha> --path sub/dir [--path other/dir]
```

The script resolves the ref to a commit and streams `gh api repos/<o>/<r>/tarball/<sha>` through a
Node tar reader without cloning. It extracts only the listed paths plus the root license. When the
tarball header records a commit (the pax global header that `git archive` writes), the script checks
that it matches the resolved commit and aborts otherwise; without that header the commit is not
verified. It aborts beyond `--max-download-mb` (default 200) or `--max-extract-mb` (default 30), and
writes `repos/<name>/UPSTREAM.md` with the repo, ref, commit, license, paths, size, date, and command.
It warns when a repo declares no license.

Snapshots are reference material. Read them, and regenerate them instead of editing. Nothing imports,
lints, formats, or typechecks `repos/**`.

## Subtree or snapshot

The Effect blog post ("the one weird git trick") recommends `git subtree add --squash` into `repos/`,
with an AGENTS.md section that marks it read-only and excluded from tooling. This repo keeps that layout
and those rules, but uses filtered snapshots:

| | `git subtree --squash` | Filtered snapshot (this script) |
| --- | --- | --- |
| Prerequisite | An existing commit. This repo has none yet. | None |
| Transfer | Fetches the upstream ref and its objects (GitHub repo sizes: Effect 135 MB, TanStack Router 112 MB, Better Auth 158 MB, Hey API 107 MB), then squashes | One tarball of 8–29 MB, streamed and never kept |
| Working tree | The whole upstream tree (42–77 MB), because subtree cannot filter subpaths | Only the listed paths (1–2 MB) |
| Updates | `git subtree pull --squash` creates merge commits | Rerun the command, and review the diff if committed |
| Provenance | Commit message (`git-subtree-split: <sha>`) | `UPSTREAM.md`, with the ref derived from the lockfile |
| History and blame | The squash hides it anyway | None (use GitHub) |

After the first commit exists, there are two ways to keep a source in git:

1. **Recommended, committed snapshot:** add `!<name>/` and `!<name>/**` to `repos/.gitignore`, run
   `node scripts/vendor-source.ts <name>`, and commit `repos/<name>` together with its `UPSTREAM.md`.
   Rerun it in each PR that bumps the dependency.
2. **Subtree, only if you want git-native updates for a whole repo:**
   `git subtree add --prefix=repos/effect https://github.com/Effect-TS/effect effect@4.0.0-rc.117 --squash`.
   Run it under a memory cap, and add `!effect/` and `!effect/**` to `repos/.gitignore` first.
