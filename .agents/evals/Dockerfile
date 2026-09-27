# syntax=docker/dockerfile:1
# Base image of the agent eval (docs/agents/evals.md): this repository at /app as one fresh commit, installed,
# with Playwright's browsers. The eval tasks build on it. Build it from the repository root:
#   docker build -f .agents/evals/Dockerfile -t app-eval .
# Image pins are checked against scripts/images.ts by `pnpm ci:workflows`.
FROM node:26.10.0-slim@sha256:ec7758ee051e457b468b32bde57b0879010b325bb9862718e9615225ce4aaae1 AS node
FROM mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install --global --no-fund --no-audit "$(node -p "require('./package.json').packageManager.split('+')[0]")"
# No git yet, so `prepare` (lefthook install) runs below, once the repository exists.
RUN pnpm install --frozen-lockfile --ignore-scripts
# .agents/evals/ stays out: the hidden checks and reference solutions must not be in the agent's checkout.
COPY --exclude=.agents/evals . .
RUN git init --quiet --initial-branch=main \
 && git config user.name eval \
 && git config user.email eval@example.invalid \
 && git add --all \
 && git commit --quiet -m Baseline \
 && pnpm exec lefthook install
COPY --chmod=755 .agents/evals/grade.sh /opt/eval/grade.sh
