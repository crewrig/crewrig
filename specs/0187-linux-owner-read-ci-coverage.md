---
id: "0187"
slug: linux-owner-read-ci-coverage
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 985
version: 1.0.0
---

# Linux CI coverage for MemPalace repair owner-read floor

## Intent

Provide robust CI test coverage on Linux for the `file_mode` owner-read floor in `scripts/repair-mempalace-http.sh`, ensuring that fixtures for owner-unreadable backups can be constructed without relying on macOS-specific extended ACLs when a secondary UID is accessible, while maintaining graceful degradation on environments lacking privilege.

## Requirements

1. The test suite `scripts/tests/test-repair-mempalace-http.sh` SHALL construct readable backup fixtures with owner-unreadable permission modes on Linux using foreign-ownership fixtures when elevated non-interactive privilege (`sudo -n`) is available.
2. In environments where neither extended ACLs nor non-interactive privilege can construct the readable owner-unreadable fixture, the test suite SHALL continue to report explicit, non-silent skipped notices naming the unexercised check.
3. The temporary directory creation for the GNU stat shim in `scripts/tests/test-repair-mempalace-http.sh` SHALL verify allocation success before modifying `PATH` to avoid injecting an empty directory element into the search path.
4. The test suite SHALL remain fully hermetic, ensuring all temporary files and foreign-owned fixtures are cleaned up upon test completion.

## Scenarios

### Scenario 1: Linux environment with non-interactive privilege (`sudo -n`)

- **Given** a Linux test environment where non-interactive privilege (`sudo -n`) is available
- **When** `scripts/tests/test-repair-mempalace-http.sh` runs
- **Then** foreign-owned fixtures with owner-unreadable modes are constructed, all owner-read floor assertions are exercised, and zero tests are skipped

### Scenario 2: macOS environment with extended ACLs

- **Given** a macOS test environment supporting extended file ACLs
- **When** `scripts/tests/test-repair-mempalace-http.sh` runs
- **Then** extended ACL fixtures are used, all owner-read floor assertions are exercised, and zero tests are skipped

### Scenario 3: Unprivileged Linux environment without ACLs

- **Given** an unprivileged Linux environment where neither ACLs nor `sudo -n` can grant read access to owner-unreadable files
- **When** `scripts/tests/test-repair-mempalace-http.sh` runs
- **Then** the affected owner-read floor assertions are skipped gracefully with explicit skip diagnostics, and the test suite passes with a non-zero skip count

### Scenario 4: GNU stat shim temporary directory verification

- **Given** a system where the default `stat` does not report special mode bits and `gstat` is available
- **When** `scripts/tests/test-repair-mempalace-http.sh` sets up the GNU stat shim
- **Then** the temporary directory allocation is verified before `PATH` modification, ensuring `PATH` is not corrupted with an empty element

## Out of scope

- Modifying the production logic of `file_mode` in `scripts/repair-mempalace-http.sh`.
- Requiring interactive `sudo` prompts during local or CI test execution.

## Open questions

- None.
