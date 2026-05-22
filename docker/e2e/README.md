# CrewRig e2e Docker images

This directory hosts the Docker foundation for the CrewRig end-to-end
testing framework (epic #75). It ships a shared base image, one image
per supported CLI, and a MemPalace sidecar.

## Images

| Image                       | Source              | Purpose                                                     |
|-----------------------------|---------------------|-------------------------------------------------------------|
| `crewrig/e2e-base:latest`   | `base.Dockerfile`   | Shared substrate: Debian 12, Node 22, pipx, gh, yq, jq, ollama, non-root `agent` user. |
| `crewrig/e2e-claude:latest` | `claude.Dockerfile` | Base + `@anthropic-ai/claude-code` (npm global).            |
| `crewrig/e2e-gemini:latest` | `gemini.Dockerfile` | Base + `@google/gemini-cli` (npm global).                   |
| `crewrig/e2e-copilot:latest`| `copilot.Dockerfile`| Base + `@github/copilot` (npm global).                      |
| `crewrig/e2e-mempalace:latest` | `mempalace.Dockerfile` | Base + `mempalace>=3.3.3,<3.4` via pipx. One-shot admin container. |

All images run as `agent` (uid/gid 1000) with workdir
`/home/agent/workspace`. Mount points are pre-created and owned by
`agent` at:

- `/home/agent/.claude`
- `/home/agent/.gemini`
- `/home/agent/.copilot`
- `/home/agent/.mempalace`

See [`docs/adr/0001-e2e-docker-images.md`](../../docs/adr/0001-e2e-docker-images.md)
for the full design rationale, layering strategy, and open risks.

## Building

From the repo root:

```sh
task e2e:build          # builds all five images in order, then refreshes the lockfile
task e2e:build:base     # individual targets
task e2e:build:claude
task e2e:build:gemini
task e2e:build:copilot
task e2e:build:mempalace
task e2e:lock           # re-capture .versions.lock without rebuilding
```

The Taskfile entries target tags `crewrig/e2e-*:latest`. The child
images consume `crewrig/e2e-base:latest` via `FROM`, so the base must
exist before the children build — `e2e:build:<cli>` declares this
dependency explicitly.

### Pinning CLI versions

Each CLI image accepts a `--build-arg` to pin its CLI:

```sh
docker build \
  -t crewrig/e2e-claude:latest \
  --build-arg CLAUDE_CODE_VERSION=1.2.3 \
  -f docker/e2e/claude.Dockerfile docker/e2e
```

Build-args available: `CLAUDE_CODE_VERSION`, `GEMINI_CLI_VERSION`,
`COPILOT_CLI_VERSION`, `MEMPALACE_VERSION`. Defaults float (`latest` /
`>=3.3.3,<3.4`); pin them and re-run `task e2e:lock` to record the
resolved versions in `.versions.lock`.

## `.versions.lock`

`docker/e2e/.versions.lock` is **committed** to the repo. It captures
the resolved versions of every CLI and tool baked into the images at
build time. It is populated by `task e2e:lock` (also invoked at the
end of `task e2e:build`) which runs each image with `<cli> --version`
and writes a flat `key=value` document.

Reproducibility wins over churn: when the upstream `latest` tag moves,
the rebuilt lockfile makes the change visible in a diff.

## Out of scope for #76

These surfaces are tracked separately:

- **Headless authentication flow** (Claude, Gemini, Copilot device-flow
  credential persistence) — issue #77.
- **e2e runner** (container orchestration, fixture mounts, log capture)
  — issue #78.
- **Scenario fixtures and assertions** — issues #79, #80, #81.

Do not extend these images with auth helpers, scenario runners, or
fixture data without first checking the corresponding child issue.
