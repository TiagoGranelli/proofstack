# Architecture decisions

Short ADRs for choices that are already reflected in the code. Before reversing one, read it and check
its revisit trigger. Add a new numbered file for each new decision, and change an ADR's status when a
later decision supersedes it.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-effect-httpapi-business-api.md) | The Effect HttpApi is the only business API, and SSR dispatches to it in-process | Accepted |
| [0002](0002-typescript-7-with-typescript-6-alias.md) | TypeScript 7 for `tsc`, with `typescript` aliased to TS 6 for Hey API | Accepted |
| [0003](0003-closed-sign-up-cli-user-creation.md) | Public sign-up is closed, and accounts are created from the CLI | Accepted (unconfirmed by owner) |
| [0004](0004-prerender-via-nitro.md) | Static pages are prerendered by Nitro, the deployment layer | Accepted |
| [0005](0005-drizzle-0-45-stable.md) | Drizzle ORM 0.45 stable, not 1.0 RC | Accepted |
| [0006](0006-react-compiler-babel-preset.md) | React Compiler runs through the stable Babel preset | Accepted |
| [0007](0007-no-trpc-no-zod.md) | No tRPC and no Zod | Accepted |
| [0008](0008-agent-skills-and-dependency-sources.md) | Pinned official skills, package-shipped docs, and on-demand source snapshots | Accepted |
| [0009](0009-unknown-server-function-id.md) | An unknown server function id gets Start's own answer until TanStack/router#8246 makes it a 404 | Accepted |
| [0010](0010-content-security-policy.md) | Content-Security-Policy without 'unsafe-inline' (nonce for SSR, hashes for prerendered pages); Trusted Types deferred | Accepted |
