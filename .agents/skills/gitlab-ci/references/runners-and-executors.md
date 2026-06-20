# Runners and executors reference

Reference for the execution substrate of GitLab CI/CD: where a runner
comes from (scope), how a job is matched to one (tags), how the runner
runs the job (executors), how the docker executor handles images and
services, the `config.toml` knobs that govern a self-managed runner, and
the security model that decides whether attaching a runner is safe.

GitLab splits the concern in two. A **runner** is the agent registered
with a GitLab instance that picks up jobs. An **executor** is the
mechanism a runner uses to run a job's script — a local shell, a
container, a Kubernetes pod. One runner process runs one executor; you
register several runners to offer several executors.

## Runner scopes

A runner's scope decides which projects may schedule jobs on it.

| Scope | Registered against | Visible to |
|-------|--------------------|-----------|
| **Instance** (shared) | The whole instance | Every project, subject to admin settings. |
| **Group** | A group | Every project in that group and its subgroups. |
| **Project** (specific) | One or more projects | Only the projects it is explicitly assigned to. |

The GitLab coordinator offers a pending job to the runners eligible for
that project; the first runner that polls and matches the job's `tags:`
claims it. Shared runners process jobs fair-use across projects; group
and project runners only see their own scope.

### GitLab.com SaaS hosted runners

GitLab.com offers managed runners — nothing to register. They are
ephemeral (a fresh VM per job, destroyed afterward, no state leak) and
selected by tag:

| Tag (class) | Platform | Notes |
|-------------|----------|-------|
| `saas-linux-small-amd64` | Linux | Default class; smallest, cheapest. |
| `saas-linux-medium-amd64`, `saas-linux-large-amd64` | Linux | More vCPU/RAM, higher minute weight. |
| `saas-linux-medium-arm64` | Linux ARM | ARM64 class. |
| `saas-windows-medium-amd64` | Windows | Higher minute multiplier. |
| `saas-macos-medium-m1` | macOS | Apple silicon; highest multiplier; tier-gated. |

Class names and minute multipliers drift — verify against the current
GitLab.com runner docs before pinning one. Untagged jobs run on the
small Linux class.

### Self-managed runners

Anything you register yourself with `gitlab-runner register`, against a
self-managed instance or GitLab.com. You own the host, the executor
choice, the network placement, and the security posture. The rest of
this document is mostly about these.

## Selecting a runner with `tags:`

A job advertises required tags; a runner advertises the tags it was
registered with. A job runs on a runner only if the runner carries
**every** tag the job lists.

```yaml
build:
  tags: [docker, linux, amd64]
  script:
    - make build
```

This runs only on a runner tagged at least `docker`, `linux`, and
`amd64`. Extra runner tags are fine; a single missing tag disqualifies
the runner.

### Untagged jobs and `run_untagged`

A job with no `tags:` is **untagged**. A runner picks up untagged jobs
only when registered with `run_untagged = true` (the default for new
runners; admins often flip shared runners to `false` to force explicit
tagging). Set it per runner in `config.toml`:

```toml
[[runners]]
  name = "docker-runner-1"
  run_untagged = true
```

### The "no runner matching tags" stuck job

If a job lists a tag no eligible runner carries — a typo, a
decommissioned runner, a runner in the wrong scope — the job sits
`pending` and eventually fails:

```text
This job is stuck because you don't have any active runners online
or available with any of these tags assigned to them: <tag>
```

This is the most common GitLab CI failure after YAML errors. Diagnose
in Settings → CI/CD → Runners: confirm a runner available to the
project advertises the exact tag set. A job tagging `arm64` on an
`amd64`-only fleet is stuck forever, not slow.

## Executors

The executor is set per runner at registration and recorded in
`config.toml`. It determines the isolation model, the available
features, and the operational cost.

| Executor | Isolation | Use when |
|----------|-----------|----------|
| `shell` | None — runs as the runner's OS user | Trusted single-tenant jobs needing host tools directly. |
| `docker` | Per-job container | Default for most fleets; clean, reproducible. |
| `docker-autoscaler` | Per-job container on autoscaled hosts | Bursty load; replaces deprecated `docker-machine`. |
| `kubernetes` | Per-job pod | Already on k8s; elastic; per-job resource limits. |
| `ssh` | Remote host, no isolation | Legacy; avoid for new work. |
| `virtualbox` / `parallels` | Full VM | Need a full guest OS (Windows/macOS) with VM isolation. |
| `instance` | Fresh cloud VM per job | Autoscaled VMs via fleeting; strongest isolation, highest latency. |

### `shell`

Runs the job's `script:` directly on the host as the user that owns the
runner process — no container, no image. Fast and simple, but a job has
the host's full toolchain and filesystem; an escape affects the host and
the next job. Reserve for trusted, single-tenant runners; never expose a
shell-executor runner to untrusted contributions (see *Runner
security*).

### `docker`

The dominant choice. Each job runs in a container from a chosen image;
the runner mounts the build directory and caches, runs the `script:`,
then discards the container. Clean per-job state, reproducible
toolchains, no host pollution. Configuration depth below.

### `kubernetes`

The runner is a controller that creates a **pod per job**: a build
container (the job image), a helper container (clone, artifacts, cache),
and one container per declared `service:`. You get horizontal elasticity
and per-job CPU/memory limits, at the cost of running the runner inside
a cluster with the right RBAC. Standard for teams already on Kubernetes.
Knobs live under `[runners.kubernetes]`.

Choosing: trusted project with host tools → `shell`; general-purpose
fleet → `docker`; already on Kubernetes → `kubernetes`; bursty cloud
load with scale-to-zero → `docker-autoscaler` / `instance`; full guest
OS or VM isolation → `virtualbox` / `parallels`.

## The docker executor

### `image:` — the job's container

Set per job, or globally via `default:`:

```yaml
default:
  image: golang:1.23-bookworm

test:
  script: [go test ./...]

lint:
  image: golangci/golangci-lint:v1.61.0   # overrides the default
  script: [golangci-lint run]
```

A job-level `image:` overrides `default:`. With no image at all, the
docker executor falls back to the runner's configured default image in
`config.toml`.

### Pin images by digest — security default

Bare tags are mutable: `golang:1.23` and `:latest` can be repointed at a
new image under the same name, so a green pipeline can silently start
running different code. Pin by immutable digest:

```yaml
default:
  image: golang:1.23-bookworm@sha256:0e6f6c...   # immutable
```

The skill's `check-pinned-images.sh` flags any `image:` (and
`services:[].name`) using a bare tag or `:latest` instead of a
`@sha256:` digest. Treat a bare tag as a finding, not a style nit:
digest pinning is this skill's supply-chain default, mirroring the
github-actions action-SHA-pinning rule.

### `image:pull_policy`

Controls when the executor pulls versus reusing a cached image:

```yaml
build:
  image:
    name: registry.example.com/builder@sha256:abc123...
    pull_policy: [always, if-not-present]
```

- `always` — pull every run (default on shared runners; freshest).
- `if-not-present` — pull only when absent locally (fast; safe with a
  digest, stale-prone with a mutable tag).
- `never` — never pull; the image must be pre-seeded on the host.

A job may only request policies the runner permits via
`allowed_pull_policies`; a disallowed request fails the job rather than
silently downgrading.

### `services:` — sidecar containers

Services are extra containers started alongside the job container on a
shared network — databases, brokers, headless browsers. Reach them as
hostnames:

```yaml
test:
  image: golang:1.23-bookworm
  services:
    - name: postgres:16@sha256:def456...
      alias: db
      variables: { POSTGRES_DB: app_test, POSTGRES_PASSWORD: ci_only }
    - name: redis:7@sha256:aaa111...
  variables:
    DATABASE_URL: "postgres://postgres:ci_only@db:5432/app_test"
  script: [go test ./...]
```

Mechanics:

- **Hostname.** A service answers at its image name (with `/` and `:`
  rewritten to `-` and `__`) and at any `alias:` — `db` above. The alias
  is the practical handle.
- **Per-service `variables:`.** Configure the service container (DB
  name, password) independently of the job env.
- **`services:[].command` / `services:[].entrypoint`.** Override the
  container's startup, e.g. to pass flags to the service binary.
- **Ports.** The shared network exposes the container's listening ports
  on the alias hostname directly; GitLab needs no `ports:` mapping. The
  `CI_*` variables describe the build environment, not service ports.
- **Readiness.** The runner waits for service containers to start, but
  started is not ready — for Postgres and friends, add an explicit wait
  in the script (`pg_isready` poll, `wait-for-it`).

### Private images — `DOCKER_AUTH_CONFIG`

To pull `image:` or `services:` from a private registry, give the runner
credentials via the `DOCKER_AUTH_CONFIG` CI/CD variable — a JSON
document in Docker `config.json` format, ideally a **masked, protected**
variable:

```json
{ "auths": { "registry.example.com": { "auth": "base64(user:token)" } } }
```

The docker and kubernetes executors read it and authenticate the pull.
Prefer a deploy token or least-privilege registry token over a personal
credential; never inline the value in `.gitlab-ci.yml`. See the
security-and-permissions reference for variable protection and masking.

## `config.toml` essentials

Self-managed runners are configured by `config.toml` (default
`/etc/gitlab-runner/config.toml`). Practitioner essentials below;
consult the GitLab Runner advanced-configuration docs for the full
surface.

```toml
concurrent = 8        # max jobs across ALL runners in this process
check_interval = 3    # seconds between coordinator polls

[[runners]]
  name = "docker-runner-1"
  url = "https://gitlab.example.com/"
  token = "glrt-REDACTED"
  executor = "docker"
  run_untagged = false
  limit = 4           # max concurrent jobs for THIS runner

  [runners.docker]
    image = "alpine:3.20"            # fallback when a job sets no image
    privileged = false              # KEEP false unless truly needed
    pull_policy = ["if-not-present"]
    allowed_pull_policies = ["always", "if-not-present"]
    allowed_images = ["registry.example.com/*", "docker.io/library/*"]
    allowed_services = ["postgres:*", "redis:*"]
    volumes = ["/cache"]            # do NOT mount /var/run/docker.sock

  [runners.cache]
    Type = "s3"
    Shared = true
    [runners.cache.s3]
      ServerAddress = "s3.example.com"
      BucketName = "gitlab-runner-cache"
      AuthenticationType = "iam"    # prefer instance role over static keys

  [runners.kubernetes]
    namespace = "gitlab-ci"
    image = "alpine:3.20"
    privileged = false
    cpu_request = "500m"
    memory_request = "512Mi"
    cpu_limit = "2"
    memory_limit = "2Gi"
    service_account = "gitlab-runner"
```

- `concurrent` caps total simultaneous jobs for the whole
  `gitlab-runner` process, independent of how many `[[runners]]` blocks
  exist; `limit` caps a single runner.
- `privileged = true` grants containers near-host capabilities (see
  *Runner security*); default and recommended value is `false`.
- `allowed_images` / `allowed_services` allowlist what jobs may run,
  blunting the "any fork runs any image" exposure on shared runners.
- `volumes` persists paths across jobs on the same host; a distributed
  `[runners.cache]` survives beyond one host (essential for autoscaled
  fleets where the next job lands elsewhere). Never mount the Docker
  socket as a volume — that is the classic root-escalation footgun.
- `[runners.kubernetes]` requests/limits seed each per-job pod unless a
  job overrides them via `KUBERNETES_*` variables; scope the
  `service_account` RBAC to the minimum the build needs.

## Autoscaling

For bursty load, scale capacity to demand instead of paying for idle
hosts:

- **`docker-autoscaler` + fleeting.** The current autoscaling path,
  replacing the deprecated `docker-machine`. A **fleeting** plugin (AWS
  EC2, GCP, Azure) provisions and reaps VMs; the autoscaler runs the
  docker executor on each. Configured via `[runners.autoscaler]` with
  `plugin`, `capacity_per_instance`, and scaling policies.
- **`instance` executor.** Runs each job directly on a freshly
  provisioned-then-destroyed cloud VM via the same fleeting plugins —
  strongest isolation, highest per-job latency.
- **GitLab Runner Operator on Kubernetes.** Deploy and manage runners
  declaratively via the operator and a `Runner` custom resource; the
  cluster autoscaler then scales nodes to absorb pod-per-job demand.

## Runner security

A runner executes whatever code a pipeline carries. The hard questions
are *who can push that code* and *what the runner can reach*.

### `privileged = true` is dangerous

A privileged docker container runs with near-host capabilities: host
devices, kernel manipulation, and — with a mounted Docker socket —
trivial escape to root on the host. People enable it for
Docker-in-Docker (`dind`); prefer **rootless buildkit / kaniko /
buildah**, which build images without privileged mode. If `dind` is
unavoidable, isolate those runners on disposable, network-segmented
hosts and never share them with untrusted projects.

### The untrusted-fork / public-project exposure

The headline rule mirrors the GitHub Actions analog: **a fork merge
request can run arbitrary code on any runner that picks up its
pipeline.** If a shared or instance runner processes fork pipelines for
a public project, an attacker forks, edits `.gitlab-ci.yml` to exfil
secrets or mine the host, and opens an MR. Defenses:

1. **Protected branches and protected variables.** Mark sensitive CI/CD
   variables **protected** so they are injected only on protected
   branches and tags — never on a fork MR pipeline. This is the primary
   control: a fork pipeline never sees the secret.
2. **Restrict shared runners on public projects.** Disable instance
   runners for public projects, or require approval before
   external-fork MR pipelines run (project CI/CD settings).
3. **Dedicated, ephemeral, segmented runners for untrusted work.** If
   fork CI must run, give it disposable runners (autoscaled VMs / k8s
   pods destroyed per job) on a network with no route to production or
   the secret store.
4. **`allowed_images` / `allowed_services` allowlists.** Constrain what
   a job may pull and run on a shared runner.
5. **Drop `privileged`, drop the Docker socket.** A non-privileged
   runner with no socket mount removes the easiest escalation path.

### Isolate CI from production networks

Place runners on a subnet that **cannot** reach production databases,
state stores, or the secret manager beyond what the build legitimately
needs. A compromised job should not be one `curl` from production.
Combine network segmentation with protected variables so the blast
radius of a malicious pipeline is bounded.

For the full permission surface — protected vs masked variables,
`CI_JOB_TOKEN` scoping, the GitLab security model — see the
security-and-permissions reference.

## Resource and concurrency controls

Two job-level fields interact with the runner layer; full job-field
semantics live in the pipeline-syntax reference, summarized here only
for their runner-side effect:

- **`resource_group`** — serializes jobs sharing the named group so
  that, across pipelines, at most one runs at a time. The mechanism is
  the coordinator's, not the runner's, but it is how you stop two deploy
  jobs racing on the same environment regardless of free runner count.

  ```yaml
  deploy_prod:
    resource_group: production
    environment: production
    script: ./deploy.sh
  ```

- **`interruptible`** — marks a job safe to auto-cancel when a newer
  pipeline supersedes it on the same ref (with *Auto-cancel redundant
  pipelines* enabled), freeing runner capacity. Full field detail in the
  pipeline-syntax reference.

  ```yaml
  build:
    interruptible: true
    script: make build
  ```
