# syntax=docker/dockerfile:1.6
#
# CrewRig e2e image — MemPalace sidecar.
#
# One-shot admin container. The CLI containers do NOT embed MemPalace; they
# talk to the sidecar's storage indirectly via a shared bind-mount at
# /home/agent/.mempalace. The sidecar is invoked on demand for assertions
# (`mempalace status`, search queries) and teardown reporting.
#
# Pin matches the `install-mempalace` task in Taskfile.yml.
FROM crewrig/e2e-base:latest

ARG MEMPALACE_VERSION=">=3.3.3,<3.4"

USER agent
WORKDIR /home/agent/workspace

RUN set -eux; \
    pipx install "mempalace${MEMPALACE_VERSION}"; \
    mempalace --version

HEALTHCHECK --interval=30s --timeout=5s --retries=2 \
  CMD mempalace --version >/dev/null 2>&1 || exit 1

CMD ["mempalace", "--version"]
