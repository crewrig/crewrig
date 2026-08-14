---
id: "0148"
slug: signing-precondition-smoke-check
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 811
version: 1.0.0
---

# Signing Precondition Smoke Check in Test Suite

## Intent

Ensure the SSH signing precondition in `scripts/tests/test-sync-from-upstream.sh` verifies actual SSH signing support (`ssh-keygen -Y sign`) rather than key generation alone, preventing false passes when key generation succeeds but signing is unsupported.

## Requirements

1. **SSH signing smoke check.** The shared SSH signing precondition helper in `scripts/tests/test-sync-from-upstream.sh` (used by cases `cc`, `hh`, and `jj`) SHALL perform an `ssh-keygen -Y sign` smoke check on a generated key using a throwaway buffer file before certifying signing support.
2. **Clear capability diagnostic.** If either key generation (`ssh-keygen -t ed25519`) or buffer signing (`ssh-keygen -Y sign`) fails, the precondition helper SHALL fail loudly with a diagnostic message naming SSH signing capability (`ssh-keygen -Y sign` / OpenSSH >= 8.2).
3. **Reachable disjunct path retirement.** Retiring the generation-versus-signing gap SHALL eliminate the reachable path where case `jj` misdiagnosed a missing signature as a header-naming mismatch.

## Scenarios

### Scenario 1: Precondition verifies key generation and signing

- **GIVEN** a test environment running `scripts/tests/test-sync-from-upstream.sh`
- **WHEN** cases `cc`, `hh`, or `jj` execute their entry guards
- **THEN** the shared precondition helper generates an ed25519 key, signs a throwaway buffer with `ssh-keygen -Y sign`, verifies the resulting signature file, and cleans up the buffer artifacts before proceeding.

### Scenario 2: Failure on environment lacking signing support

- **GIVEN** an environment that can generate ed25519 keys but fails `ssh-keygen -Y sign`
- **WHEN** case `cc`, `hh`, or `jj` executes
- **THEN** the precondition helper fails loudly naming `ssh-keygen -Y sign` failure rather than attempting signed commit operations downstream.

## Out of scope

- Modifying the test assertions of cases `cc`, `hh`, and `jj` beyond their entry guards.
- Hardcoding OpenSSH version checks instead of functional capability probes.

## Open questions

- None.
