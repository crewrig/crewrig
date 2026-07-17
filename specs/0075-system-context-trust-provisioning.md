---
id: "0075"
slug: system-context-trust-provisioning
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 509
version: 1.0.0
---

# Setup-time trust provisioning for the system-context store

## Intent

The store at `~/.crewrig/system-context/` is already installed by every
supported CLI's setup and already read directly on the CLIs that need no grant.
On the two CLIs that require a per-invocation grant to read it and offer no
effective lasting trust surface, a user who runs setup sees a visible,
actionable message explaining how to grant the read when a rule from the store
is needed. Setup writes no durable trust configuration on any CLI, changes no
store content, and stays idempotent; and wherever the store still cannot be
read, the outcome is the explicit, visible fallback signal rather than a
silently missing rule.

## Requirements

1. For a CLI that requires a per-invocation grant to read the store and exposes
   no effective durable trust surface (the GitHub Copilot CLI and the Gemini
   CLI), its setup SHALL emit a visible, actionable message that tells the user
   how to grant the store read when it is needed.
2. No CLI's setup SHALL write a durable trust or allow entry for the store that
   the sandbox-probe evidence shows to be ineffective or that could not be
   verified; this spec SHALL introduce no durable trust-config write, consistent
   with the alternative that ADR-0013 rejected.
3. For a CLI that reads the store directly with no grant (Claude Code and
   Antigravity), its setup SHALL NOT emit store-access guidance and SHALL NOT
   require any grant.
4. Re-running any CLI's setup SHALL remain idempotent and SHALL NOT alter the
   store's on-disk content, layout, or the forkable-first retrieval ordering
   established by spec 0068.
5. Wherever the store cannot be read on a given CLI, the outcome for a needed
   rule SHALL remain the explicit, visible fallback signal mandated by spec 0068
   requirement 4; a rule SHALL never be silently omitted.
6. The parity gap for the two grant-requiring CLIs SHALL remain documented with
   its concrete sandbox-probe evidence (the CLI-matrix record), so the gap is
   never silent.

## Scenarios

**Scenario:** a gap CLI's setup prints actionable store-access guidance,
idempotently

Given a fresh adopter runs the Gemini CLI or the GitHub Copilot CLI setup
When  the setup completes
Then  it prints a visible, actionable message naming the per-invocation grant
      that authorizes the store read (e.g. Copilot `--add-dir <store>`, Gemini
      `--include-directories`)
And   running the same setup a second time prints the same guidance and writes
      no durable trust configuration

**Scenario:** a PASS-default CLI's setup prints no guidance, yet the store is
read

Given a fresh adopter runs the Claude Code or Antigravity CLI setup
When  the setup completes
Then  no store-access guidance is printed
And   an agent still reads a needed rule directly from
      `~/.crewrig/system-context/` with no warning

**Scenario:** a gap CLI runs headless without the grant — explicit signal, never
silent

Given a grant-requiring CLI runs headless with the store path not granted for
      the invocation
When  an agent needs a rule that lives only in the store
Then  an explicit, visible fallback signal names the unreachable content
And   no rule is silently omitted

## Out of scope

- Building the deferred dedicated retrieval service (spec 0068's "third mode"),
  which remains deferred until a CLI is proven unable to read the store.
- Changing the store's on-disk layout or content, and deciding which rules live
  in the store — both owned by spec 0068.
- Any change to MemPalace or its optional-enhancement retrieval path.
- Obtaining working Gemini or Copilot authentication, or re-probing their read
  capability; the sandbox-probe evidence is taken as given.
- The `AGENTS.org.md` / organization-rules surface.
- Writing any durable per-CLI trust configuration for the store: the ticket's
  original "provision a durable trust entry" framing is refuted by the
  sandbox-probe evidence and deliberately not pursued. This spec complements
  ADR-0013 rather than changing it.

## Open questions
