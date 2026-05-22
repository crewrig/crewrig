# syntax=docker/dockerfile:1.6
#
# CrewRig e2e image — Claude Code CLI.
#
# Inherits the base image and installs @anthropic-ai/claude-code globally
# under the agent user's npm prefix. Version floats by default; pin via
# `--build-arg CLAUDE_CODE_VERSION=x.y.z` for reproducible builds, then
# capture the resolved version into docker/e2e/.versions.lock.
FROM crewrig/e2e-base:latest

ARG CLAUDE_CODE_VERSION=latest

USER agent
WORKDIR /home/agent/workspace

RUN set -eux; \
    npm install -g --no-audit --no-fund \
        "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"; \
    npm cache clean --force; \
    claude --version

HEALTHCHECK --interval=30s --timeout=5s --retries=2 \
  CMD claude --version >/dev/null 2>&1 || exit 1

CMD ["claude", "--version"]
