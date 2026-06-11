# ADR 0001 — e2e Docker images (base + per-CLI + MemPalace sidecar)

## Status

Proposed — 2026-05-22. Scoped to issue #76 (child of epic #75).

## Context

CrewRig currently validates itself through unit and build-drift tests
(`scripts/tests/`, `scripts/test-build-components.sh`). Epic #75
introduces an end-to-end framework that runs **real CLI agents**
(claude-code, gemini-cli, github-copilot-cli) inside containers against
scripted scenarios. Issue #76 is the foundation layer: a shared base
image, three CLI-specific images, and a MemPalace sidecar.

The images must be reproducible, lean (≤500 MB base / ≤800 MB per-CLI
compressed), runnable as non-root, and support a shared MemPalace volume
for the cross-tool-memory pillar.

## Decision 1 — Base image: **Debian 12 (`debian:bookworm-slim`)**

Recommended over Alpine and Ubuntu.

| Candidate | Verdict | Rationale |
|---|---|---|
| **`debian:bookworm-slim`** | **Selected** | glibc; broad apt coverage for `git`, `gh`, `jq`, `yq`, `python3`, `pipx`; first-class Node LTS via NodeSource; ~80 MB before tooling. |
| `alpine:3.19` | Rejected | musl breaks several Node native modules and is a known footgun for `claude-code` and `gemini-cli` (both ship native bindings). Saving ~50 MB is not worth the parity risk for an e2e harness whose job is to surface real-world bugs. |
| `ubuntu:24.04` | Rejected | Same glibc benefits as Debian but ~30 MB heavier and pulls snap-related layers we never use. |

The base also pins `node:22` (required by `@github/copilot` per its
npm page) and Python 3.11 (bookworm default), which satisfies both
the highest Node floor (Copilot CLI = 22+) and `pipx` requirements.

## Decision 2 — Layering strategy

```text
debian:bookworm-slim
  └── base.Dockerfile        # OS pkgs + Node 22 + pipx + gh + ollama + agent user
        ├── claude.Dockerfile      # + @anthropic-ai/claude-code
        ├── gemini.Dockerfile      # + @google/gemini-cli
        ├── copilot.Dockerfile     # + @github/copilot
        └── mempalace.Dockerfile   # + pipx install mempalace
```

Rules of thumb applied:

- Anything shared by ≥2 child images lives in `base`: apt packages,
  Node, pipx, `gh`, `ollama` client binary, the `agent` user, the
  workspace dir, and the empty mount-point stubs (`~/.claude`,
  `~/.gemini`, `~/.copilot`, `~/.mempalace`).
- Per-CLI images add a single `RUN npm install -g <pkg>@<pin>` line and
  a `HEALTHCHECK` that calls `<cli> --version`. Nothing else.
- `mempalace.Dockerfile` is the only image that pulls `pipx install`
  at runtime; keeping it in a dedicated image lets us bump the pin
  without invalidating the CLI image cache.
- Build with BuildKit `--cache-from base:e2e` for child images so the
  base layer is reused across the four child builds.

Expected weights (rough, uncompressed → compressed):
`base` ≈ 480 MB → ~210 MB; per-CLI ≈ 620–720 MB → ~260–320 MB;
MemPalace ≈ 540 MB → ~230 MB. All within the issue's targets with
margin.

## Decision 3 — CLI install paths and version pinning

Verified upstream on 2026-05-22 (sources at the bottom).

| CLI | Install command | Version pin strategy |
|---|---|---|
| `claude-code` | `npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}` | Default `latest`, overridable at build time via `--build-arg CLAUDE_CODE_VERSION=x.y.z`. npm install is still supported even though Anthropic recommends the install script — npm is the only path that works headless without a TTY. |
| `gemini-cli` | `npm install -g @google/gemini-cli@${GEMINI_CLI_VERSION}` | Same pattern. Node 22 in base satisfies the recommended Node-20+ floor. |
| `copilot` | `npm install -g @github/copilot@${COPILOT_CLI_VERSION}` | New official package (replaces the retired `gh extension install github/gh-copilot`). Binary entry-point is `copilot`. |

Default pins are **floating-tag at build time, locked-by-digest in CI**:
the `e2e:build` task records `<cli> --version` into
`docker/e2e/.versions.lock` after each build so reruns are reproducible
even when the build args float.

`gh` (the GitHub CLI) is installed via apt in the base image because
copilot CLI still expects `gh auth` for some flows; this also serves
issue #77's auth pipeline.

## Decision 4 — Non-root user

```dockerfile
RUN groupadd --gid 1000 agent \
 && useradd  --uid 1000 --gid 1000 --create-home --shell /bin/bash agent \
 && install -d -o agent -g agent \
      /home/agent/workspace \
      /home/agent/.claude \
      /home/agent/.gemini \
      /home/agent/.copilot \
      /home/agent/.mempalace
USER agent
WORKDIR /home/agent/workspace
```

- uid/gid 1000 matches the default on most Linux dev hosts; macOS
  mounts via Docker Desktop reconcile uid via the VM so no special
  handling is needed.
- Mount-point stubs are pre-created and `chown`-ed so bind-mounts from
  the host inherit correct ownership regardless of host uid.
- `npm` global prefix is set to `/home/agent/.npm-global` and added to
  `PATH` so the CLI installs in *child* images succeed without `sudo`.

## Decision 5 — MemPalace sidecar

- Installed via `pipx install 'mempalace>=3.3.3,<3.4'` (matches the
  pinned `install-mempalace` task in `Taskfile.yml`).
- **Usage mode: one-shot admin container.** The CLI containers do NOT
  embed MemPalace. They talk to the sidecar's storage indirectly via
  a shared bind-mount (`mempalace-data` volume at
  `/home/agent/.mempalace`). The sidecar is invoked on demand for
  assertions (`mempalace status`, `mempalace_search`-equivalent
  queries) and teardown reporting.
- **Why one-shot, not long-running:** the MCP server model assumes a
  parent agent process spawns it over stdio. We have no such parent
  in the sidecar; running it as a daemon would require a custom
  transport. One-shot CLI invocations against the shared volume are
  sufficient for the scenarios sketched in epic #75.
- **Volume layout:**

  ```text
  mempalace-data           (named volume)
    ├── palace.db          # SQLite + KG state
    └── wing_*/            # diary wings per agent
  ```

  Bind-mounted read-write into every CLI container at
  `/home/agent/.mempalace`. Concurrent-writer behavior is flagged as
  an open risk in epic #75 — the sidecar image gives us the tooling to
  inspect lock state during scenarios.

## Decision 6 — Taskfile integration

Follows the existing top-level style (no namespacing prefix on var
names, `desc:` populated, preconditions listed for binaries).

```yaml
vars:
  E2E_IMG_PREFIX: "crewrig/e2e"
  E2E_DOCKER_DIR: "{{.REPO_DIR}}/docker/e2e"
  E2E_VERSIONS_LOCK: "{{.REPO_DIR}}/docker/e2e/.versions.lock"

tasks:
  e2e:build:
    desc: Build all e2e images and refresh .versions.lock.
    # `cmds:` (not `deps:`) so children run in the listed order — deterministic
    # base-then-children, then version capture last.
    cmds:
      - task: e2e:build:base
      - task: e2e:build:claude
      - task: e2e:build:gemini
      - task: e2e:build:copilot
      - task: e2e:build:mempalace
      - task: e2e:lock

  e2e:build:base:
    desc: Build the shared e2e base image (crewrig/e2e-base:latest).
    preconditions:
      - sh: command -v docker >/dev/null 2>&1
        msg: "docker is required."
    cmd: docker build -t {{.E2E_IMG_PREFIX}}-base:latest -f {{.E2E_DOCKER_DIR}}/base.Dockerfile {{.E2E_DOCKER_DIR}}

  e2e:build:claude:    { desc: "Build the Claude Code e2e image.",         deps: [e2e:build:base], cmd: "docker build -t {{.E2E_IMG_PREFIX}}-claude:latest    -f {{.E2E_DOCKER_DIR}}/claude.Dockerfile    {{.E2E_DOCKER_DIR}}" }
  e2e:build:gemini:    { desc: "Build the Gemini CLI e2e image.",          deps: [e2e:build:base], cmd: "docker build -t {{.E2E_IMG_PREFIX}}-gemini:latest    -f {{.E2E_DOCKER_DIR}}/gemini.Dockerfile    {{.E2E_DOCKER_DIR}}" }
  e2e:build:copilot:   { desc: "Build the GitHub Copilot CLI e2e image.",  deps: [e2e:build:base], cmd: "docker build -t {{.E2E_IMG_PREFIX}}-copilot:latest   -f {{.E2E_DOCKER_DIR}}/copilot.Dockerfile   {{.E2E_DOCKER_DIR}}" }
  e2e:build:mempalace: { desc: "Build the MemPalace sidecar e2e image.",   deps: [e2e:build:base], cmd: "docker build -t {{.E2E_IMG_PREFIX}}-mempalace:latest -f {{.E2E_DOCKER_DIR}}/mempalace.Dockerfile {{.E2E_DOCKER_DIR}}" }
```

Image tag scheme uses **hyphen + `:latest`** (`crewrig/e2e-base:latest`),
not slash + `:dev`: a single-segment tag keeps `docker image ls` output
readable and matches the `crewrig/e2e-<role>` namespace convention used
elsewhere in the framework.

The `--build-arg <CLI>_VERSION=x.y.z` knob is exposed by adding a
`CLI_VERSION` var per task once needed; default omitted to keep the
floating-tag-plus-lockfile pattern (Decision 3).

## Open risks

1. **Copilot CLI auth in headless containers.** `@github/copilot` boots
   into `/login` and expects an interactive device-flow prompt. The
   epic's "dedicated account" strategy (issue #77) mitigates this by
   persisting credentials on the host, but we have NOT confirmed
   whether the credential file is portable across `copilot` versions or
   tied to a specific token format. Developer should validate by
   running `copilot --version` then a no-op prompt inside the container
   with the bind-mounted credential dir before declaring the image
   ready.
2. **Image weight vs. node ecosystem bloat.** Three globally-installed
   npm CLIs pull thousands of transitive deps. Mitigations: (a) keep
   npm caches out of the final image via `npm install -g --no-audit
   --no-fund && npm cache clean --force`; (b) install each CLI in its
   own image rather than stacking them; (c) measure compressed weight
   in CI and fail if > 800 MB. If we still drift over budget, fallback
   is multi-stage builds with `node-prune` on `/usr/local/lib/node_modules`.
3. **Ollama Cloud client packaging.** The epic mentions an `ollama
   launch` invocation for Ollama Cloud routing. The official `ollama`
   binary in apt may lag the Cloud client features. Decision deferred
   to scenario time: the base image installs the latest `ollama`
   binary from `ollama.com/install.sh`, pinned by SHA256 of the install
   script. If Cloud-specific behavior breaks, escalate before
   plumbing it into scenarios.

## Blast radius

Near-zero. New files only:

- `docker/e2e/base.Dockerfile`, `claude.Dockerfile`, `gemini.Dockerfile`,
  `copilot.Dockerfile`, `mempalace.Dockerfile`
- `docker/e2e/.dockerignore` (recommend committing — excludes
  `.worktrees/`, `node_modules`, large fixtures).
- New `e2e:*` entries in `Taskfile.yml` (additive, no rename of
  existing tasks).

Touch points to verify but **not** change in this ticket:

- `.gitignore` — confirm `docker/e2e/.versions.lock` is either committed
  (preferred, reproducibility) or explicitly ignored. Developer to
  decide and document the choice in the PR body.
- `docs/cli-matrix.md` — no parity row needed yet (no CLI-specific
  framework artifact changes); the e2e harness is meta-tooling. Flag
  for re-evaluation when scenarios start exercising per-CLI surfaces.

Anything beyond the above (touching `community-config/`, `config/`,
`scripts/build-components.sh`, or CI workflows) is **out of scope** and
should be flagged back to the team lead.

## Sources

- `@anthropic-ai/claude-code` — <https://www.npmjs.com/package/@anthropic-ai/claude-code>
- `@google/gemini-cli` — <https://www.npmjs.com/package/@google/gemini-cli>
- `@github/copilot` — <https://www.npmjs.com/package/@github/copilot>
- GitHub Docs, *Installing GitHub Copilot CLI* (2026-01-21 changelog confirming `@github/copilot` is the canonical package; `gh extension install github/gh-copilot` is retired).
