---
id: "0178"
slug: supervisor-mempalace-palace-path-propagation
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 747
version: 1.0.0
---

# Supervisor MEMPALACE_PALACE_PATH Propagation Protocol

## Intent

Ensure non-default MemPalace palace locations configured via `MEMPALACE_PALACE_PATH` during setup and daemon installation are faithfully propagated into the shared MCP HTTP daemon launcher (`~/.crewrig/mcp-daemon-launcher.sh`), the launchd plist, and the systemd unit for both MemPalace and ChromaDB daemons, preventing token derivation mismatches and silent fallback to default palace paths.

## Requirements

1. **Launcher template placeholder.** `scripts/lib/mcp-daemon-launcher.sh` SHALL declare a substitution placeholder `CONFIGURED_PALACE_PATH="__MEMPALACE_PALACE_PATH__"`. When populated with a non-empty string at install time, the launcher SHALL export `MEMPALACE_PALACE_PATH="${CONFIGURED_PALACE_PATH}"` before token derivation and before executing `mempalace-http-wrapper.py`.
2. **Launcher materialization substitution.** `install_mcp_launcher` in `scripts/lib/common.sh` SHALL substitute `__MEMPALACE_PALACE_PATH__` with the value of `${MEMPALACE_PALACE_PATH:-}` when generating `~/.crewrig/mcp-daemon-launcher.sh`.
3. **ChromaDB supervisor unit placeholders.** `config/launchd/com.mempalace.chroma-server.plist` and `config/systemd/mempalace-chroma-server.service` SHALL replace hardcoded default palace paths with `__CHROMA_PALACE_PATH__`.
4. **ChromaDB unit materialization.** `_materialise_chroma_unit` in `scripts/lib/common.sh` SHALL substitute `__CHROMA_PALACE_PATH__` with `${MEMPALACE_PALACE_PATH}` when set; otherwise defaulting to `${mempalace_home}/palace` on macOS (launchd) and `%h/.mempalace/palace` on Linux (systemd).
5. **Standalone ChromaDB script propagation.** `scripts/start-chroma-server.sh` SHALL default `PALACE_DIR` to `"${MEMPALACE_PALACE_PATH:-${MEMPALACE_DIR}/palace}"`.
6. **No unsubstituted placeholders.** Both `_materialise_chroma_unit` and `_materialise_mcp_unit` SHALL assert that no residual `__[A-Z0-9_]+__` placeholders remain after substitution.
7. **Regression test coverage.** A regression test suite SHALL verify that when `MEMPALACE_PALACE_PATH` is exported during launcher and unit materialization, the generated launcher, launchd plists, and systemd units contain the configured palace path and converge on the identical token file.

## Scenarios

### Scenario 1: Non-default palace path propagated into launcher and units

- **GIVEN** `MEMPALACE_PALACE_PATH=/custom/data/my-palace` is exported in the shell
- **WHEN** `install_mcp_launcher` and `install_daemon_supervisor` run
- **THEN** `~/.crewrig/mcp-daemon-launcher.sh` contains `CONFIGURED_PALACE_PATH="/custom/data/my-palace"` and exports it
- **AND** the materialized ChromaDB supervisor unit (plist or systemd service) passes `--path /custom/data/my-palace`
- **AND** the token path derived in the launcher matches `mcp_token_path()` executed in the caller's shell.

### Scenario 2: Default palace path when variable is unset

- **GIVEN** `MEMPALACE_PALACE_PATH` is unset or empty
- **WHEN** `install_mcp_launcher` and `install_daemon_supervisor` run
- **THEN** `mcp-daemon-launcher.sh` defaults to `${HOME}/.mempalace/palace`
- **AND** the ChromaDB supervisor unit targets the standard default palace path (`~/.mempalace/palace` or `%h/.mempalace/palace`).

## Out of scope

- Multi-palace concurrent daemon multiplexing in a single supervisor unit.
- Changing upstream MemPalace token hashing or storage directory schema.

## Open questions

- None.
