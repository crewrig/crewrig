# ADR 0002 — e2e dedicated-account auth flow (`~/.crewrig-e2e/<cli>/`)

<!-- crewrig-doc: section=architecture-adr nav_order=20 published=true title="ADR 0002 — e2e dedicated-account auth flow" -->

## Status

Proposed — 2026-05-23. Scoped to issue #77 (child of epic #75). Builds
on ADR 0001 (Docker images).

## Context

The e2e harness must run real CLI agents against scripted scenarios.
Authenticating each scenario interactively is incompatible with batch
execution, and reusing the developer's personal CLI sessions risks
leaking work into the host's `~/.claude`, `~/.gemini`, `~/.copilot`.

The high-level decision is locked: a host directory
`~/.crewrig-e2e/<cli>/` holds credentials for an **isolated test
account** and is bind-mounted **read-only** into scenario containers.
This ADR specifies HOW each CLI populates and consumes that directory.

All credential surfaces below were verified empirically against the
images built from ADR 0001 (`crewrig/e2e-<role>:latest`) on
2026-05-23. Evidence is captured inline.

## Decision 1 — One auth script per CLI, persistent host dir

For each CLI we ship `scripts/e2e/auth-<cli>.sh` and a Taskfile entry
`e2e:auth:<cli>`. The script is idempotent: re-running it on an
already-authenticated dir MUST NOT clobber credentials.

Common skeleton (pseudo):

```sh
DIR="${HOME}/.crewrig-e2e/<cli>"
mkdir -p "${DIR}"
# 1. Writability bootstrap (see Decision 6 — required on macOS VirtioFS).
chmod a+rwx "${DIR}"
# 2. Interactive auth (RW mount, TTY).
docker run --rm -it \
  -v "${DIR}:/home/agent/.<cli>" \
  crewrig/e2e-<cli>:latest \
  <cli-specific-command>
# 3. Sanity: at least one credential file must exist on the host now.
```

Test runs use the same dir mounted **read-only**:

```sh
docker run --rm \
  -v "${HOME}/.crewrig-e2e/<cli>:/home/agent/.<cli>:ro" \
  crewrig/e2e-<cli>:latest \
  <scenario-command>
```

## Decision 2 — Claude Code: OAuth file + long-lived token fallback

**Verified surface (empirical + upstream docs).** On Linux (and inside
our Debian slim containers) Claude Code persists credentials to
`~/.claude/.credentials.json` and configuration to
`~/.claude/.claude.json`. **Both files are required** to skip the login
prompt on subsequent runs — persisting only `.credentials.json` causes
the CLI to treat the session as a fresh install (upstream issue
[tfvchow/field-notes-public#10](https://github.com/tfvchow/field-notes-public/issues/10)).
The macOS keychain path applies only to the host CLI, not to our
containerized flow.

**Recommendation: hybrid — OAuth (default) with env-var override.**

- Interactive: `task e2e:auth:claude` runs `claude /login` in a
  TTY-attached container with the host dir bind-mounted RW. The user
  completes the browser flow on the host; credentials land in
  `~/.crewrig-e2e/claude/{.credentials.json,.claude.json}`.
- Headless override: scenarios MAY set `CLAUDE_CODE_OAUTH_TOKEN`
  (minted via `claude setup-token` — confirmed available in the image:
  `claude setup-token --help` → "Set up a long-lived authentication
  token (requires Claude subscription)") or `ANTHROPIC_API_KEY` as a
  per-run env var sourced from the host shell. These bypass the
  on-disk credential entirely and MUST NOT be written into
  `~/.crewrig-e2e/claude/`.

Token lifecycle: OAuth session tokens refresh automatically while
`.credentials.json` is writable — which it is **not** under the RO
test mount. Tests that span past the refresh window MUST use the
`setup-token` long-lived OAuth token (recommended for CI by
upstream). Re-auth cadence: re-run `task e2e:auth:claude` when a
scenario fails with an auth error.

## Decision 3 — Gemini CLI: OAuth file + API key fallback

**Verified surface.** Gemini CLI persists OAuth credentials at
`~/.gemini/oauth_creds.json` and selected auth type at
`~/.gemini/settings.json` (upstream:
<https://geminicli.com/docs/get-started/authentication/>). API-key
mode uses `GEMINI_API_KEY` (or `GOOGLE_API_KEY` for Vertex) and writes
nothing to disk.

**Recommendation: hybrid — OAuth (default) with API-key override.**

- Interactive: `task e2e:auth:gemini` launches `gemini` in a
  TTY-attached container; the user picks "Login with Google" and
  completes the browser flow. Resulting files land in
  `~/.crewrig-e2e/gemini/{oauth_creds.json,settings.json}`.
- Headless override: `GEMINI_API_KEY` sourced from host shell at run
  time. Never written to the e2e dir.

Token lifecycle: OAuth refresh tokens live in `oauth_creds.json` and
are renewed by the CLI on first run within the validity window. Under
the RO mount the refresh write will fail silently; this is acceptable
for short-lived scenarios. Re-auth cadence: re-run `task
e2e:auth:gemini` if a scenario hits `CREDENTIALS_MISSING`.

## Decision 4 — Copilot CLI: env-var token (PAT/GH_TOKEN) as v1 path

**Verified surface (empirical, 2026-05-23).** `copilot --version`
inside `crewrig/e2e-copilot:latest` reports `1.0.51`. The image
contains **no libsecret** (`ldconfig -p | grep libsecret` returns
empty), so the CLI cannot use the OS keychain path documented for
desktop installs. Upstream behavior in this case
(<https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli>):
fall back to plaintext `~/.copilot/config.json`, with user settings
in `~/.copilot/settings.json` since v1.0.35.

Running `copilot` cold in the image produces the canonical bootstrap
error:

```text
Error: No authentication information found.
  • Start 'copilot' and run the '/login' command
  • Set the COPILOT_GITHUB_TOKEN, GH_TOKEN, or GITHUB_TOKEN env var
  • Run 'gh auth login' to authenticate with the GitHub CLI
```

Authentication precedence (upstream):
`COPILOT_GITHUB_TOKEN > GITHUB_TOKEN > GH_TOKEN > gh CLI > GITHUB_ASKPASS > OAuth device flow`.

**Recommendation: env-var token (PAT) as the v1 path; document
device-flow as a stretch goal.**

- Primary: `task e2e:auth:copilot` is a *guidance* script that prints
  the PAT creation URL for the dedicated test account
  (<https://github.com/settings/tokens>, fine-grained, `Copilot`
  scope) and the export line to add to the developer's shell. No
  container is launched, no on-disk credential is written. Scenarios
  consume `COPILOT_GITHUB_TOKEN` from the host shell at run time.
- Stretch (deferred until a scenario actually needs it): an
  interactive `copilot /login` flow that writes
  `~/.crewrig-e2e/copilot/config.json`. The mechanic works (plaintext
  fallback is documented and the image lacks libsecret), but the
  developer-friction tax is higher (open second terminal to copy the
  device code, browser handoff) for no scenario-coverage gain over
  the PAT path.

Token lifecycle: fine-grained PATs default to **90 days** with
configurable expiry; classic PATs can be no-expiry but are deprecated
upstream. Re-auth cadence: rotate the PAT before expiry and update
the host shell export.

**Why this departs from the epic's "device-flow" framing.** Epic #75
flagged copilot auth as the highest-risk surface specifically because
device flow in a headless container was unproven. The empirical
evidence above shows device flow CAN be made to work (plaintext
fallback path is open), but the env-var precedence chain means we
get a strictly simpler v1 with the same scenario coverage. Filing
device-flow as a follow-up when a real scenario demands it.

## Decision 5 — Mount-and-run protocol per CLI

Auth flow (one-shot, interactive, RW):

| CLI | Image | Bind mount (host → container) | Entry-point |
|---|---|---|---|
| claude | `crewrig/e2e-claude:latest` | `~/.crewrig-e2e/claude` → `/home/agent/.claude` (rw) | `claude /login` |
| gemini | `crewrig/e2e-gemini:latest` | `~/.crewrig-e2e/gemini` → `/home/agent/.gemini` (rw) | `gemini` (pick "Login with Google") |
| copilot | n/a (v1) | n/a | guidance script prints PAT export |

Test run (per scenario, RO):

| CLI | Bind mount | Env vars (from host shell, NOT on disk) |
|---|---|---|
| claude | `~/.crewrig-e2e/claude` → `/home/agent/.claude:ro` | optional: `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` |
| gemini | `~/.crewrig-e2e/gemini` → `/home/agent/.gemini:ro` | optional: `GEMINI_API_KEY` |
| copilot | none | required: `COPILOT_GITHUB_TOKEN` (or `GH_TOKEN`) |

No `HOME` or `XDG_*` overrides are needed: the base image already
sets `HOME=/home/agent` for the `agent` user (uid 1000) and pre-creates
the mount points (ADR 0001 Decision 4).

## Decision 6 — Host-side bootstrap and the macOS writability trap

**Empirical finding (2026-05-23, macOS + Docker Desktop VirtioFS).**
A freshly-created `~/.crewrig-e2e/<cli>/` on the host appears inside
the container as `root:root`, not `agent:agent` (uid 1000). The
`agent` user therefore cannot write to it, and the very first
`/login` invocation fails with `Permission denied`. Reproduction:

```text
$ mkdir -p /tmp/probe && docker run --rm \
    -v /tmp/probe:/home/agent/.claude crewrig/e2e-claude:latest \
    bash -c 'touch /home/agent/.claude/x'
touch: cannot touch '/home/agent/.claude/x': Permission denied
```

**Original mitigation (2026-05-23) — RETIRED.** A `docker run --user
root chown` step was introduced to transfer ownership to uid 1000
inside the container. This broke on macOS Docker Desktop ≥ 4.x with
VirtioFS: Docker Desktop's user namespace remapping translates the
container's uid 0 to the macOS host user at the VirtioFS layer, so
the container's root cannot chown to a different uid — even with
`--privileged`.

```sh
# RETIRED — fails with "Permission denied" on macOS VirtioFS
docker run --rm --user root \
  -v "${DIR}:/home/agent/.<cli>" \
  crewrig/e2e-<cli>:latest \
  chown -R 1000:1000 /home/agent/.<cli>
```

**Current mitigation (2026-05-25, issue #96) — `chmod a+rwx` on the
host.** The host user always owns the directory (created by `mkdir -p`
immediately before); `chmod` is therefore unconditionally permitted
without Docker. The container's `agent` user (uid 1000) gains write
access via the world-write bit. Files written by the container retain
uid 1000 ownership, which read-only scenario mounts can access later.

```sh
chmod a+rwx "${DIR}"
```

Implemented in `scripts/e2e/lib/auth-common.sh:e2e_chown_bootstrap`.
The function signature (`<cli> <image>`) is preserved for call-site
compatibility; the `image` parameter is no longer used.

Idempotency: the chmod step is safe to re-run on a populated dir. The
auth script MUST NOT delete or overwrite existing credential files —
only create the directory if missing and re-assert writability.

## Decision 7 — Security posture

- **RO mount enforced at scenario time.** Verified that
  `-v <dir>:<target>:ro` blocks writes from inside the container
  (`touch` → "Read-only file system"). Tests SHOULD include one
  assertion that writes to `/home/agent/.<cli>/` fail under the RO
  mount; ADR 0001 already shows the image responds correctly.
- **Missing host dir → SKIP, not fail.** When
  `~/.crewrig-e2e/<cli>/` is absent at scenario start, the test
  runner MUST emit a SKIP with a pointer to `task e2e:auth:<cli>`,
  not let `docker run` create an empty root-owned dir. This avoids
  the macOS ownership trap (Decision 6) leaking into CI.
- **No API keys on disk.** `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`,
  `GH_TOKEN`, `COPILOT_GITHUB_TOKEN`, and the Ollama Cloud token are
  read from the host shell at run time and passed via `docker run -e
  <NAME>`. They MUST NEVER be written to `~/.crewrig-e2e/`. The auth
  scripts MUST refuse to proceed if they detect an `*_API_KEY` value
  inside a credential file under that path.
  (The Ed25519 keypair on disk per Decision 8 is the actual Ollama Cloud credential; no separate token is involved.)
- **Rotation / revocation.** Document in
  `tests/e2e/README.md`: deleting `~/.crewrig-e2e/<cli>/` and
  re-running `task e2e:auth:<cli>` is the canonical full reset. PATs
  (copilot) are rotated upstream at <https://github.com/settings/tokens>.
- **Dedicated test account.** The user is responsible for creating
  and gating access to the dedicated GitHub / Google / Anthropic test
  account. The framework only persists what that account authorizes.

## Decision 8 — Ollama Cloud signin: Ed25519 keypair on disk

**Verified surface (empirical, 2026-05-26).** The base image
(`docker/e2e/base.Dockerfile`) installs the `ollama` client via the
official install script. `ollama signin` on first run generates an
Ed25519 keypair at `~/.ollama/id_ed25519` (private, `0600`) and
`~/.ollama/id_ed25519.pub` (public), then prints a URL the user opens
on the host browser to register the public key against an
ollama.com account. Subsequent `ollama launch <model>` calls
authenticate to ollama.com by signing requests with the private key.

This surfaces only when `tests/e2e/local.toml` routes Copilot through
Ollama Cloud (see `tests/e2e/local.toml.example`); the canonical
Copilot scenario flow (Decision 4) remains env-var only.

**Recommendation: interactive `ollama signin` in a TTY container,
mirroring the claude/gemini pattern.**

- Interactive: `task e2e:auth:ollama` runs `ollama signin` in a
  TTY-attached container, reusing `crewrig/e2e-copilot:latest` (the
  same image scenarios will exec against — guarantees client-version
  parity). The user completes the browser registration on the host.
  Resulting keypair lands in
  `~/.crewrig-e2e/ollama/{id_ed25519,id_ed25519.pub}`.
- Headless override: none. Unlike Claude (`CLAUDE_CODE_OAUTH_TOKEN`)
  or Gemini (`GEMINI_API_KEY`), Ollama's cloud auth has no env-var
  equivalent — the keypair on disk is the only path. `OLLAMA_HOST`
  selects the endpoint but does not carry credentials.

**Why interactive (not env-var only).** Ollama's cloud auth model is
deliberately key-based: there is no documented "Ollama API key" that
the CLI accepts at run time. Faking one by writing a synthesized
keypair to disk is technically possible but defeats the registration
step (the public key must be enrolled against the account upstream
via the browser flow). The browser flow is therefore unavoidable
exactly once per machine + test account.

**`id_ed25519` persistence strategy.** The private key file is the
load-bearing artifact. It is created by the container as `agent:agent`
(uid 1000) thanks to the Decision 6 writability bootstrap, and
re-mounted RO at scenario time. The key does not expire on a clock —
it is revoked server-side when the user deletes the device from the
ollama.com account dashboard. Re-auth cadence: re-run
`task e2e:auth:ollama` after a manual revocation.

**Chown bootstrap requirement.** Same VirtioFS trap as Decision 6.
The auth script calls `e2e_chown_bootstrap "ollama" "$IMAGE"` before
the signin container launches; without it, the keypair generation
inside the container fails with "Permission denied" on macOS
Docker Desktop ≥ 4.x. The bootstrap is idempotent and safe to re-run
on a populated dir.

**No API-key on disk.** The Ollama Cloud token mentioned in
Decision 7's security posture is **not** the same artifact as the
Ed25519 private key. The keypair is the credential; no separate
`OLLAMA_API_KEY` env var or file is involved. The auth script
defensively rejects any `*api*key*` filename under the dir.

## Open risks

1. **OAuth refresh writes vs. RO mount.** Both Claude and Gemini
   refresh access tokens by overwriting the credential file. Under
   `:ro` this fails silently; if a scenario session outlives the
   access-token TTL (typically ~1 h for both) the run will error
   mid-scenario. Mitigation: keep scenarios short, and for long ones
   prefer `CLAUDE_CODE_OAUTH_TOKEN` / `GEMINI_API_KEY` env-var paths.
   Future work: optional `:rw` "long scenario" mode flagged per test.
2. **Device-binding on OAuth tokens.** Some IdPs bind tokens to a
   device fingerprint; if Claude or Gemini ever ship that, the
   host-issued OAuth file would be rejected inside the container.
   Not observed today; track upstream.
3. **PAT expiry cadence (copilot).** Fine-grained PATs default to
   90 days. Without a calendar reminder, CI will silently start
   failing. Mitigation: print expiry in `task e2e:auth:copilot`
   output and add a quarterly maintenance task to the runbook.
4. **Multiple credential paths for copilot.** The error message lists
   `gh auth login` as a viable third path, which writes to
   `~/.config/gh/`, not `~/.copilot/`. We are intentionally NOT
   supporting that path in v1 — the env-var precedence covers the
   same coverage with one less directory to manage.
5. **Multi-user CI runner.** If the e2e harness ever runs on a shared
   CI box, `~/.crewrig-e2e/` must be scoped per-user (e.g.,
   `${CREWRIG_E2E_HOME:-$HOME}/.crewrig-e2e/`). Out of scope for #77
   but flag for the scenarios milestone.

## Blast radius

Near-zero. New files only:

- `scripts/e2e/auth-claude.sh`
- `scripts/e2e/auth-gemini.sh`
- `scripts/e2e/auth-copilot.sh`
- New `e2e:auth:*` entries in `Taskfile.yml` (additive).
- New section in `tests/e2e/README.md` (or first creation of that
  file under #77).

Touch points to verify but **not** change in this ticket:

- `.gitignore` — `~/.crewrig-e2e/` is on the host, outside the repo;
  no entry needed. Confirm the auth scripts never write under the
  repo tree.
- `docs/cli-matrix.md` — the auth flow is meta-tooling, not a
  per-CLI framework artifact; no matrix row required. Re-evaluate
  when scenarios start exercising CLI-specific surfaces.
- `community-config/`, `config/`, `scripts/build-components.sh`, CI
  workflows — all out of scope. Flag back to the team lead if a
  scenario forces a change.

## Sources

- Claude Code authentication — <https://code.claude.com/docs/en/authentication>
- Claude Code credential persistence (devcontainers) — <https://github.com/tfvchow/field-notes-public/issues/10>
- Gemini CLI authentication — <https://geminicli.com/docs/get-started/authentication/>
- GitHub Copilot CLI authentication — <https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli>
- Copilot CLI auth precedence (DeepWiki) — <https://deepwiki.com/github/copilot-cli/6.7-authentication-and-token-management>
- ADR 0001 (e2e Docker images) — `docs/adr/0001-e2e-docker-images.md`
