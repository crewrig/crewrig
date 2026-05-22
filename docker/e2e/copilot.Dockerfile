# syntax=docker/dockerfile:1.6
#
# CrewRig e2e image — GitHub Copilot CLI.
#
# Inherits the base image and installs @github/copilot globally under the
# agent user's npm prefix. This is the canonical Copilot CLI package; the
# legacy `gh extension install github/gh-copilot` path is retired.
#
# Headless auth (device-flow credential persistence) is intentionally NOT
# validated here — that surface is owned by issue #77.
FROM crewrig/e2e-base:latest

ARG COPILOT_CLI_VERSION=latest

USER agent
WORKDIR /home/agent/workspace

RUN set -eux; \
    npm install -g --no-audit --no-fund \
        "@github/copilot@${COPILOT_CLI_VERSION}"; \
    npm cache clean --force; \
    copilot --version

HEALTHCHECK --interval=30s --timeout=5s --retries=2 \
  CMD copilot --version >/dev/null 2>&1 || exit 1

CMD ["copilot", "--version"]
