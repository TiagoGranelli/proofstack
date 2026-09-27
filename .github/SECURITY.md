# Security policy

## Reporting a vulnerability

Report it privately through GitHub: on this repository, open the Security tab and choose "Report a
vulnerability" ([GitHub's guide](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)).
Please do not open a public issue or pull request for it.

Include what you found, the version or commit, and the steps or request that show it. A minimal proof of
concept helps more than a scanner report.

What to expect:

- An acknowledgement within a week.
- An assessment, and a fix or a mitigation plan, discussed in the private advisory.
- Credit in the advisory and the CHANGELOG when the fix is released, unless you prefer otherwise.

## Scope

In scope: the code in this repository and its defaults, including the configuration it ships
(Content-Security-Policy, CSRF check, Better Auth settings and the endpoint allowlist, rate limits, the
Docker image and the Caddy edge configuration).

Out of scope: vulnerabilities in dependencies that this repository does not make exploitable (report them
upstream; `pnpm audit:check` tracks them here), and apps built from the template, which belong to their
owners.

## Supported versions

Fixes land on `main` and in the next release. Repositories created from the template take them as
described in [docs/adopting.md](../docs/adopting.md#staying-current).

## Security design

[docs/operations.md](../docs/operations.md) describes the security settings, and the tests in
`tests/integration/` and `tests/e2e/csp.spec.ts` check them against the running app.
