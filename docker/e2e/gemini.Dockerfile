# syntax=docker/dockerfile:1.6
#
# CrewRig e2e image — Gemini CLI.
#
# Inherits the base image and installs @google/gemini-cli globally under the
# agent user's npm prefix. Node 22 (provided by base) satisfies the upstream
# Node-20+ floor with margin.
FROM crewrig/e2e-base:latest

ARG GEMINI_CLI_VERSION=latest

USER agent
WORKDIR /home/agent/workspace

RUN set -eux; \
    npm install -g --no-audit --no-fund \
        "@google/gemini-cli@${GEMINI_CLI_VERSION}"; \
    npm cache clean --force; \
    gemini --version

HEALTHCHECK --interval=30s --timeout=5s --retries=2 \
  CMD gemini --version >/dev/null 2>&1 || exit 1

CMD ["gemini", "--version"]
