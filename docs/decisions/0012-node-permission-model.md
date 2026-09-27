# 0012: The production server runs under Node's permission model

Status: Accepted (2026-09-27)

## Context

The server process needs to read its own bundle (`.output/`) and to use the network: it listens for HTTP,
connects to Postgres and to the SMTP server, and resolves their names. It writes no files, starts no child
processes or workers, and loads no native addons. The image already runs as the unprivileged `node` user with
the application files owned by root, so the process cannot change its code; it can still read everything the
`node` user can read (`/etc`, mounted secrets) and write to
`/tmp`, and a dependency or an injected payload could start `sh`.

Node's [permission model](https://nodejs.org/api/permissions.html) (`--permission`, stable since Node 23.5 and
22.13) denies file system access, network access, child processes, worker threads, native addons, WASI and the
inspector unless a flag allows them. In Node 26, `--allow-net` is still marked experimental and prints an
`ExperimentalWarning` at startup. The model restricts what the JavaScript APIs can do. It is not a sandbox
against native code, symbolic links inside an allowed path are followed outside it, and file descriptors that
are already open bypass it (the Node documentation lists these limitations).

## Decision

The Dockerfile starts the server with

```
node --permission --allow-fs-read=/app/.output --allow-net --disable-warning=ExperimentalWarning .output/server/index.mjs
```

`--disable-warning=ExperimentalWarning` suppresses the one warning `--allow-net` prints at startup, which would
be the only line in the log that is not JSON. `scripts/app-server.ts` starts the servers of `verify:app` and
`lighthouse` with the same flags, so every test runs the server as the image does, and the server logs
`permissionModel: true` in its `starting` line, which `verify:app` and `pnpm ci:docker` check.

The one-shot commands (`node .output/migrate.mjs`, `node .output/create-user.mjs`) run without the model: the
migrator reads `drizzle/`, and an operator runs both by hand.

## Evidence

- `pnpm verify:app` (all runners, chromium and firefox): the `db`, integration and E2E suites pass against
  servers under the model. That covers SSR and prerendered pages, the static assets, the API, sign-up and
  sign-in, sessions, the rate limits, account email through SMTP to Mailpit (the E2E tests read the links),
  the graceful shutdown with its drain check, and the database-failure test. No `ERR_ACCESS_DENIED` in any
  server log.
- `pnpm ci:docker`: the image (Node 26.10) passes migrations through PgBouncer, pages through the edge, a
  sign-in and the graceful stop with the flags in its `CMD`, and its log says `permissionModel: true`.
- Without `--allow-net`, the server does not start: srvx's `listen` fails with `ERR_ACCESS_DENIED`
  (`permission: 'Net'`), so the flags are in force, not ignored.

## Consequences

- Terminating TLS in Node (`NITRO_SSL_CERT` and `NITRO_SSL_KEY` as file paths) needs read access to those
  files: add `--allow-fs-read=<path>` for each, or pass the PEM text in the variables instead.
- A dependency that starts writing files, spawning processes or using worker threads fails with
  `ERR_ACCESS_DENIED` in `verify:app` before it reaches production. Allow the narrowest thing
  (`--allow-fs-write=<dir>`, `--allow-worker`) in both the Dockerfile and `scripts/app-server.ts`, and say why
  here.
- Running `.output/server/index.mjs` without the flags (`pnpm start`, another platform's start command) still
  works; it only drops the restriction.

## Revisit when

`--allow-net` becomes stable (then drop `--disable-warning`), or Node adds finer network permissions (hosts
and ports), which would let the server reach only Postgres and the SMTP host.
