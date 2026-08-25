---
id: "0182"
slug: test-mcp-daemon-fake-server-readiness
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 983
version: 1.0.0
---

# 0182 — Deterministic fake server readiness wait in test-mcp-daemon.sh

## Intent

The MemPalace MCP daemon test suite deterministically verifies fake daemon HTTP endpoints by actively waiting for server readiness rather than relying on arbitrary fixed sleep durations, preventing intermittent CI test flakes caused by slow process startup on loaded runners.

## Requirements

1. Every test fixture in `scripts/tests/test-mcp-daemon.sh` that launches a background fake HTTP server (`fake-mcp.py`) SHALL actively poll for endpoint readiness before executing dependent probe commands.
2. The readiness wait SHALL be bounded by a timeout (at least 5 seconds) and SHALL poll the `/healthz` endpoint with short intervals (no greater than 200ms) to allow fast-starting servers to proceed immediately.
3. If the background fake server fails to become ready within the timeout, the test fixture SHALL fail immediately and output a clear diagnostic identifying the precondition failure rather than reporting a false or misleading assertion failure.
4. Test assertions that probe a running fake server (including the authentication non-enforcement probe in section 13b) SHALL explicitly verify that the server is alive and reachable, ensuring that a dead server or network connection failure cannot produce a vacuous pass.
5. All background fake server processes spawned during test execution SHALL be reliably terminated when their respective test section completes or upon test teardown.

## Scenarios

### Scenario: Fast fake server startup proceeds without fixed delay

Given `fake-mcp.py` is started in the background on a test port
When the test fixture executes the readiness wait
Then the readiness check succeeds as soon as `/healthz` responds with HTTP 200, allowing the test suite to proceed immediately without waiting for a flat sleep interval

### Scenario: Slow or hung fake server startup fails with a clear precondition error

Given an environment where `fake-mcp.py` fails to start or cannot bind the assigned port
When the test fixture executes the readiness wait
Then the readiness wait times out after the bounded duration and fails the test with an explicit message identifying that the fake server did not become ready

### Scenario: Section 13b reports auth not enforced on a live fake server

Given `fake-mcp.py` is running and serving HTTP 200 on `/healthz` and HTTP 200 on `/mcp`
When `scripts/status-mcp-server.sh` is executed against the running fake server
Then the probe verifies the server is healthy on `/healthz`, reports `*** NOT ENFORCED ***` for unauthenticated `/mcp`, exits non-zero, and the test records a non-vacuous failure verification

## Out of scope

- Modifying the production logic of `scripts/status-mcp-server.sh`, `scripts/switch-mempalace-http.sh`, or other framework runtime scripts.
- Refactoring the supervisor-managed real daemon test fixtures in `scripts/tests/test-mcp-daemon.sh` that already use dedicated healthz readiness loops.

## Open questions

(none)
