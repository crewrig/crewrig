# Org-level MCP server declaration channel

<!-- crewrig-doc: section=reference nav_order=70 published=true title="Org MCP server declaration channel" -->

An adopting organization declares the MCP servers it wants wired into its
agents through a single org-owned file at the repository root:
**`mcp-servers.org.json`**. This is the HOW realization of
[spec 0091](../specs/0091-org-mcp-declaration.md); the WHY and the CLI-first
forge baseline it builds on are recorded in
[ADR-0015](adr/0015-forge-access-cli-only.md) and
[spec 0090](../specs/0090-forge-access-cli-only.md).

The channel is a **declaration artifact**: it maps each server's name to *how
the server is reached and authorized* (transport, endpoint, headers or
environment). It does **not** hold server implementation code — a server the
organization itself *writes and hosts* belongs in `artifacts/community/mcp-servers/`
instead (see [`layers.md`](layers.md)).

Setup translates the manifest into each CLI's native MCP configuration and folds
it in **after** the operator-preservation merge of
[spec 0089](../specs/0089-merge-mcp-declarations.md), so the resolved
precedence is:

```text
framework-reserved  >  org  >  operator-pre-existing
```

The file is org-owned and **excluded** from upstream synchronization
(`.crewrig/core-paths.txt`), exactly like `AGENTS.org.md`: upstream never
modifies, restores, or aborts on it. Upstream ships it empty — a fresh adopter
gets no org MCP server until it populates the channel itself.

## Where declarations go

Setup reads **only the `.mcpServers` object**. Declare your servers there.

```jsonc
{
  "mcpServers": {
    "atlassian": {
      "transport": "http",
      "url": "https://mcp.atlassian.example/mcp",
      "headers": { "Authorization": "Bearer ${ATLASSIAN_TOKEN}" }
    },
    "acme-internal": {
      "transport": "stdio",
      "command": "acme-mcp",
      "args": ["--serve"],
      "env": { "ACME_REGION": "eu-west-1" }
    }
  }
}
```

> **Footgun — do not confuse `_example` with `.mcpServers`.** The shipped file
> carries an inert `_example` block (keyed directly by server name) purely as
> documentation. Setup **never reads `_example`**. A server declared under
> `_example` (or at any key other than `.mcpServers`) is silently **not
> delivered**. Copy it *into* `.mcpServers` to activate it.

## Schema

Each entry under `.mcpServers` is keyed by the server name and carries a
`transport` plus its transport-specific fields:

| Field | Applies to | Meaning |
|---|---|---|
| `transport` | all | `stdio` (default when omitted), `http`, or `sse`. |
| `command` | `stdio` | Executable to launch the server. |
| `args` | `stdio` | Argument array (optional). |
| `env` | `stdio` | Environment variables map (optional). |
| `url` | `http` / `sse` | Endpoint the CLI connects to. |
| `headers` | `http` / `sse` | Request headers map, e.g. an `Authorization` bearer (optional). |

Servers are delivered **as declared** — the framework does not validate,
health-check, deduplicate, or normalize them (spec 0091 *Out of scope*).

## Precedence and collision warnings

- **Reserved names win for the framework (R10).** The names `mempalace` and
  `sequentialthinking` are framework-managed (`MCP_RESERVED_NAMES` in
  `scripts/lib/common.sh`). An org declaration under a reserved name is **not
  applied**; setup prints a non-silent warning.
- **Org wins over an operator's hand-added server (R11).** If an org-declared
  name collides, under a non-reserved name, with a server an operator added by
  hand, the org declaration wins and setup prints a non-silent warning naming
  the server (the operator's prior entry stays in the timestamped backup).
- **Everything else survives (R6).** Any operator server the org channel does
  not name is preserved unchanged.

## Per-CLI delivery

| CLI | stdio | http / sse |
|---|---|---|
| Claude Code | ✅ `claude mcp add --scope user … -- cmd args` | ✅ `claude mcp add --transport http … --header …` |
| Gemini CLI | ✅ native `{command,args,env}` in `~/.gemini/settings.json` | ✅ native `{type,url,headers}` |
| Copilot CLI | ✅ native `{type:"stdio",command,args,env}` in `~/.copilot/mcp-config.json` | ✅ native `{type,url,headers}` |
| Antigravity CLI | ✅ native `{command,args,env}` in `~/.gemini/config/mcp_config.json` | ⚠️ **not delivered** — accepted gap |

**Antigravity + remote transports.** A non-stdio (http/sse) org server is
**skipped on Antigravity with a non-silent warning**, because `agy` exposes no
`mcp` subcommand and its `mcp_config.json` remote-entry shape is not publicly
documented or groundable — so no remote shape is emitted rather than a
fabricated one. This is a documented, accepted parity gap, not a silent
omission; see [`cli-matrix.md`](cli-matrix.md) row 7h and the *Parity gaps*
entry. stdio org servers reach all four CLIs.

Delivery happens at setup time. After editing `mcp-servers.org.json`, **re-run
the setup script** for each CLI you use (`scripts/setup-<cli>-interactive.sh`);
setup is idempotent. Because the manifest is excluded from sync, your
declarations survive both a repeated setup run and an upstream synchronization.

## Re-adding a forge MCP server

Under the CLI-first forge baseline (spec 0090 / ADR-0015) no forge MCP ships in
any default — forge operations route through `gh` / `glab` / `tea`. An
organization that nonetheless wants a **GitHub, GitLab, or Gitea** MCP server
re-adds it through this channel, **not** by editing an upstream-owned default.

Declare it under `.mcpServers` like any other server. For example, a GitHub MCP
reached over stdio:

```jsonc
{
  "mcpServers": {
    "github": {
      "transport": "stdio",
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN",
               "ghcr.io/github/github-mcp-server"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}" }
    }
  }
}
```

or a remote forge MCP reached over http with a bearer token:

```jsonc
{
  "mcpServers": {
    "github": {
      "transport": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": { "Authorization": "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" }
    }
  }
}
```

Substitute the command/URL and headers your forge MCP actually requires.

## Credentials

Securing credentials is **explicitly out of scope** (spec 0091): the framework
delivers the declaration verbatim and the organization owns whatever secrets it
adds. To avoid committing a plaintext secret into a tracked file:

- Use a **`${VAR}` reference** (as in the examples above) and export the real
  value in the operator's environment; the CLI resolves it at runtime.
- Prefer each CLI's own credential store where available — e.g. `claude mcp
  login` for OAuth servers, or `-e KEY=$VAR` so the value is read from the
  environment rather than inlined.

The shipped `mcp-servers.org.json` carries no operational server and no
credential; its placeholder header is a `${VAR}` reference, never a literal
secret.
