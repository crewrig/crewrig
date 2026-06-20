---
id: "0054"
slug: antigravity-setup-script
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 424
version: 1.0.0
---

# Antigravity CLI setup script

## Intent

A crewrig adopter running the Antigravity CLI (`agy`) can deploy the full
layered configuration — rules files, MCP servers, and component tiers — to
their Antigravity environment by running a single interactive script, in the
same way they already do for Gemini CLI and Claude Code.

## Requirements

1. `scripts/setup-antigravity-interactive.sh` SHALL exist in the repository.
2. The script SHALL verify that the `agy` binary is present in `$PATH` at
   startup and SHALL exit with a non-zero status and a human-readable
   diagnostic message if `agy` is absent.
3. The script SHALL deploy crewrig rules files to `~/.gemini/antigravity-cli/`
   following the same priority-numbered naming scheme used by
   `scripts/setup-gemini-interactive.sh` for `~/.gemini/`.
4. The script SHALL deploy `AGENTS.org.md` to
   `~/.gemini/antigravity-cli/66_ORG_RULES.md`, matching the priority-66
   org-rules placement used by the Gemini setup script.
5. The script SHALL register MCP servers (MemPalace and SequentialThinking)
   by writing to `~/.gemini/config/mcp_config.json`, which is Antigravity's
   MCP configuration file (distinct from `settings.json`).
6. The script SHALL follow the tier-routed install pattern: the core tier
   SHALL be deployed automatically; library, community, and org tiers SHALL
   each require explicit opt-in from the user.
7. The script SHALL be idempotent — re-running it on an environment that
   already has a configuration SHALL NOT corrupt or silently overwrite
   existing files without giving the user the option to keep or refresh the
   existing state.

## Scenarios

**Scenario:** First-time setup on a clean environment

Given a machine with `agy` v1.0.10 present in `$PATH`,
  crewrig prerequisites (`config/SOUL.md`, `config/PROFILE.md`) present,
  and `~/.gemini/antigravity-cli/` absent
When the user runs `bash scripts/setup-antigravity-interactive.sh`
  and opts in to MemPalace and the library tier
Then the script exits zero,
  priority-numbered rules files are present under `~/.gemini/antigravity-cli/`,
  `~/.gemini/antigravity-cli/66_ORG_RULES.md` matches `AGENTS.org.md`,
  and `~/.gemini/config/mcp_config.json` contains the MemPalace server entry.

**Scenario:** Re-run on an existing configuration (idempotency)

Given a machine where `setup-antigravity-interactive.sh` has already run
  and `~/.gemini/antigravity-cli/` contains a prior set of rules files
When the user runs the script again
Then the script detects the existing files,
  presents a keep-or-refresh choice,
  and if the user chooses "keep" the script exits zero
  without modifying any existing rules file.

**Scenario:** `agy` binary absent

Given a machine where `agy` is not present in `$PATH`
When the user runs `bash scripts/setup-antigravity-interactive.sh`
Then the script exits with a non-zero status
  and prints a human-readable message naming the missing binary
  and a suggested installation remedy.

**Scenario:** MemPalace opt-out

Given `agy` is present and prerequisites are satisfied
When the user runs the script and declines the MemPalace opt-in prompt
Then `~/.gemini/config/mcp_config.json` SHALL NOT contain a mempalace entry,
  and the script exits zero with all other configuration deployed.

**Scenario:** Community tier opt-in

Given a built `dist/community/.gemini/` staging tree is present
When the user runs the script and opts in to the community tier
Then community-tier skills and agents are installed under
  `~/.gemini/antigravity-cli/skills/` and `~/.gemini/antigravity-cli/agents/`
  respectively.

## Out of scope

- Build pipeline target for Antigravity — covered by spec 0053.
- Antigravity workspace layout (`.agents/` directory) — covered by spec 0052.
- Antigravity history import — covered by spec 0055.
- Antigravity session-recording hooks — covered by spec 0056.
- Antigravity plugin build — covered by spec 0057.
- Updating `docs/cli-matrix.md` — the implementation PR carries this
  obligation per `AGENTS.md` CLI Matrix Maintenance; it is not re-specified
  here.
- Supporting Antigravity versions other than 1.x (`agy` v1.0.10 is the
  confirmed baseline; compatibility with future major versions is not
  guaranteed by this spec).

## Open questions

- The MCP registration format inside `~/.gemini/config/mcp_config.json`
  has been confirmed empirically but is not publicly documented. If the
  format diverges from `settings.json` in a non-trivial way (e.g., a
  different top-level key name for the server map), the implementation PR
  will need to adapt the `jq` patching logic accordingly. This is a DEV-time
  concern and does not block spec approval; the implementation team should
  inspect the file schema before writing.
