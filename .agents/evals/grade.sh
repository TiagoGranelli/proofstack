#!/usr/bin/env bash
# Harbor verifier shared by the eval tasks (docs/agents/evals.md); each task's tests/test.sh runs it after the
# agent. Grades /app with the repo's gates and the task's hidden checks (/tests/<layer>.test.ts[x], copied into
# tests/<layer>/), and writes one metric per gate plus the diff size to /logs/verifier/reward.json.
set -uo pipefail
cd /app
logs=/logs/verifier
git add --all
read -r files insertions deletions < <(git diff --cached --numstat HEAD | awk '{f++; i+=$1; d+=$2} END {print f+0, i+0, d+0}')

pnpm check >"$logs/check.log" 2>&1 && check=1 || check=0
pnpm check:drift contract migrations auth >"$logs/drift.log" 2>&1 && drift=1 || drift=0
hidden=1
for test in /tests/*.test.ts /tests/*.test.tsx; do
  [ -e "$test" ] || continue
  name=$(basename "$test")
  cp "$test" "tests/${name%%.*}/eval-hidden.${name#*.}"
  pnpm "test:${name%%.*}" eval-hidden >>"$logs/hidden.log" 2>&1 || hidden=0
done

printf '{"reward": %d, "check": %d, "drift": %d, "hidden": %d, "files_changed": %d, "insertions": %d, "deletions": %d}\n' \
  $((check * drift * hidden)) "$check" "$drift" "$hidden" "$files" "$insertions" "$deletions" >"$logs/reward.json"
