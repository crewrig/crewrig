---
id: "0160"
slug: refresh-mempalace-runbook-rotation
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 914
version: 1.0.0
---

# Refresh the MemPalace runbook's rotation section

## Intent

An operator consulting the MemPalace MCP runbook finds an accurate description
of the bearer token rotation procedure matching shipped behaviour on `main`:
`switch-mempalace-http.sh` replaces the daemon process directly and revokes the
superseded token at step 2, eliminating obsolete references to the former
defect from issue #880 and manual `task mempalace:stop` workarounds, disclosing
the replacement-window residual risk per spec 0139 delta-01, and synchronizing
the procedure diagram and prompt sidecar with the four-step workflow.

## Requirements

1. `docs/runbooks/mempalace-mcp-server.md` SHALL document the four-step manual
   bearer token rotation procedure matching the shipped implementation in
   `scripts/uninstall-mcp-daemon.sh` and `scripts/switch-mempalace-http.sh`:
   (1) delete the old token file, (2) run `task mempalace:switch-http` (or
   `bash scripts/switch-mempalace-http.sh`) to mint a fresh token, replace the
   daemon process, and re-register CLIs, (3) delete timestamped `.bak` assistant
   config files holding the superseded token, and (4) restart running CLI
   sessions.
2. The runbook SHALL state that the superseded bearer token stops being honored
   at step 2 when `switch-mempalace-http.sh` replaces the daemon process, and
   SHALL NOT claim that the script fails to restart the daemon or instruct the
   operator to perform a separate manual `task mempalace:stop` step.
3. The runbook rotation section SHALL disclose the replacement-window residual
   risk in accordance with spec 0139 delta-01 (R5), noting that during the brief
   process replacement window, another local process could theoretically bind the
   released port before the supervisor relaunches the daemon.
4. `docs/assets/mempalace-mcp/rotate-token.prompt.md` and the generated figure
   `docs/assets/mempalace-mcp/rotate-token.png` SHALL depict the four-step
   rotation sequence in exact synchronization with the runbook and script,
   removing the redundant third daemon-restart box and updating the sidecar
   prompt and explanation.

## Scenarios

**Scenario:** operator follows the rotation procedure in the runbook

Given an operator consulting `docs/runbooks/mempalace-mcp-server.md` to rotate a
bearer token
When  the operator reads the rotation section
Then  the procedure presents four ordered steps without referencing a manual
daemon stop step, identifies step 2 as the point where the old token is
revoked, and discloses the replacement-window residual risk

**Scenario:** procedure diagram depicts the four-step workflow

Given a reader viewing `docs/assets/mempalace-mcp/rotate-token.png` and its
sidecar `rotate-token.prompt.md`
When  inspecting the steps depicted
Then  exactly four ordered boxes are shown: delete old token file, run
switch-mempalace-http.sh, delete .bak files, restart running sessions

## Out of scope

- Changes to shell scripts or daemon lifecycle code
  (`scripts/switch-mempalace-http.sh`, `scripts/lib/common.sh`, etc.), which
  were implemented in PR #897 and hardened in PR #948 / PR #954.
- Automated token-rotation tooling or a `--rotate` flag (tracked under issue #744).
- Eliminating the replacement window itself via supervisor socket activation
  (tracked under issue #913).

## Open questions
