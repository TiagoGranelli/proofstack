# Dependency sources for agents

This repository commits no vendored sources. `.repos/` is ignored through
`.repos/.gitignore`. When upstream code or docs would help, fetch a filtered snapshot on demand with a partial,
sparse git clone (below).

## What agents already have

- `node_modules/effect`: `src/` (20 MB, the exact version), `AGENTS.md`, and `ai-docs/`.
- `@tanstack/react-start`, `router-core`, `router-plugin`, and `start-*-core`: `src/` and 22 skills
  (21 in the Start and Router core packages plus 1 in `router-plugin`; see [skills.md](skills.md)).
- `better-auth` and `@hey-api/openapi-ts`: compiled `dist/` only. It is readable, but it has no docs
  and no tests.

## Fetching a snapshot

A blobless (`--filter=blob:none`), shallow clone downloads only the tree of one commit, and the sparse
checkout then fetches the blobs of the listed paths alone. For Better Auth that is about 1 MB instead of the 28.5 MB
tarball of the whole tree:

```sh
name=better-auth repo=better-auth/better-auth
tag=v$(node -p "require('./node_modules/better-auth/package.json').version")   # the installed version
git clone --filter=blob:none --no-checkout --depth 1 --branch "$tag" "https://github.com/$repo" ".repos/$name"
git -C ".repos/$name" sparse-checkout set --no-cone /docs/content/docs/ /LICENSE.md
git -C ".repos/$name" checkout
git -C ".repos/$name" rev-parse HEAD   # provenance: the commit the snapshot shows
```

To refresh after a dependency bump, delete `.repos/<name>` and clone again. The presets, measured on 2026-09-27
at the installed versions (snapshot: files and size of the checked-out tree; transfer: size of `.git`):

| Name | Repo (license) | Tag (`<v>`: the installed version) | Sparse paths | Commit | Snapshot | Transfer | Adds beyond `node_modules` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `effect` | Effect-TS/effect (MIT) | `effect@<v>` of `effect` | `/packages/effect/test/httpapi/ /packages/effect/test/http/ /packages/effect/test/schema/ /LICENSE` | `14a3f140095f` | 97 files, 1.6 MB | 0.9 MB | HttpApi, Http, and Schema tests as usage examples |
| `tanstack-start` | TanStack/router (MIT) | `@tanstack/react-start@<v>` | `/docs/start/framework/react/ /docs/router/guide/ /docs/router/routing/ /docs/router/api/ /LICENSE` | `ddad69a4a4b1` | 166 files, 1.1 MB | 2.6 MB | Start (React) and Router prose docs |
| `better-auth` | better-auth/better-auth (MIT) | `v<v>` of `better-auth` | `/docs/content/docs/ /LICENSE.md` | `229a02a65218` | 198 files, 1.9 MB | 1.0 MB | Docs for options, plugins, and adapters |
| `hey-api` | hey-api/openapi-ts (MIT) | `@hey-api/openapi-ts@0.99.0` (the installed `next` snapshot has no tag) | `/packages/openapi-ts/src/ /examples/openapi-ts-tanstack-react-query/ /LICENSE` | `c9dc0b94b0bf` | 607 files, 1.8 MB | 1.7 MB | Plugin sources and the TanStack Query example |

Check the license of any other repository first (`gh api repos/<owner>/<repo>/license --jq .license.spdx_id`); a
repo without one stays local and is never committed.

Snapshots are reference material. Read them, and fetch them again instead of editing. Nothing imports, lints,
formats, or typechecks `.repos/**`.

## Why nothing is committed

- Real utility is occasional. Effect and TanStack sources are already in `node_modules` at the lockfile
  version. The Better Auth and Hey API docs and sources help in specific cases, and fetching one takes
  seconds.
- Committed copies must be regenerated in every PR that bumps the dependency, or they describe the wrong
  version. Start is an RC release with weekly updates.
- Everyone who clones the template would inherit about 6 MB of third-party files and the exclusions they
  require.

Committing a snapshot makes sense when agents need sources in sandboxes without network access, or when a package
stops publishing `src/`.

## Subtree or sparse clone

The Effect blog post ("the one weird git trick") recommends `git subtree add --squash` into `.repos/`, with an
AGENTS.md section that marks it read-only and excluded from tooling. This repo keeps that layout and those
rules, but uses sparse clones: a subtree fetches the upstream ref and its objects (GitHub repo sizes: Effect
135 MB, TanStack Router 112 MB, Better Auth 158 MB, Hey API 107 MB) and checks out the whole tree (42–77 MB),
because it cannot filter subpaths. Its updates are merge commits.

To keep a source in git anyway:

1. **Recommended, committed snapshot:** add `!<name>/` and `!<name>/**` to `.repos/.gitignore`, fetch it as
   above, delete `.repos/<name>/.git` (git would otherwise record a nested repository), and commit
   `.repos/<name>` with the repo, tag and commit in the message. Refresh it in each PR that bumps the
   dependency.
2. **Subtree, only if you want git-native updates for a whole repo:**
   `git subtree add --prefix=.repos/effect https://github.com/Effect-TS/effect effect@4.0.0 --squash`.
   Run it under a memory cap, and add `!effect/` and `!effect/**` to `.repos/.gitignore` first.
