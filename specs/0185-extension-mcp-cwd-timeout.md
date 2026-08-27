---
id: "0185"
slug: extension-mcp-cwd-timeout
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1035
version: 1.0.0
---

# MCP working directory and timeout declaration

## Intent

An extension author declaring an MCP server can configure working directories and timeout thresholds for their server processes, and an organization declaring MCP servers at the repository or workspace level benefits from the same capabilities across all supported command-line tools without unannounced property drops or channel divergence. Today, declaring `cwd` or `timeout` causes a build validation error in extension manifests, while the organization channel silently ignores both properties. After this change, both channels share an enriched neutral vocabulary admitting `cwd` and `timeout`, path tokens in working directory declarations resolve identically to command paths, and each tool's native MCP configuration receives the appropriate properties.

## Requirements

1. **(Admit working directory and timeout in neutral vocabulary)** The neutral `mcpServers` vocabulary shared between extension manifests (spec 0180) and organization declarations (spec 0091) SHALL admit an optional `cwd` property for stdio transport servers, and an optional `timeout` property for all supported transport types (`stdio`, `http`, `sse`).
2. **(One translation across both channels)** The neutral-to-native translation SHALL process `cwd` and `timeout` identically across both the extension-scoped channel and the organization-scoped declaration channel, ensuring identical meaning and native representation regardless of declaration source.
3. **(Path token resolution in working directory)** The neutral path token `${extensionRoot}` SHALL be admissible in `cwd` declarations of extension-scoped stdio servers, and SHALL resolve at the same lifecycle moment and by the same resolver as path tokens inside `command` and `args` (per spec 0180 requirements 6, 7, and 8).
4. **(Positional token allowlist in working directory)** Manifest validation for extension-scoped declarations SHALL treat `cwd` as a path-bearing field subject to the same positional token allowlist as `command` and `args`, accepting `${extensionRoot}` as the sole valid `${...}` token and rejecting any other `${...}` expression.
5. **(Strict validation of inadmissible keys)** Manifest validation for extension-scoped declarations SHALL accept only the expanded set of admissible keys (`transport`, `command`, `args`, `env`, `cwd`, `timeout` for stdio; `transport`, `url`, `headers`, `timeout` for http/sse) and SHALL fail with a descriptive validation error when any inadmissible key is declared.
6. **(Native mapping per target tool)** The native translation SHALL produce the appropriate target-specific shape for each supported command-line tool:
   - For Gemini CLI: stdio declarations receive `cwd` and `timeout`; remote declarations receive `timeout`.
   - For Antigravity CLI: stdio declarations receive `cwd` and `timeout`; remote declarations receive `timeout`.
   - For GitHub Copilot CLI: stdio declarations receive `cwd` and `timeout`; remote declarations receive `timeout`.
   - For Claude Code: plugin declarations receive `cwd` in `.mcp.json` when declared for stdio servers, and `timeout` where supported natively.
7. **(Co-maintenance of documentation and tests)** The change SHALL update in the same diff the extension format documentation, the extension skeleton scaffolding, the CLI matrix entries for MCP delivery, and SHALL provide regression test coverage asserting correct translation, token substitution, and validation failure on inadmissible keys.

## Scenarios

**Scenario:** Extension declares stdio server with working directory and timeout

```text
Given an extension manifest declares a stdio MCP server with "cwd" and "timeout"
When  manifest validation and the target render run for all supported tools
Then  manifest validation succeeds without error
And   the rendered output for each tool carries the declared "cwd" and "timeout" fields
```

**Scenario:** Working directory contains the neutral path token

```text
Given an extension manifest declares a stdio server with "cwd" set to "${extensionRoot}/subpath"
When  the target render runs
Then  the neutral token is rewritten to the tool-specific resolved path token or deferred for post-install resolution
And   no render-time absolute path is embedded in rendered output
```

**Scenario:** Org-level MCP declaration carries cwd and timeout

```text
Given an organization manifest mcp-servers.org.json declares a stdio server with "cwd" and "timeout"
When  the organization MCP translator produces native configurations
Then  the native configurations for all supported tools carry the declared "cwd" and "timeout"
```

**Scenario:** Inadmissible token in working directory is rejected

```text
Given an extension manifest declares a stdio server with "cwd" containing an unadmissible token "${unknownRoot}"
When  manifest validation runs
Then  validation fails with a descriptive validation error naming the inadmissible token
```

**Scenario:** Non-vocabulary key in stdio server is rejected

```text
Given an extension manifest declares a stdio server with an inadmissible key "description"
When  manifest validation runs
Then  validation fails with a descriptive validation error naming the inadmissible key
```

## Out of scope

- Peripheral or cosmetic keys (`description`, `includeTools`, `excludeTools`, `trust`) which remain outside the neutral vocabulary.
- Authentication or OAuth metadata blocks beyond standard neutral headers.
- Dynamic runtime timeout renegotiation or health monitoring protocols.

## Open questions

- (None; closed in-spec)
