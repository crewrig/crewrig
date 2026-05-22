# syntax=docker/dockerfile:1.6
#
# CrewRig e2e base image.
#
# Shared substrate for the per-CLI e2e images (claude, gemini, copilot) and
# the MemPalace sidecar. Ships:
#   - debian:bookworm-slim (glibc, broad apt coverage)
#   - Node.js 22 LTS via NodeSource (required floor for @github/copilot)
#   - python3 + pipx (for the MemPalace sidecar layer)
#   - gh (GitHub CLI, via the official apt repo)
#   - jq, yq (mikefarah Go binary — supports TOML via `-p toml`)
#   - ollama client (via the official install script)
#   - non-root `agent` user (uid/gid 1000)
#   - pre-created mount points for ~/.claude, ~/.gemini, ~/.copilot, ~/.mempalace
#
# See docs/adr/0001-e2e-docker-images.md for the design rationale.
FROM debian:bookworm-slim

ARG DEBIAN_FRONTEND=noninteractive
ARG NODE_MAJOR=22
ARG YQ_VERSION=v4.44.3

# Reproducible build environment.
ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIPX_HOME=/home/agent/.local/pipx \
    PIPX_BIN_DIR=/home/agent/.local/bin \
    NPM_CONFIG_PREFIX=/home/agent/.npm-global \
    PATH=/home/agent/.npm-global/bin:/home/agent/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Single RUN layer for the OS packages so we can apt-get clean in-place.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg \
        git bash coreutils jq \
        passwd \
        python3 python3-venv pipx \
        unzip xz-utils zstd; \
    # NodeSource: Node.js 22 LTS
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -; \
    apt-get install -y --no-install-recommends nodejs; \
    # GitHub CLI: official apt repo
    mkdir -p -m 755 /etc/apt/keyrings; \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null; \
    chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg; \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends gh; \
    # mikefarah yq (Go binary — TOML support via `-p toml`)
    arch="$(dpkg --print-architecture)"; \
    curl -fsSL "https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/yq_linux_${arch}" \
      -o /usr/local/bin/yq; \
    chmod +x /usr/local/bin/yq; \
    # Ollama client (official install script — Debian apt does not ship ollama).
    # Pinned strategy (sha256 of install.sh) is deferred per ADR open risk #3.
    # The install ships a 3.5 GB lib/ollama tree with CUDA/ROCm runtimes we do
    # not need (the e2e harness routes via Ollama Cloud, no local GPU server).
    # Strip the runtime bundles to keep the image inside its weight budget.
    curl -fsSL https://ollama.com/install.sh | sh; \
    rm -rf /usr/local/lib/ollama; \
    # Cleanup
    apt-get purge -y --auto-remove gnupg; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Non-root user. uid/gid 1000 matches typical Linux dev hosts; Docker Desktop
# reconciles ownership transparently on macOS.
RUN set -eux; \
    groupadd --gid 1000 agent; \
    useradd  --uid 1000 --gid 1000 --create-home --shell /bin/bash agent; \
    install -d -o agent -g agent -m 0755 \
        /home/agent/workspace \
        /home/agent/.claude \
        /home/agent/.gemini \
        /home/agent/.copilot \
        /home/agent/.mempalace \
        /home/agent/.npm-global \
        /home/agent/.local \
        /home/agent/.local/bin \
        /home/agent/.local/pipx

USER agent
WORKDIR /home/agent/workspace

# Sanity check: every base tool resolves on PATH.
RUN set -eux; \
    node --version; \
    npm  --version; \
    python3 --version; \
    pipx --version; \
    gh   --version; \
    jq   --version; \
    yq   --version; \
    ollama --version || true

CMD ["/bin/bash"]
