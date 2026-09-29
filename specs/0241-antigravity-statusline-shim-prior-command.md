---
id: "0241"
slug: antigravity-statusline-shim-prior-command
status: implemented
complexity: small
interaction-mode: AUTO
related-issue: 1363
version: 1.0.0
---

# Antigravity statusline shim suppression of raw payload when prior command is empty

## Intent

When Antigravity CLI executes the statusline capture hook, the hook emits
no output to the terminal status bar when no previous statusline command was
configured, avoiding raw JSON context pollution, and executes the operator's
previous statusline command when one was configured, preserving their custom
status line display.

## Requirements

1. When no prior statusline command was configured in the usage state (or the
   configured value is empty or the marker file is absent),
   `hooks/antigravity-statusline-shim.sh` SHALL NOT emit the raw JSON context
   payload or any other output to standard output.
2. When a prior statusline command is recorded in
   `<usage root>/state/antigravity-statusline.json`,
   `hooks/antigravity-statusline-shim.sh` SHALL execute that prior command,
   pass the received standard input payload to it, and stream its output to
   standard output.
3. If the executed prior statusline command exits with a non-zero status code or
   fails, `hooks/antigravity-statusline-shim.sh` SHALL continue execution and
   exit with status code 0.
4. In all cases (whether a prior command exists, is empty, succeeds, or fails),
   `hooks/antigravity-statusline-shim.sh` SHALL execute the usage-capture CLI
   telemetry step (`cli.js`) unchanged.
5. Telemetry capture execution SHALL NOT alter or suppress the output of the
   prior statusline command when one is configured.
6. The regression test suite SHALL verify that:
   - when `priorStatusLineCommand` is missing, empty, or absent from state,
     standard output is empty;
   - when `priorStatusLineCommand` is configured, standard output contains the
     output of that command;
   - telemetry capture executes successfully in both configurations.

## Scenarios

**Scenario:** No prior statusline command configured

Given Antigravity CLI usage capture is installed without a prior statusline command
When a statusline event payload is piped to `hooks/antigravity-statusline-shim.sh`
Then nothing is emitted to stdout, and usage telemetry capture completes with exit code 0.

**Scenario:** Custom prior statusline command configured

Given Antigravity CLI usage capture is installed with a prior statusline command configured in state
When a statusline event payload is piped to `hooks/antigravity-statusline-shim.sh`
Then the prior command output is emitted to stdout, and usage telemetry capture completes with exit code 0.

**Scenario:** Prior statusline command fails

Given Antigravity CLI usage capture is installed with a prior statusline command that exits with a non-zero code
When a statusline event payload is piped to `hooks/antigravity-statusline-shim.sh`
Then `hooks/antigravity-statusline-shim.sh` still exits with code 0 and usage telemetry capture completes.

## Out of scope

- Changing the Antigravity statusline event capture payload schema or adapter logic in `scripts/lib/usage-capture/adapters/antigravity.js`.
- Modifying interactive setup questions or opt-in state management in `scripts/setup-antigravity-interactive.sh`.
- Adding new hook events to Antigravity CLI.

## Open questions

None.
