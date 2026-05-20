# Secrets and variables reference

Secrets and variables are the two channels GitHub Actions offers for
injecting configuration into a workflow run. The choice between them
is the choice between confidentiality and observability. Use the
wrong one and you either leak credentials to logs or accidentally
encrypt a value you needed to debug.

## Secrets vs. variables

| Property | Secrets | Variables |
|----------|---------|-----------|
| Storage | Encrypted at rest (libsodium sealed box). | Plaintext. |
| Reachable via API after creation | No (write-only). | Yes (read/write). |
| Log masking | Yes — masked automatically. | No. |
| Available to fork PRs | No. | Yes (read-only). |
| Intended use | Credentials, tokens, signing keys. | URLs, flags, non-sensitive config. |
| Expression | `${{ secrets.NAME }}` | `${{ vars.NAME }}` |

Variables exist because misusing secrets for non-sensitive config is
both inconvenient (you can't read them back) and dangerous (you train
people to ignore the "masked" tag). Use variables for everything that
is not a credential.

## Scope and precedence

Both secrets and variables have three scopes:

1. **Organisation.** Visible to a configurable set of repositories.
   Best for shared credentials (Docker registry, npm publish token).
2. **Repository.** Repository-wide, visible to all environments.
3. **Environment.** Scoped to a deployment environment (`staging`,
   `production`). Combined with required reviewers and wait timers,
   environments are the correct primitive for promotion gates.

Precedence on name collision: **environment > repository > organisation**.
A `secrets.AWS_ROLE` defined at all three levels resolves to the
environment value.

## Defining and consuming

### Repository-level

`Settings → Secrets and variables → Actions → New repository secret` (or
`New variable`). From a workflow:

```yaml
- env:
    NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
    LOG_LEVEL: ${{ vars.LOG_LEVEL }}
  run: npm publish
```

### Organisation-level

`Org settings → Secrets and variables → Actions`. Specify the
repository access policy: all, private only, or a selected list.

### Environment-level

The job declares `environment:`:

```yaml
jobs:
  deploy:
    runs-on: ubuntu-24.04
    environment:
      name: production
      url: https://app.example.com
    steps:
      - env:
          DEPLOY_KEY: ${{ secrets.DEPLOY_KEY }}
        run: ./scripts/deploy.sh
```

Environments support:

- **Required reviewers.** Up to 6 users/teams whose approval is
  needed before the job runs.
- **Wait timer.** Delay between PR approval and job execution
  (useful for canary rollouts).
- **Deployment branches.** Restrict which refs may target the
  environment.

## Masking

GitHub masks any **literal substring** of a secret in log output and
in the run summary. Three caveats:

- Masking is **substring-based**, not token-based. A 4-character
  secret will mask every occurrence of that 4-character sequence,
  including in unrelated output — and conversely, splitting a secret
  with `echo "${SECRET:0:8}…${SECRET:8}"` bypasses masking.
- Masking does **not** redact secrets from artifacts, from caches,
  or from external systems your job writes to. A secret printed into
  a file and uploaded as an artifact is leaked in plaintext.
- The runner masks `secrets.*` values automatically. To mask a
  derived value, use the workflow command
  `echo "::add-mask::$VALUE"` before printing it.

## OIDC federation

For cloud credentials, **prefer OIDC over long-lived secrets**. The
runner mints a short-lived JWT signed by GitHub's OIDC provider; the
cloud side validates the token's claims (`sub`, `repository`, `ref`,
`environment`, `job_workflow_ref`) and issues a temporary cloud
credential.

Benefits:

- No long-lived secret to rotate or leak.
- Per-job, per-environment scoping — a `production` deploy job gets
  a token whose `sub` includes `environment:production`.
- Audit trail in both GitHub and the cloud provider.

### AWS

Trust policy on the IAM role (snippet):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
      },
      "StringLike": {
        "token.actions.githubusercontent.com:sub":
          "repo:my-org/my-repo:environment:production"
      }
    }
  }]
}
```

In the workflow:

```yaml
permissions:
  id-token: write   # required to request the OIDC token
  contents: read
steps:
  - uses: aws-actions/configure-aws-credentials@<sha>  # v4.x
    with:
      role-to-assume: arn:aws:iam::123456789012:role/gha-deploy
      aws-region: eu-west-3
```

### Google Cloud (Workload Identity Federation)

```yaml
permissions:
  id-token: write
  contents: read
steps:
  - uses: google-github-actions/auth@<sha>  # v2.x
    with:
      workload_identity_provider: projects/123/locations/global/workloadIdentityPools/gha/providers/github
      service_account: gha-deploy@my-project.iam.gserviceaccount.com
```

The WIF provider declares attribute mappings (e.g., `attribute.repository`)
and an attribute condition pinning the allowed repos / environments.

### Azure

```yaml
permissions:
  id-token: write
  contents: read
steps:
  - uses: azure/login@<sha>  # v2.x
    with:
      client-id: ${{ vars.AZURE_CLIENT_ID }}
      tenant-id: ${{ vars.AZURE_TENANT_ID }}
      subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}
```

The Azure side configures a **federated credential** on the app
registration with the matching subject (`repo:my-org/my-repo:environment:production`).

### HashiCorp Vault

Use the JWT/OIDC auth method with a role whose
`bound_subject` / `bound_claims` match the GitHub token.

```yaml
- uses: hashicorp/vault-action@<sha>  # v3.x
  with:
    url: https://vault.example.com
    method: jwt
    role: gha-deploy
    secrets: |
      kv/data/prod/db password | DB_PASSWORD
```

## Common pitfalls

### Secrets in top-level `env:`

```yaml
# BAD: every job and every step in the workflow sees the secret
env:
  DEPLOY_KEY: ${{ secrets.DEPLOY_KEY }}
```

Bind secrets to the smallest scope that needs them — a specific
step's `env:` is ideal.

### Interpolating secrets into `run:`

```yaml
# BAD: the secret is evaluated by the YAML expression layer and
# pasted into the shell verbatim. Quoting is brittle, and if the
# secret contains shell metacharacters the script breaks (or worse).
- run: echo "${{ secrets.API_TOKEN }}" | gh auth login --with-token

# GOOD: bind via env, reference as a shell variable.
- env:
    API_TOKEN: ${{ secrets.API_TOKEN }}
  run: printf '%s' "$API_TOKEN" | gh auth login --with-token
```

### Passing secrets to reusable workflows

```yaml
# BAD: re-listing every secret manually invites omissions.
- uses: my-org/shared/.github/workflows/deploy.yml@<sha>
  secrets:
    NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
    DEPLOY_KEY: ${{ secrets.DEPLOY_KEY }}

# GOOD when the callee is trusted: inherit all caller secrets.
- uses: my-org/shared/.github/workflows/deploy.yml@<sha>
  secrets: inherit
```

`secrets: inherit` only works when both workflows are in the **same
organisation**. For cross-org consumption, list explicitly.

### Echoing a secret to debug

```yaml
# BAD: the runner masks the echoed value, but the secret is still
# present in the artifact / cache / step summary you write next.
- run: echo "DEBUG: token is $TOKEN"
```

Never debug a workflow by printing a secret. Print a checksum or a
length instead:

```yaml
- run: echo "Token length: ${#TOKEN}"
```

### Storing structured data in a single secret

A JSON blob in `secrets.CLOUD_CONFIG` is convenient for setup but
defeats per-key rotation. Split into individual secrets, or use a
secret-manager action (`hashicorp/vault-action`,
`aws-actions/aws-secretsmanager-get-secrets`) to fetch a structured
secret at runtime — the per-key value is then masked individually.

### Variables that should be secrets

A `vars.WEBHOOK_URL` whose URL embeds a token is a secret in
disguise. If the value is sensitive on inspection, it is a secret.

### Secrets visible to fork PRs

By default, fork PRs receive **no secrets**. `pull_request_target`
gives them the **base** repository's secrets, which is why it is
dangerous to combine with `actions/checkout` of the PR head. If you
must run privileged work against a fork PR, gate it behind an
environment with required reviewers.

## Auditing

Periodic audit checklist:

- List repository secrets: `gh secret list` — flag any that have not
  been read in 90 days; rotate or delete.
- List org-wide secrets and their repo access list. Tighten scope.
- Inspect workflows for top-level `env:` referencing `secrets.*`.
- Search for `${{ secrets.` patterns in `run:` blocks (the
  `scripts/check-secrets-exposure` validator does this).
- For each cloud provider, audit the OIDC trust conditions and ensure
  every long-lived access key has a migration plan.
