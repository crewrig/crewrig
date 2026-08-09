---
id: "0116"
slug: antigravity-transcript-activation
status: approved
complexity: standard
interaction-mode: AUTO
related-issue: 724
version: 2.0.0
---

# 0116 — antigravity-transcript-activation (delta-01)

This delta corrects a factual error in the parent spec. Requirement 3 calls
`PreInvocation` "the start-of-turn event". It is not: it fires once per **model
call**, and a single turn contains as many model calls as the agent takes rounds
of tool use.

Measured on this repository, `agy` 1.0.16, one `agy --print` turn issuing three
shell commands, with a probe hook registered at `~/.gemini/config/hooks.json`:

| Event | Fires | Counter observed |
|---|---|---|
| `PreInvocation` | **4×** | `invocationNum` 0 → 1 → 2 → 3 |
| `PostInvocation` | **4×** | `invocationNum` 0 → 1 → 2 → 3 |
| `PreToolUse` | 3× | `stepIdx` 3, 6, 8 |
| `Stop` | **1×** | `executionNum` 0, `terminationReason` `NO_TOOL_CALL` |

The vendor's own installed contract says the same in prose:
`~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/hooks.md`
describes `PreInvocation` as running "before the model is called",
`PostInvocation` as running "after tool calls finish", and `Stop` as running
"when the execution loop terminates" — so the loop is
invocation → tools → invocation → … → stop.

Two consequences follow, and both are why this is a delta rather than a patch.

**The parent spec is wrong on `main`.** Requirement 3's "start-of-turn event"
mislabels the event it mandates. Correcting only the implementation would leave
the misconception recorded as normative.

**The parent's own protection does not hold.** Requirement 3 refuses the per-tool
events, and the parent's rationale — carried into `docs/cli-matrix.md` and into
the text the operator consents to — presents that refusal as what keeps
transcript writes bounded. `PreInvocation` has approximately per-tool-round
cardinality, so the bound was stated and not obtained. A three-tool turn produces
five writes where two were promised; a fifteen-step turn produces sixteen. Each
write blocks the agent loop, which the vendor documents as synchronous.

**Why the earlier evidence missed it.** The parent spec was grounded on a
headless single-prompt `agy --print` probe. That is precisely the case where one
invocation equals one turn, so the probe could not distinguish "per turn" from
"per model call" and corroborated the wrong reading.

**Why `Stop` alone, rather than a corrected `PreInvocation`.** There is no
once-per-turn *start* event in the CLI's five. Gating `PreInvocation` on
`invocationNum == 0` would yield one entry per turn only if that counter resets
at each turn boundary, which the probe above cannot establish — it observed a
single turn. `Stop` needs no such assumption: it is documented and observed as
firing once when the execution loop terminates, and its payload already carries
the conversation id, the model and the termination reason. The turn-start marker
is dropped rather than approximated.

The version bump is **MAJOR** (`1.0.0` → `2.0.0`). Requirement 3 obliged
registering a start-of-turn event; the replacement forbids registering
`PreInvocation` at all. An implementation conforming to the merged requirement is
non-conforming under the replacement.

## ADDED

**Requirements.**

1. **Requirement 22 — the consent text SHALL state the true write volume.** The
   text the Antigravity setup script shows before its confirmation prompt SHALL
   describe how many entries a turn produces, and that description SHALL match
   the events the manifest registers. A statement that is true of the registered
   events but understates their frequency is a violation.
2. **Requirement 23 — registration SHALL be justified by measured cardinality,
   not by event name.** An event SHALL NOT be registered on the strength of its
   name or its documented description alone; its firing frequency relative to a
   turn SHALL be measured against a real multi-step turn, and the measurement
   recorded. A single-prompt probe SHALL NOT be accepted as evidence of
   per-turn cardinality, because one invocation equals one turn in that case.
3. **Requirement 24 — the call site's arguments SHALL be covered.** The
   regression suite SHALL assert the argument list the setup script passes to the
   deployment, not only the deployment's behaviour when called correctly. A
   change to that argument list that disables recording SHALL fail the suite.
4. **Requirement 25 — the content asymmetry SHALL be disclosed.**
   `docs/cli-matrix.md` SHALL record that Antigravity transcript entries carry
   turn markers only, where the other three assistants persist prompt and
   response text, so a reader comparing the four cells is not left to infer
   equivalence.

**Scenarios.**

*Scenario:* a turn produces exactly one entry

```text
Given a deployed Antigravity manifest and persistence enabled
When the assistant completes a turn that issues three tool calls
Then exactly one entry SHALL be persisted for that turn
```

*Scenario:* the consent text matches the registered events

```text
Given the Antigravity setup script's pre-confirmation description
When it is compared with the events the shipped manifest registers
Then the number of entries per turn it states SHALL equal the number the
  registered events produce
```

*Scenario:* an argument change that disables recording is caught

```text
Given the setup script's call to the deployment
When the environment-prefix argument is emptied, so the deployed commands no
  longer enable persistence
Then the regression suite SHALL fail
```

## MODIFIED

1. **Requirement 3 is replaced.**

   - Original R3:

     > **R3.** The Antigravity hook manifest SHALL register the start-of-turn
     > event and the end-of-execution event, and SHALL NOT register the per-tool
     > events.

   - Replacement R3:

     > **R3.** The Antigravity hook manifest SHALL register the end-of-execution
     > event and SHALL register no other event. In particular it SHALL NOT
     > register `PreInvocation`, `PostInvocation`, `PreToolUse` or `PostToolUse`:
     > the first two fire once per model call and the last two once per tool
     > step, so each has approximately per-tool-round cardinality within a turn,
     > and the CLI runs hooks synchronously, blocking the agent loop.

2. **The scenario "High-frequency events are not registered" is replaced**, since
   its enumeration is now incomplete.

   - Original: asserts `PreToolUse`, `PostToolUse` and `PostInvocation` are
     absent.
   - Replacement:

     ```text
     Given hooks/antigravity-transcript-hooks.json
     When its registered event keys are enumerated
     Then the only key SHALL be Stop
     ```

3. **The scenario "A completed turn is recorded" gains a cardinality clause.**
   Its `Then` becomes: "Then exactly one entry SHALL be persisted for that turn,
   and its room SHALL be derived from the conversation identifier in that
   payload."

Requirements 1, 2 and 4 through 21 of the parent spec are **UNCHANGED** and
remain in force. In particular Requirement 5 still applies: the manifest tells
the hook which event fired, because the payload does not.

## REMOVED

1. **The parent's turn-start entry.** No requirement mandates a `session-lifecycle`
   entry at the start of a turn, because no event in the CLI's five fires once at
   that boundary. The hook's ability to classify a `PreInvocation` payload is
   retained — it costs nothing and an operator may register the event themselves
   — but the shipped manifest SHALL NOT register it.
