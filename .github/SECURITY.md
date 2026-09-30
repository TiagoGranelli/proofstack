# Security policy

## Reporting a vulnerability

Report it privately through GitHub: on this repository, open the Security tab and choose "Report a
vulnerability" ([GitHub's guide](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)).
Please do not open a public issue or pull request for it.

Include what you found, the version or commit, and the steps that show it. A minimal proof of concept helps more
than a scanner report.

What to expect:

- An acknowledgement within a week.
- An assessment, and a fix or a mitigation plan, discussed in the private advisory.
- Credit in the advisory when the fix is released, unless you prefer otherwise.

## Scope

In scope: the code and configuration in this repository and their defaults, including the ones that guard the supply
chain and the agent (the pnpm policies in `pnpm-workspace.yaml`, the Claude Code settings in `.claude/settings.json`,
the CI workflow and its scripts, the secret-scan rules).

Out of scope: vulnerabilities in dependencies that this repository does not make exploitable (report them
upstream; `pnpm audit:check` tracks them here), and projects that copied these files, which belong to their owners.

## Supported versions

Fixes land on `main` and are ported to `minimal` (see [CONTRIBUTING.md](CONTRIBUTING.md#where-a-change-goes)).
