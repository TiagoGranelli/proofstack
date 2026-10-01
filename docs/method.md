# The method, in any stack

The code in this repository is TypeScript, but the method works in any stack:

1. Give the API one source of truth and generate the rest from it. A check regenerates the files and fails if
   anything changed.
2. Write each rule the agent must follow as a lint rule or a test, and make its message say what to do instead.
   An agent can skip a rule that only lives in a Markdown file.
3. Put numbers on size and complexity. Agents write long functions unless something fails.
4. Test what review tends to miss: queries per request, accessibility, CSP violations, page performance.
5. Keep one fast command for all of it, run it on every commit, and have CI run the same thing.
6. Keep the agent instructions short and point them at the checks. Put multi-step workflows in skills.
7. Measure changes to the instructions with tasks that have hidden tests.

## Tools that do the same jobs elsewhere

| Stack | Lint and types | Boundaries | Query budgets |
| --- | --- | --- | --- |
| Python | Ruff, Pyright | import-linter | pytest-django's `django_assert_num_queries` |
| Rails | RuboCop | Packwerk | Prosopite or Bullet |
| Go | golangci-lint | depguard | |

[AGENTS.md](../AGENTS.md) and [agents/gates.md](agents/gates.md) show how each check is set up here, which is the
part worth copying.

## React and TypeScript on another stack

The [`minimal`](https://github.com/TiagoGranelli/slopproof/tree/minimal) branch has only the gates, on a small
client-side app with TanStack Router and Tailwind, and lists the files to copy for each one. It assumes React 19
with the React Compiler and TypeScript 6 or 7.
