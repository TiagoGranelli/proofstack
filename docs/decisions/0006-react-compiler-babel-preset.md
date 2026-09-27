# 0006: React Compiler through the stable Babel preset

Status: Accepted (2026-09-26)

## Context

`@vitejs/plugin-react` 6 offers two React Compiler paths. The native Rust one (`react({ compiler: true })`
with `oxc-transform-react`) is marked "experimental" in its README. The other is the Babel preset
`reactCompilerPreset()` run by `@rolldown/plugin-babel`.

## Decision

Use `babel({ presets: [reactCompilerPreset()] })` with `babel-plugin-react-compiler@1.0.0`,
`@babel/core@8`, and `@rolldown/plugin-babel`.

## Evidence

The plugin's README documents this path. `pnpm build` and the E2E hydration tests pass with it.

## Consequences

Builds are slower than with the Rust path, because of the Babel pass on React files. Oxlint's native
React Compiler rules still provide lint feedback.

## Revisit when

The Rust compiler path in `@vitejs/plugin-react` is no longer marked experimental.
