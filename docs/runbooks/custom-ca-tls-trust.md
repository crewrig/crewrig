# Runbook: custom root CA certificates & native TLS delegation

<!-- crewrig-doc: published=false -->

This runbook explains how to make the tools CrewRig invokes trust a **custom or
corporate root certificate authority (CA)** — the situation you hit behind a
TLS-intercepting corporate gateway (MITM TLS) or against a private Git/registry
server presenting a certificate signed by a private CA. The symptom is a
certificate-trust error such as `invalid peer certificate: UnknownIssuer`,
`SSL: CERTIFICATE_VERIFY_FAILED`, or `x509: certificate signed by unknown
authority` during setup, dependency installation, or first indexing.

The framework only ever **extends trust** to a CA you have already installed in
your operating-system trust store. It never disables or weakens certificate
verification, and this runbook never asks you to.

Platform scope: **macOS and Linux**. Windows is out of scope (spec 0084).

## The one variable that does most of the work

Point the standard trust variables at a PEM bundle that contains your custom
CA. On a corporate machine that bundle is usually the OS consolidated store:

- **Linux (Debian/Ubuntu):** `/etc/ssl/certs/ca-certificates.crt`
  (run `sudo update-ca-certificates` after dropping your CA in
  `/usr/local/share/ca-certificates/`).
- **Linux (RHEL/Fedora):** `/etc/pki/tls/certs/ca-bundle.crt`
  (`sudo update-ca-trust` after adding to `/etc/pki/ca-trust/source/anchors/`).
- **macOS:** add the CA to the System keychain (Keychain Access → System →
  import → set "Always Trust"), or point at an exported PEM file.

Export, replacing `CA` with your bundle path:

```sh
CA=/etc/ssl/certs/ca-certificates.crt
export SSL_CERT_FILE="$CA"
export REQUESTS_CA_BUNDLE="$CA"
export NODE_EXTRA_CA_CERTS="$CA"
export CURL_CA_BUNDLE="$CA"
export PIP_CERT="$CA"
export GIT_SSL_CAINFO="$CA"
export UV_SYSTEM_CERTS=true
```

`UV_SYSTEM_CERTS` is the current uv name; older uv releases call it
`UV_NATIVE_TLS` (now deprecated), and a uv that predates both still honours
`SSL_CERT_FILE`.

`setup-*-interactive.sh` offers to write exactly these lines to
`~/.crewrig/tls-env.sh` for you (see *Automated delegation* below).

## Per-tool trust configuration

Each tool CrewRig invokes reads a different variable. The table maps the
framework's network-touching operations to the mechanism that fixes them.

| Framework operation | Tool | Trust mechanism (macOS + Linux) |
|---|---|---|
| MemPalace install (`pipx install mempalace`, `pipx inject … chromadb`) | pip / uv | `PIP_CERT`, `REQUESTS_CA_BUNDLE`; for uv `UV_SYSTEM_CERTS=true` (use the OS store; `UV_NATIVE_TLS=1` on older uv) or `SSL_CERT_FILE` |
| MCP server launch (`npx …`, sequential-thinking) | Node.js / npm | `NODE_EXTRA_CA_CERTS`; npm also honours `npm config set cafile <CA>` |
| Version control over HTTPS | git | `GIT_SSL_CAINFO=<CA>` (or `git config --global http.sslCAInfo <CA>`) |
| Tool/binary installers (taskfile / yq / plannotator via `curl` or `wget`) | curl / wget | `CURL_CA_BUNDLE`; `curl --cacert <CA>`; `wget --ca-certificate <CA>` |
| Build & CI phases (`npm install`, `apt-get`, registry pulls) | node / apt / … | `NODE_EXTRA_CA_CERTS`, and the OS store the package manager already reads |
| Runtime asset/model downloads (the ChromaDB/MemPalace **embedding model** fetched on first indexing) | Python (requests/urllib) | `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE` |

Never set `NODE_TLS_REJECT_UNAUTHORIZED=0`, `git config http.sslVerify false`,
or `PYTHONHTTPSVERIFY=0`. These disable verification instead of trusting your
CA, and defeat the point of the corporate gateway.

## Automated delegation (opt-in)

When you run an interactive setup script, if it detects a custom-trust context
(a cert/proxy variable already set, or an admin-added CA anchor on Linux) it
**offers** to configure delegation. On consent it:

1. writes the exports above to `~/.crewrig/tls-env.sh` (and nothing else — your
   shell profile is never modified);
2. applies them to the running setup so the immediate bootstrap succeeds;
3. prints the exact lines it wrote.

Remove it in one action:

```sh
rm ~/.crewrig/tls-env.sh
```

If detection does not fire but you know you need it, set the CA explicitly and
re-run setup:

```sh
export CREWRIG_TLS_CA=/path/to/corporate-ca.pem
```

## How trust reaches the framework's runtime (inheritance model)

Processes the framework spawns **inherit the environment** of the parent
command-line tool: hooks, background processes, and sub-agents launched by
Claude Code / Gemini CLI / Copilot CLI / Antigravity CLI receive whatever
certificate and proxy variables the CLI's own environment carries. So if your
interactive shell has the trust variables set, everything the CLI spawns
inherits them for free.

Two runtime paths are launched **later**, in a fresh process that is not a
child of your interactive shell, so the framework wires trust into them
explicitly (without editing your profile):

- **MCP servers** are registered through `scripts/lib/tls-exec.sh`, a small
  wrapper that sources `~/.crewrig/tls-env.sh` (if present) and then `exec`s the
  real server command. A missing file makes the wrapper a transparent no-op.
  The opt-in Playwright MCP server (`task setup:playwright-mcp`, spec 0245) is
  registered the same way on all four assistants; the task requires
  Node.js >= 24. If you ran `task setup:playwright-mcp` before it routed
  through the wrapper, re-run it from the checkout you keep: it converges the
  old registration in place (with a timestamped backup) and leaves a
  customised `playwright` entry untouched.
- **The supervised ChromaDB daemon** (launchd on macOS, systemd-user on Linux)
  runs its `ProgramArguments` / `ExecStart` through the same wrapper, so its
  embedding-model fetch on first indexing inherits the trust.

`scripts/start-chroma-server.sh` sources the managed file at entry, and
`scripts/prune-transcripts.ts` reads it without running it (`readTlsEnv`, spec
0253 R18) and hands its variables to every child it spawns, for the same
reason. The standalone
`task install-mempalace` runs its `pipx install` through `tls-exec.sh` too, so
a MemPalace upgrade outside setup inherits the trust.

The session-recording hook, `hooks/mempalace-transcript.ts` (spec 0247),
**reads** the managed file through `scripts/lib/tls-env.ts` and never
executes or sources it. The reader accepts only the format setup writes:
comment lines, blank lines and `export NAME=VALUE` lines whose value is a
`printf %q` word, with LF or CRLF line endings. It applies the values to the
environment of the one Git process the hook spawns. The hook's own request is
plain HTTP to the local MemPalace daemon, so the trust never changes it. A
malformed file, one holding any other line, is ignored as a whole: the hook
writes one line on standard error naming the file and the first such line
number, and records anyway.

## Impact analysis — framework-triggered network operations

The full set of operations CrewRig triggers that cross the network and thus
require custom-CA trust behind an intercepting gateway:

- **Package/dependency install:** `pipx install mempalace`,
  `pipx inject mempalace chromadb`, and any `npx -y <pkg>` MCP server (the first
  launch fetches the package from the npm registry).
- **Build & CI phases** (`scripts/build-ci.sh` output): `wget` of the `yq`
  binary from GitHub, `curl https://taskfile.dev/install.sh`,
  `npm install -g markdownlint-cli`, and `apt-get … ca-certificates`.
- **Runtime asset/model downloads:** the ChromaDB/MemPalace embedding model,
  fetched on first indexing by the daemon (distinct from the package install).
- **Tool/binary installers:** `plannotator`, `taskfile`, and `yq` install
  scripts fetched via `curl`/`wget`.
- **Version control:** `git` operations over HTTPS against a private forge.

## Troubleshooting

- **`pipx`/`uv` still fails after exporting `SSL_CERT_FILE`:** set
  `UV_SYSTEM_CERTS=true` (`UV_NATIVE_TLS=1` on older uv) so uv reads the OS
  trust store natively, and confirm your CA
  is actually in that store (`update-ca-certificates` / `update-ca-trust` /
  Keychain).
- **`npx` fails but `curl` works:** Node ignores the OS store — it needs
  `NODE_EXTRA_CA_CERTS` specifically. Confirm the variable is exported in the
  process that launches the MCP server (the `tls-exec.sh` wrapper handles this
  when `~/.crewrig/tls-env.sh` exists).
- **The daemon's embedding fetch fails at runtime though setup succeeded:**
  re-run setup so the launchd/systemd unit is re-materialised through
  `tls-exec.sh`, and confirm `~/.crewrig/tls-env.sh` exists.
- **git rejects the private forge:** set `GIT_SSL_CAINFO` (env) or
  `git config --global http.sslCAInfo <CA>`; never `http.sslVerify false`.
- **The CA path is right but still `UnknownIssuer`:** the bundle may be missing
  the full chain — concatenate the intermediate(s) and root into one PEM file.
