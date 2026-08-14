---
id: "0159"
slug: symlinked-palace-token-path-canonicalization
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 746
version: 1.0.0
---

# Symlinked Palace Token Path Canonicalization Protocol

## Intent

Ensure the token path derivation in `scripts/lib/common.sh` and `scripts/lib/mcp-daemon-launcher.sh` resolves the complete physical canonical path (including symlinked leaves), matching upstream MemPalace's `_server_token_path` (`os.path.realpath`) identically.

## Requirements

1. **Full path canonicalization.** `mcp_token_path()` in `scripts/lib/common.sh` and the token derivation block in `scripts/lib/mcp-daemon-launcher.sh` SHALL canonicalize the full palace path using physical directory resolution (`cd -P "$palace_path" && pwd -P`) when the path exists.
2. **Upstream equivalence.** The derived 24-character SHA-256 key for a symlinked palace directory SHALL equal the key derived for the canonical target directory, ensuring framework tools and upstream `mempalace serve` converge on the same token file.
3. **Non-existent path fallback.** If the palace directory does not yet exist, the parent directory SHALL be created/resolved physically and the leaf basename appended.
4. **Regression test coverage.** `scripts/tests/test-mcp-daemon.sh` SHALL include a test case verifying that a symlinked palace directory produces the exact same token path as its realpath destination.

## Scenarios

### Scenario 1: Symlinked palace directory resolves to canonical target key

- **GIVEN** a palace directory `/tmp/real_palace` and a symlink `/tmp/sym_palace -> /tmp/real_palace`
- **WHEN** `mcp_token_path()` is called with `MEMPALACE_PALACE_PATH=/tmp/sym_palace`
- **THEN** the returned token path matches `mcp_token_path()` called with `MEMPALACE_PALACE_PATH=/tmp/real_palace`.

### Scenario 2: Standard non-symlinked palace directory

- **GIVEN** a standard palace directory `~/.mempalace/palace`
- **WHEN** `mcp_token_path()` is called
- **THEN** the canonical path is hashed to compute `~/.mempalace/server/<key>/token`.

## Out of scope

- Altering the 24-character SHA-256 key length or server directory structure.

## Open questions

- None.
