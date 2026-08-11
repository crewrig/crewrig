---
id: "0133"
slug: close-mcp-daemon-coverage-gaps
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 754
version: 1.0.0
---

# Close the MCP daemon coverage gaps

## Intent

Every gap the specialist review of the shared MemPalace MCP HTTP daemon named
but did not fix is closed. The switch transaction, the status probe, the drift
check, the unit materialisation guard and the restore null-arm all come under
assertions that can actually fail, and the two unfixed review findings — the
launcher's token-path derivation and the no-baked-token check — stop being able
to diverge or to pass vacuously. An operator can trust the suite to report a
real regression, because each new assertion is proven against the defect it
claims to guard.

## Requirements

1. Every new assertion this spec introduces SHALL be verified against the
   defect it claims to guard: the regression SHALL be injected, the assertion
   SHALL fail against it, and the injected regression SHALL then be removed
   before the implementation is complete.
2. The test suite SHALL exercise `switch_assistants_to_http` end-to-end
   against hermetic configurations for gemini, copilot, antigravity and claude,
   with a failure forced on the second assistant switched. The run SHALL assert
   that the first assistant's entry is restored to its prior arrangement, that
   the failure is reported, and that a repeated run converges the machine and
   reports the found partial state.
3. The test suite SHALL execute `status-mcp-server.sh` against a hermetic
   environment and SHALL assert both its exit code and the diagnostic text it
   prints for each branch it exercises.
4. The test suite SHALL assert the not-serving branch: with the daemon not
   serving, the status probe SHALL exit non-zero and SHALL print the daemon log
   tail, or a statement that no log exists.
5. The test suite SHALL assert the authentication-not-enforced branch: with an
   unauthenticated probe returning anything other than 401, the status probe
   SHALL exit non-zero and SHALL report that authentication is not enforced.
6. The test suite SHALL assert the launcher-drift branch in the direction that
   an operator's update triggers: an installed launcher whose recorded source
   hash differs from the current source SHALL be reported as DRIFTED and the
   status probe SHALL exit non-zero.
7. `_materialise_mcp_unit` SHALL fail rather than emit a unit in which any
   template placeholder remains unsubstituted, and the test suite SHALL
   exercise that failure with an unsubstituted placeholder.
8. The test suite SHALL exercise the null-capture arm of
   `restore_mempalace_registration` for an assistant that had no mempalace
   entry before a run, and SHALL assert that no orphan HTTP entry remains after
   the restore.
9. The installed launcher SHALL resolve the bearer-token file to the same path
   `mcp_token_path` resolves for the same palace, including when the palace's
   parent directory does not exist, and SHALL NOT fall back to a path that
   yields a different key. The test suite SHALL assert the two derivations
   agree under that condition.
10. The check that no token value is baked into the launcher SHALL be capable
    of failing under the verification requirement 1 requires. When that
    verification shows the check cannot be made to fail meaningfully, the
    finding SHALL be recorded as moot with the evidence stated in the
    implementation's logbook comment.

## Scenarios

**Scenario:** A drifted launcher is caught

Given the installed launcher records a source hash that differs from the
  current repository source
When status-mcp-server.sh runs
Then it SHALL report the launcher as DRIFTED
And SHALL exit non-zero

**Scenario:** A repeated switch converges a partial state

Given a previous switch run failed partway, leaving one assistant already
  switched to the shared daemon and the rest on the previous arrangement
When the switch runs again
Then every present assistant SHALL reach the shared daemon
And the run SHALL report that it found and converged a partial state

**Scenario:** An unsubstituted placeholder is refused

Given a unit template still contains an unsubstituted placeholder
When `_materialise_mcp_unit` runs
Then it SHALL fail
And SHALL NOT emit a unit that would log to a literal path

**Scenario:** The daemon is not serving

Given the MCP daemon is not serving
When status-mcp-server.sh runs
Then it SHALL print NOT SERVING and the daemon log tail, or a statement that no
  log exists
And SHALL exit non-zero

**Scenario:** The null-capture restore leaves no orphan entry

Given an assistant had no mempalace entry before a switch run
And the switch fails after that assistant was changed
When the restore runs with the captured null
Then the assistant SHALL have no mempalace entry
And SHALL NOT be left with an HTTP entry pointing at a daemon that did not
  stand up

## Out of scope

- **Any new daemon or setup-script behaviour beyond the two named code fixes**:
  the launcher's token-path derivation (requirement 9) and the
  `_materialise_mcp_unit` placeholder guard (requirement 7). Every other defect
  named here is closed by test coverage alone, with the existing production
  code left untouched.
- **The ADR 0016 derived work this ticket does not cover**: the transcript-hook
  write path and its latency measurement, migration and diagnostics, and the
  reference documentation and CLI matrix refresh.
- **Coverage in any suite other than `scripts/tests/test-mcp-daemon.sh`**,
  including `doctor-mempalace.sh` and `test-chroma-server.sh`.
- **The spec-0103 degraded-path fallback**, which is retained as-is.
- **Renumbering or editing the requirements of spec 0113 or its delta**. This
  spec references them and adds its own requirement numbers.

## Open questions

None. The one decision the ticket leaves open — whether the no-baked-token
check can be made falsifiable or must be documented as moot — is resolved by
requirement 10, which names the decision rule and where the evidence is
recorded.
