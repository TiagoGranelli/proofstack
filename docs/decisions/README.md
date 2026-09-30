# Architecture decisions

Short ADRs for choices that are already reflected in the code. Before reversing one, read it and check
its revisit trigger. Add a new numbered file for each new decision, and change an ADR's status when a
later decision supersedes it. Numbers match `main`, where the other ADRs live; the ones here were amended for the
`minimal` branch where their reasons differ.

| ADR | Decision | Status |
| --- | --- | --- |
| [0002](0002-typescript-7.md) | TypeScript 7, with a configuration TypeScript 6 also accepts | Accepted |
| [0006](0006-react-compiler-babel-preset.md) | React Compiler runs through the stable Babel preset | Accepted |
| [0011](0011-lighthouse-over-https-http2.md) | Lighthouse measures the production build over HTTPS and HTTP/2 | Accepted |
