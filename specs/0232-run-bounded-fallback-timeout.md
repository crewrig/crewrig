---
id: "0232"
slug: run-bounded-fallback-timeout
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 1222
version: 1.0.0
---

# Keep run_bounded timeout effective when job control cannot be enabled

## Intent

When job control (`set -m`) cannot be enabled by the shell during `run_bounded`
in `scripts/probe-antigravity-discovery.sh`, the watchdog timer remains effective
by detecting that job control is inactive and terminating the process tree by PID
(the background process and its descendants), preventing hung child commands
from outliving the timeout.

## Requirements

1. `run_bounded` in `scripts/probe-antigravity-discovery.sh` SHALL detect whether
   job control is actually active when spawning the bounded command.
2. When job control is active, `run_bounded` SHALL terminate the process group via
   negative PID (`kill -TERM -- "-$pid"`).
3. When job control is inactive or cannot be enabled, `run_bounded` SHALL fall back
   to terminating the command process tree by process ID, ensuring the spawned
   command and any child processes are killed upon timeout.
4. The watchdog termination logic SHALL NOT report an error or abort under `set -e`
   when the target process or process group has already exited.
5. The test suite `scripts/tests/test-antigravity-discovery-probe.sh` SHALL include
   a test asserting that a hanging command is terminated on timeout even when job
   control is forced inactive.

## Scenarios

**Scenario:** Bounded command hangs without job control

Given a shell environment where job control cannot be enabled or is disabled
When `run_bounded` executes a command that exceeds `AGY_PROBE_TIMEOUT`
Then `run_bounded` returns 124, the command process and its child processes are terminated, and no hung processes survive.

**Scenario:** Normal execution with job control

Given a shell environment where job control is available
When `run_bounded` executes a command that completes within `AGY_PROBE_TIMEOUT`
Then `run_bounded` returns the exit code of the command and leaves no lingering watchdog processes.

## Out of scope

- Replacing Bash job control in scripts other than `scripts/probe-antigravity-discovery.sh`.
- Modifying discovery probe sentinel classification logic.

## Open questions

None.
