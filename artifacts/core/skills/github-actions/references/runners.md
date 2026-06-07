# Runners reference

Reference for the execution substrate of GitHub Actions: the
GitHub-hosted runner inventory, self-hosted runner architecture, label
and group selection, runner security model, and the constraints that
apply to composite actions and container jobs.

## GitHub-hosted runners

GitHub provisions ephemeral VMs per job, destroyed after the job
completes. Each job starts from a clean image — no state leaks
between jobs.

### Image inventory

The current general-availability images, with the labels that resolve
to them:

| Label | OS | Notes |
|-------|----|----|
| `ubuntu-24.04`, `ubuntu-latest` | Ubuntu 24.04 LTS | `latest` follows the most recent LTS; pin the explicit version for reproducibility. |
| `ubuntu-22.04` | Ubuntu 22.04 LTS | Still supported; expect retirement on the upstream LTS cadence. |
| `windows-2025`, `windows-latest` | Windows Server 2025 | `latest` follows the most recent supported version. |
| `windows-2022` | Windows Server 2022 | Older but stable. |
| `macos-15`, `macos-latest` | macOS Sequoia (Apple silicon) | Apple-silicon by default on the recent `macos-*` labels. |
| `macos-14` | macOS Sonoma (Apple silicon) | |
| `macos-13` | macOS Ventura (Intel) | The last Intel macOS label; verify availability before relying on it. |

For long-lived workflows, pin the explicit version label
(`ubuntu-24.04`, not `ubuntu-latest`). `*-latest` rolls forward
silently and has broken previously green pipelines on every prior
transition.

### Hardware

Standard (free for public repos, paid for private):

- **Linux / Windows standard:** 4 vCPU, 16 GB RAM, 14 GB SSD.
- **macOS standard:** 3 vCPU, 7 GB RAM (Intel) / 4 vCPU, 7 GB RAM
  (Apple silicon).

Larger runners (paid, opt-in per repo or org):

- 8 / 16 / 32 / 64 vCPU variants on Linux and Windows.
- GPU variants (T4) on Linux.
- ARM64 variants on Linux and Windows (`ubuntu-24.04-arm`,
  `windows-11-arm`).

Verify the current inventory at the runner-images repository; the
table above drifts.

### Pre-installed software

Each image ships with a curated toolchain — Node.js, Python, Ruby,
Go, .NET, Java, Docker, kubectl, common Linux build tools, the GitHub
CLI, etc. Two important consequences:

- Tool versions drift across image releases. `actions/setup-<tool>`
  is the supported way to pin a version regardless of what is
  pre-installed.
- The pre-installed tool versions are cached on the runner under
  `runner.tool_cache`. `actions/setup-<tool>` first checks the cache
  before downloading.

For the authoritative list, consult the runner-images repo
(`actions/runner-images`) and the `Tool Versions` section of each
image's release notes.

### Network

GitHub-hosted runners have unrestricted outbound IPv4/IPv6. Inbound is
blocked. The runner pulls jobs from `github.com` over HTTPS.

For workflows that need to reach internal services, options are:

- A self-hosted runner inside the network.
- An OIDC-federated cloud role with a NAT route.
- A `tailscale` / `cloudflare-tunnel` style action that opens a
  short-lived ingress.

### Disk and memory limits

A job that exhausts the 14 GB disk fails with an opaque error during
the next file write. Common offenders: Docker layer caches, full
`node_modules`, downloaded model weights. Mitigations:

- `docker system prune -af` early in the job.
- Use `easimon/maximize-build-space` to reclaim ~30 GB by removing
  pre-installed bloat (when targeting Linux runners and you accept the
  trade-off).
- Move large artifacts to remote storage rather than the workspace.

## Self-hosted runners

### Architecture

A self-hosted runner is a long-running process (`Runner.Listener`)
that polls GitHub for jobs, downloads the workflow YAML and the
action source, and executes inside its working directory. By default
the process runs as the OS user that started it; the workspace and the
runner toolchain cache persist between jobs unless explicitly cleaned.

### Labels and groups

A runner advertises a set of **labels** — `self-hosted` (mandatory),
plus the OS (`linux` / `windows` / `macOS`), the architecture (`x64` /
`arm64`), and any custom labels added at registration time.

`runs-on:` with an array matches all listed labels:

```yaml
runs-on: [self-hosted, linux, x64, gpu]
```

**Runner groups** (Enterprise / Org tier) bind runners to a named
group, with access controls per repository. Use the object form:

```yaml
runs-on:
  group: gpu-runners
  labels: [self-hosted, linux, gpu]
```

Group membership constrains which repositories may target the
runner; labels select within the group. The combination defends
against accidental cross-team consumption.

### Security model

The headline rule: **never attach a self-hosted runner to a public
repository** unless you accept that any fork-submitted PR can execute
arbitrary code on it.

Defensive measures, in order of effectiveness:

1. **Ephemeral runners.** Spin up a fresh VM per job (Actions Runner
   Controller / ARC on Kubernetes, or
   `philips-labs/terraform-aws-github-runner` on EC2). The runner is
   destroyed after one job — no state carries over.
2. **`Require approval for all outside collaborators`** at repo
   settings. First-time contributor PRs require maintainer click to
   run.
3. **Private repo only.** The simplest defence is to keep the repo
   private and trust the contributor set.
4. **Restrict runner-group repo access.** A GPU runner pool should
   not be visible to repositories that have no business using it.
5. **Network isolation.** Place runners on a subnet without
   write access to production secrets / state stores.
6. **Read-only `$HOME`** and a wiped workspace per job (ARC handles
   this; raw self-hosted runners do not).
7. **No sudo, no Docker socket access** unless required. A
   container-running runner with `/var/run/docker.sock` mounted is a
   root escalation primitive.

### Actions Runner Controller (ARC)

The canonical Kubernetes-native deployment. Two flavours:

- **Legacy ARC** (`actions-runner-controller/actions-runner-controller`)
  — operator-managed, PAT-based authentication. Maintenance mode.
- **Official ARC** (`actions/actions-runner-controller`) — GitHub's
  own implementation, GitHub-App-based auth, scale-set abstraction.
  Prefer this for new deployments.

A scale set materialises a pool of pods that come up on demand, claim
one job each, and terminate. The `runs-on:` value matches the scale
set name; no label management required.

## Containers and services

### Job container

A job may declare `container:` to run all its steps inside an image:

```yaml
container:
  image: golang:1.23-bookworm
  env:
    CGO_ENABLED: "0"
  options: --user 1001:1001
  credentials:
    username: ${{ secrets.REGISTRY_USER }}
    password: ${{ secrets.REGISTRY_TOKEN }}
```

The runner mounts the workspace and `$HOME` into the container, runs
`docker exec` for each step. Action steps run inside the container
too — Node.js actions require Node to exist in the image (or use
`actions/setup-node` first).

### Service containers

Sidecars for the job duration, on a shared Docker network. Reach them
by the service key as hostname:

```yaml
services:
  redis:
    image: redis:7
    ports: ["6379:6379"]
    options: --health-cmd "redis-cli ping" --health-interval 5s --health-retries 5
```

`options:` accepts any `docker run` flag. Health-check options gate
the start of step execution: the runner waits until the container
reports healthy.

## Composite-action constraints

Composite actions (`runs.using: composite`) run on whatever runner
the calling workflow is on. Limitations:

- Every `run:` step **must** declare `shell:` — no inheritance from
  the workflow's `defaults.run.shell`.
- `continue-on-error:` and `timeout-minutes:` are unsupported on
  steps within the composite action.
- The composite action cannot declare its own `container:` or
  `services:` — those live at the calling job's level.
- `secrets` are not directly accessible inside the composite; pass
  them in as `inputs:` (with the caveat that input values are visible
  in logs unless masked manually via `::add-mask::`).

## Workflow commands

The runner exposes a control channel through stdout. Selected
commands:

| Command | Effect |
|---------|--------|
| `echo "::add-mask::$VALUE"` | Masks the value in subsequent log output. |
| `echo "key=value" >> "$GITHUB_OUTPUT"` | Step output. |
| `echo "VAR=value" >> "$GITHUB_ENV"` | Persistent env var. |
| `echo "$DIR" >> "$GITHUB_PATH"` | Prepend to `PATH`. |
| `echo "::group::Title"` / `::endgroup::` | Collapse log section. |
| `echo "::notice::msg"` / `::warning::` / `::error::` | Annotation surface. |
| `echo "## Heading" >> "$GITHUB_STEP_SUMMARY"` | Markdown summary on the run page. |

`::set-output` and `::set-env` (the old in-line forms) are deprecated
and disabled by default since the 2022 CVE — use the file-based
channels above.

## Runner diagnostics

When a self-hosted runner misbehaves:

- `_diag/` directory under the runner install root has `Runner_*.log`
  and `Worker_*.log` files per job. Worker log is where step-level
  diagnostics live.
- Enabling **step debug logging** requires repository secret
  `ACTIONS_STEP_DEBUG=true`. Verbose, exposes context values — keep
  it off by default.
- Enabling **runner diagnostic logs** requires
  `ACTIONS_RUNNER_DEBUG=true`. Useful for runner-side failures
  (network, auth, image pull).

For GitHub-hosted runners, the same two secrets unlock the verbose
logging on the next run.
