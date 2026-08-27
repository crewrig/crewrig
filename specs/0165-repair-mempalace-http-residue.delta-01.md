---
id: "0165"
slug: repair-mempalace-http-residue
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 984
version: 2.0.0
---

# Recover a machine whose MemPalace switch was interrupted — delta 01

Closes issue #984 by formalizing the security overrides governing restored file
modes under Requirement R5. The original specification mandated mode preservation
with a single bearer-token exception. This delta explicitly specifies the
owner-read floor: a restored mode must not deny the owner read access, falling back
to `0600` when owner read is missing, ensuring that the restored configuration is
readable by the operator and satisfies R7 convergence.

## ADDED

**Scenario:** A restored backup denies owner read access

Given an affected assistant has a timestamped usable backup whose mode denies owner read permission (such as mode 0060, 0100, or 4060)
When the repair command runs with `--restore-backup`
Then the assistant's configuration SHALL be restored to that backup's content
And the restored file's mode SHALL fall back to `0600`
And the restored configuration SHALL be readable by its owner

## MODIFIED

Requirement 5 is replaced to formally state the owner-read floor alongside the
bearer-token override.

Original R5:

```text
5. **R5.** With `--restore-backup`, the repair command SHALL restore, for each
   affected assistant that has a timestamped backup whose content parses as
   JSON, the most recent such backup. The restore SHALL preserve the file's
   mode; a configuration that carries a bearer token SHALL remain `0600`. An
   affected assistant without a usable backup SHALL be reported, not silently
   skipped.
```

Replacement R5:

```text
5. **R5.** With `--restore-backup`, the repair command SHALL restore, for each
   affected assistant that has a timestamped backup whose content parses as
   JSON, the most recent such backup. The restore SHALL preserve the backup
   file's mode, subject to two security overrides:
   - a restored configuration that carries a bearer token SHALL be forced to `0600`;
   - a restored mode that denies the owner read permission (the owner triad digit is not in the range 4–7) SHALL fall back to `0600` so the restored configuration remains readable by its owner and satisfies R7 convergence.
   An affected assistant without a usable backup SHALL be reported, not silently
   skipped.
```

## REMOVED

(none)
