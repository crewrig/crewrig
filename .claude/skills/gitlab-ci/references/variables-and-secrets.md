# Variables and secrets reference

CI/CD variables are the channel GitLab offers for injecting
configuration into a pipeline. There is no separate "secret" object as
in some other systems: a variable becomes a secret by flipping two
flags — **masked** and **protected** — and by binding it to the
smallest scope that needs it. Get those flags wrong and you either leak
a credential to a job log or expose it to an untrusted branch. For
credentials that should never sit at rest in GitLab at all, the
`secrets:` keyword pulls them from an external manager (Vault, Azure
Key Vault, GCP Secret Manager) at job start, and `id_tokens:` federates
to a cloud provider with a short-lived JWT instead of a long-lived key.

## The variable model

A pipeline sees a flattened set of environment variables assembled from
several sources:

- **Predefined variables.** Supplied by GitLab itself: `CI_COMMIT_REF_NAME`,
  `CI_PROJECT_PATH`, `CI_PIPELINE_SOURCE`, `CI_JOB_TOKEN`, etc. Read-only.
- **Instance variables.** Defined by an administrator; visible to every
  project on the instance.
- **Group variables.** `Group → Settings → CI/CD → Variables`. Inherited
  by every project in the group (and subgroups).
- **Project variables.** `Project → Settings → CI/CD → Variables`. The
  most common place for credentials.
- **Pipeline-trigger / scheduled variables.** Passed when a pipeline is
  started via the trigger API, a pipeline schedule, or a manual `web`
  run (the "Run pipeline" form, driven by `value`/`description`).
- **`.gitlab-ci.yml` variables.** Declared in YAML, either globally
  (top-level `variables:`) or per-job (`job.variables:`). Committed to
  the repository — never a credential.
- **`dotenv` artifacts.** A job exports a `*.env` file as a
  `reports: dotenv:` artifact; downstream jobs inherit those keys as
  variables. The channel for passing computed values between stages.

```yaml
build:
  stage: build
  script:
    - echo "BUILD_ID=$(date +%s)" >> build.env
  artifacts:
    reports:
      dotenv: build.env

deploy:
  stage: deploy
  script:
    - echo "Deploying build $BUILD_ID"   # inherited from dotenv
```

## Scope and precedence

When the same variable name is defined at several sources, GitLab
resolves it by a fixed precedence. Highest priority wins:

| Priority | Source |
|----------|--------|
| 1 (highest) | Trigger variables, scheduled-pipeline variables, manual (`web`) run variables |
| 2 | Project variables |
| 3 | Group variables (nearest subgroup first, then parent groups) |
| 4 | Instance variables |
| 5 | `.gitlab-ci.yml` global `variables:` |
| 6 (lowest) | `.gitlab-ci.yml` job `variables:` |

The counter-intuitive part: a value set in the UI (project/group/
instance) or via a trigger **overrides** the YAML. This is deliberate —
it lets an operator override a committed default at run time without a
commit. Predefined variables sit alongside this table and are generally
not overridable.

Group and project variables also carry an **environment scope**
(`environment_scope`): a variable can be limited to `production`,
`review/*`, or `*` (all). A job picks up only the variables whose scope
matches its `environment:` name.

## Variable types and flags

### `variable` vs `file` type

Every CI/CD variable has a **type**:

- **`variable`** (default) — the value is exported as an environment
  variable verbatim.
- **`file`** — GitLab writes the value to a temporary file and exports
  the **path** to that file as the environment variable. This is the
  correct channel for anything a tool expects as a file: TLS
  certificates, a `kubeconfig`, a GCP service-account JSON, an SSH key.

```yaml
deploy:
  script:
    # KUBECONFIG is a file-type variable: $KUBECONFIG is a path, not YAML.
    - kubectl --kubeconfig "$KUBECONFIG" apply -f manifests/
    # GOOGLE_APPLICATION_CREDENTIALS is a file-type variable too.
    - gcloud auth activate-service-account --key-file "$GOOGLE_APPLICATION_CREDENTIALS"
```

Storing a certificate in a `variable`-type variable and then
`echo`-ing it into a file inside `script:` defeats masking and risks
trace leakage — use `file` type instead.

### Masked variables

A variable flagged **masked** has its value replaced with `[MASKED]` in
job logs. GitLab enforces masking eligibility requirements on the value:

- at least 8 characters long;
- a single line (no newlines or whitespace);
- drawn from a restricted character set (Base64 alphabet plus `@:.~`),
  depending on GitLab version. Values with spaces, `$`, `"`, or `'`
  cannot be masked.

Masking caveats — treat masking as a safety net, not a guarantee:

- Masking is **best-effort substring replacement** in the trace. A
  secret that is split (`echo "${TOKEN:0:8}"`), transformed
  (base64-decoded, uppercased, URL-encoded), or concatenated bypasses
  the matcher and prints in clear.
- Masking redacts **only the job log**. It does **not** redact
  artifacts, caches, the dotenv report, or anything your job writes to
  an external system. A masked secret printed into a file and uploaded
  as an artifact is leaked in plaintext.
- Masking does not stop a malicious `.gitlab-ci.yml` from exfiltrating
  the value over the network. Masking defends against accidental
  disclosure, not against a hostile pipeline author.

### Protected variables

A variable flagged **protected** is exposed **only** to pipelines
running on a **protected branch** or **protected tag**. A pipeline for
a regular feature branch or a fork merge request never receives it.
This is the primary defense against a contributor reading production
credentials by pushing a branch that echoes them.

**Default discipline for any credential: masked + protected.** Mask it
so an accidental `echo` does not print it; protect it so only trusted
refs can run the job that consumes it. A credential missing either flag
is a finding.

### Raw vs expanded values

By default GitLab performs **variable expansion**: a `$`-prefixed token
inside a value is expanded against other variables. A secret containing
a literal `$` (e.g. a bcrypt hash, some passwords) is corrupted by
expansion. Flag the variable **raw** (`Expand variable reference` off,
or `raw: true` in the API) to disable expansion and keep the literal
value.

### Manual-run prompts

A top-level `variables:` entry can declare `value` and `description`;
the `description` turns the variable into a prefilled, documented field
on the manual "Run pipeline" form.

```yaml
variables:
  DEPLOY_ENV:
    value: "staging"
    description: "Target environment for a manual deploy (staging|production)."
```

## External secrets (`secrets:`)

The `secrets:` keyword fetches a value from an external manager at job
start and exposes it as a `file`-type variable by default. The job
never stores the secret in GitLab. It requires an `id_tokens:` JWT (see
below) for the manager to authenticate the pipeline.

### HashiCorp Vault

```yaml
deploy:
  id_tokens:
    VAULT_ID_TOKEN:
      aud: https://vault.example.com
  secrets:
    DATABASE_PASSWORD:
      vault: prod/db/password@ops      # secret path @ KV mount
      token: $VAULT_ID_TOKEN           # JWT used to auth to Vault
      file: false                      # export as a plain env var, not a file
  script:
    - psql "postgres://app:${DATABASE_PASSWORD}@db/app"
```

Vault is configured with the JWT auth method and a role whose
`bound_audiences` and `bound_claims` (e.g. `project_id`, `ref`,
`ref_type`) match the GitLab token. `secrets:[].file` controls whether
the resolved value lands in a temp file (default `true`) or an env var;
`secrets:[].token` names the `id_tokens:` entry used to authenticate.

### Azure Key Vault

```yaml
deploy:
  id_tokens:
    AZURE_ID_TOKEN:
      aud: https://AzureADTokenExchange
  secrets:
    DB_PASSWORD:
      azure_key_vault:
        name: db-password
        version: 00000000000000000000000000000000
      token: $AZURE_ID_TOKEN
```

The project's CI/CD settings declare the vault server URL; the app
registration carries a federated credential whose subject matches the
pipeline.

### GCP Secret Manager

```yaml
deploy:
  id_tokens:
    GCP_ID_TOKEN:
      aud: https://iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/gitlab/providers/gitlab
  secrets:
    API_KEY:
      gcp_secret_manager:
        name: api-key
        version: latest
      token: $GCP_ID_TOKEN
```

GCP is configured with a Workload Identity Pool provider that trusts
the GitLab issuer and maps the JWT claims to a service account that can
read the secret.

## OIDC federation (`id_tokens:`)

For cloud credentials, **prefer OIDC over a long-lived access key stored
as a CI/CD variable**. The runner mints a short-lived JWT signed by the
GitLab instance's OIDC provider (issuer = the GitLab base URL, e.g.
`https://gitlab.example.com`). The cloud side validates the token's
claims and issues a temporary credential.

Benefits, mirroring any OIDC story:

- No long-lived secret to rotate, mask, or leak.
- Per-project, per-ref scoping — a `main` deploy gets a token whose
  `sub` includes `ref:main`.
- An audit trail in both GitLab and the cloud provider.

GitLab JWT claims you bind trust against include `iss` (the issuer
URL), `aud` (set per `id_tokens:` entry), `project_path`,
`namespace_path`, `ref`, `ref_type`, and a composite `sub` of the form:

```text
project_path:my-group/my-project:ref_type:branch:ref:main
```

### AWS

```yaml
deploy:
  id_tokens:
    AWS_ID_TOKEN:
      aud: https://gitlab.example.com   # must match the OIDC provider audience
  script:
    - >
      aws sts assume-role-with-web-identity
      --role-arn "$AWS_ROLE_ARN"
      --role-session-name gitlab-$CI_PIPELINE_ID
      --web-identity-token "$AWS_ID_TOKEN"
      --duration-seconds 3600
```

Trust policy on the IAM role (snippet):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::123456789012:oidc-provider/gitlab.example.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "gitlab.example.com:aud": "https://gitlab.example.com"
      },
      "StringLike": {
        "gitlab.example.com:sub":
          "project_path:my-group/my-project:ref_type:branch:ref:main"
      }
    }
  }]
}
```

### Google Cloud (Workload Identity Federation)

```yaml
deploy:
  id_tokens:
    GCP_ID_TOKEN:
      aud: https://iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/gitlab/providers/gitlab
  script:
    - echo "$GCP_ID_TOKEN" > token.jwt
    - >
      gcloud iam workload-identity-pools create-cred-config
      projects/123/locations/global/workloadIdentityPools/gitlab/providers/gitlab
      --service-account="gitlab-deploy@my-project.iam.gserviceaccount.com"
      --credential-source-file=token.jwt
      --output-file=cred.json
    - export GOOGLE_APPLICATION_CREDENTIALS=cred.json
```

The WIF provider declares an attribute mapping (e.g.
`google.subject = assertion.sub`) and an attribute condition pinning
the allowed `project_path` / `ref`.

### Azure

```yaml
deploy:
  id_tokens:
    AZURE_ID_TOKEN:
      aud: api://AzureADTokenExchange
  script:
    - >
      az login --service-principal
      --username "$AZURE_CLIENT_ID"
      --tenant "$AZURE_TENANT_ID"
      --federated-token "$AZURE_ID_TOKEN"
```

The Azure side configures a **federated credential** on the app
registration whose issuer is the GitLab URL and whose subject matches
the pipeline's `sub` claim.

## Exfiltration anti-patterns and common pitfalls

### Hardcoded secret literals

```yaml
# BAD: the secret is committed to the repo, visible to anyone with read
# access and to the full git history forever.
variables:
  API_TOKEN: "glpat-XXXXXXXXXXXXXXXXXXXX"
```

Define credentials as masked + protected CI/CD variables in project
settings, never in `.gitlab-ci.yml`.

### Secrets in a global `variables:`

```yaml
# BAD: a top-level variables: block is in scope for every job in the
# pipeline — maximal blast radius.
variables:
  DEPLOY_KEY: "..."          # also a hardcoded literal — doubly wrong
```

Bind a credential to the single job that needs it via `job.variables:`,
or scope the CI/CD variable to the deploy environment.

### Echoing a variable to the log

```yaml
# BAD: even a masked variable can leak if transformed before printing,
# and the value still reaches any artifact/cache written next.
script:
  - echo "$DEPLOY_TOKEN"
  - echo "token is $DEPLOY_TOKEN"
```

Never debug by printing a secret. Print a length or a checksum instead:

```yaml
script:
  - echo "Token length: ${#DEPLOY_TOKEN}"
```

### `set -x` shell trace

```yaml
# BAD: shell trace prints every expanded command, including the
# resolved value of a secret variable, and masking may not catch it.
script:
  - set -x
  - curl -H "Authorization: Bearer $TOKEN" https://api.example.com
```

Keep `set -x` (and `CI_DEBUG_TRACE: "true"`) out of jobs that touch
credentials. `CI_DEBUG_TRACE` in particular dumps **all** variables,
masked or not, and must never run on a job with protected secrets.

### Structured JSON in one variable

A single `CLOUD_CONFIG` variable holding a JSON blob is convenient for
setup but defeats per-key rotation and per-key masking (the blob fails
the no-whitespace masking rule anyway). Split into individual variables,
or fetch the structured secret at runtime via `secrets:` so each key is
resolved and handled independently.

### A variable that should be masked or protected

A CI/CD variable whose value is sensitive on inspection (a token, a
URL embedding a token, a password) but is missing the **masked** or
**protected** flag is a secret in disguise. If it is sensitive, set
both flags.

### Secrets reaching fork pipelines

A merge request from a fork runs in the fork's context. **Protected**
variables are withheld from such pipelines by design — which is exactly
why every credential must be protected. Do not relax the
"only-protected-branches-can-run-this-job" rules to make a fork MR
pipeline "just work"; gate privileged work behind a protected branch
and a manual approval instead.

### Offline scan

This skill ships `scripts/check-secrets-exposure.sh`, which scans a
`.gitlab-ci.yml` offline for several of the patterns above — hardcoded
secret literals, `echo $TOKEN`-style log leaks, `set -x` /
`CI_DEBUG_TRACE` in credential jobs, and global `variables:` holding a
likely secret. Run it before committing pipeline changes.

## Auditing

Periodic audit checklist:

- Review every project, group, and instance CI/CD variable: confirm
  every credential is flagged **masked** and **protected**. Flag any
  sensitive value missing either flag.
- Rotate long-lived tokens stored as variables on a schedule; prefer
  migrating each to `secrets:` (external manager) or `id_tokens:`
  (OIDC) so there is nothing long-lived to rotate.
- Grep the `.gitlab-ci.yml` for hardcoded secret literals and for
  `echo`/`set -x`/`CI_DEBUG_TRACE` on jobs that consume credentials
  (the `check-secrets-exposure.sh` validator does this).
- Confirm no credential lives in a global `variables:` block; bind each
  to its job or environment scope.
- For each cloud provider, audit the OIDC trust conditions: the `aud`
  must match the configured audience and the `sub`/`project_path`/`ref`
  bindings must pin the allowed projects and refs — no wildcard that
  admits an unintended project.
