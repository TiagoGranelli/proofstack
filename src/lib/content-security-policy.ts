type Sources = { script: readonly string[]; style: readonly string[] }

/**
 * The Content-Security-Policy headers of every HTML document the app serves. Two callers fill in the sources:
 * - SSR pages: the root route's `headers` (src/routes/__root.tsx) with the per-request nonce that
 *   src/router.tsx creates (`nonceSources`). The router stamps it on every script, style and preload it renders.
 * - Prerendered pages: the `prerender:generate` hook in vite.config.ts with the sha256 hashes of the
 *   page's inline scripts and styles, emitted as a Nitro route rule header.
 * Neither allows 'unsafe-inline'. src/server/nitro/http.ts adds `upgrade-insecure-requests` over https
 * and a locked-down policy for responses that set none (JSON, static files, Nitro error responses).
 */
export const documentHeaders = (sources: Sources): { 'content-security-policy': string } => ({
  'content-security-policy': [
    "default-src 'self'",
    `script-src ${["'self'", ...sources.script].join(' ')}`,
    `style-src ${["'self'", ...sources.style].join(' ')}`,
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // No Trusted Types directives yet: see ADR 0010.
  ].join('; '),
})

/**
 * SSR sources for one request. 'strict-dynamic' lets the nonced entry module load its imports and route
 * chunks (module descendants inherit the nonce; tests/e2e/csp.spec.ts navigates every route to prove it);
 * 'self' is only a fallback for browsers without CSP3.
 */
export const nonceSources = (nonce: string): Sources => ({
  script: [`'nonce-${nonce}'`, "'strict-dynamic'"],
  style: [`'nonce-${nonce}'`],
})
