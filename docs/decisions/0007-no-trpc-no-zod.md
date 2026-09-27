# 0007: No tRPC and no Zod

Status: Accepted (2026-09-26)

## Context

tRPC and Zod are common defaults for typed full-stack TypeScript. The template's promise is a published
OpenAPI contract that any client can check, not only TypeScript clients in this repo.

## Decision

Add neither. Effect Schema validates requests and describes responses. The Effect `HttpApi` produces
OpenAPI 3.1. Hey API generates the typed client and the TanStack Query options.

## Evidence

The full CRUD, auth, and validation-error flows run through the generated SDK
(`tests/integration/api.test.ts`). Hey API needs no Zod at runtime. The stack review
(`docs/stack-review.md`) found that tRPC would add only subscriptions and batching, which the example
does not need.

## Consequences

One schema language (Effect Schema) instead of two, and a contract usable from outside TypeScript.
Router search-param validation uses Effect Schema or plain functions; the TanStack skills' Zod examples
need translating.

## Revisit when

The app needs subscriptions or request batching that `HttpApi` cannot provide, or a dependency requires
Zod.
