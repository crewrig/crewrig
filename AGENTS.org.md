# Organisation Agent Rules

<!--
  This file is the org-owned extension point for agent working rules
  (spec 0020). The adopting organisation authors its additional rules HERE,
  never by editing the upstream-owned AGENTS.md.

  How org rules reach each CLI:

  - Claude Code   — natively. AGENTS.md ends with an `@AGENTS.org.md` import
                    directive; Claude resolves `@file` includes recursively
                    (CLAUDE.md -> @AGENTS.md -> @AGENTS.org.md).
  - Gemini CLI    — via setup. `scripts/setup-gemini-interactive.sh` deploys
                    this file to `~/.gemini/66_ORG_RULES.md` (priority 66,
                    after 65 org-tools). Gemini resolves `@file` imports only
                    in GEMINI.md, which this repo has no root copy of.
  - Copilot CLI   — via setup. `scripts/setup-copilot-interactive.sh` deploys
                    this file to `~/.copilot/instructions/66-org-rules.instructions.md`.
                    Copilot does not resolve `@file` includes in instruction
                    files and auto-reads only the standard `AGENTS.md` name.

  The Gemini and Copilot copies are taken at setup time. If you edit this
  file, re-run the corresponding setup script to refresh the deployed copy.

  Replace the example rules below with your organisation's own.
-->

This document holds rules specific to the adopting organisation. It loads
alongside the upstream `AGENTS.md` on every supported CLI.

## Example

> Replace this section with your organisation's rules. For instance:
>
> - Internal issue tracker prefix and linking convention.
> - Organisation-specific review or approval requirements.
> - Naming or branching conventions that extend the upstream defaults.
