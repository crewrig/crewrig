---
id: "0167"
slug: transcript-hook-ci-test-token
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 973
version: 1.0.0
---

# Injectable daemon token path and deterministic test execution for transcript hooks

## Intent

Session transcript hook test executions run deterministically across continuous
integration runners and local developer workstations without requiring an active
background daemon process or manual host token provisioning. When testing hook
lifecycle behaviors or mock endpoints, test suites can provide an explicit token
location without interfering with production daemon token discovery paths.

## Requirements

1. `hooks/mempalace-transcript.sh` SHALL accept an explicit token file path
   override supplied through the environment, taking precedence over default
   filesystem discovery locations.
2. In the absence of an explicit token file path override,
   `hooks/mempalace-transcript.sh` SHALL maintain standard filesystem token
   discovery against active daemon installations.
3. When neither an explicit token override nor a discovered token file exists on
   disk, `hooks/mempalace-transcript.sh` SHALL emit a `DAEMON_UNREACHABLE`
   diagnostic to stderr and SHALL return a clean zero exit status.
4. `scripts/tests/test-mempalace-transcript-hook.sh` SHALL execute all test cases
   to completion and pass unconditionally in headless CI environments.
5. Hook invocation interfaces and registration configurations across supported
   CLI assistants SHALL remain strictly backward-compatible.

## Scenarios

**Scenario:** Test suite provides explicit token path override (happy path)

```text
Given a test execution environment with no active background daemon
And a mock daemon response endpoint and mock token file prepared on disk
When `hooks/mempalace-transcript.sh` is invoked with an explicit token path override
Then the hook reads the bearer token from the specified path
And transmits the authenticated transcript payload to the endpoint
And exits with status 0.
```

**Scenario:** Missing daemon token produces non-blocking diagnostic (failure path)

```text
Given a system with no running daemon and no valid token file present
When `hooks/mempalace-transcript.sh` is invoked without a token override
Then the hook reports `DAEMON_UNREACHABLE` on standard error
And exits cleanly with status 0.
```

**Scenario:** Standard production token discovery (default path)

```text
Given a workstation running an active MemPalace MCP HTTP daemon
And a valid token file provisioned under the standard user configuration directory
When a lifecycle event triggers `hooks/mempalace-transcript.sh` without overrides
Then the hook discovers and reads the provisioned token file
And delivers the transcript drawer entry to the daemon endpoint.
```

## Out of scope

- Changing the HTTP request payload format or RPC method names.
- Modifying the token generation or daemon startup mechanics.
- Altering the transcript hook event registration manifests.

## Open questions

- (none — all questions resolved during SPECS)
