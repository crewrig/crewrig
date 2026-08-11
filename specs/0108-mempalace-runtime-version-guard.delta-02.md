---
id: "0108"
slug: mempalace-runtime-version-guard
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 703
version: 1.0.2
---


# 0108 — mempalace-runtime-version-guard (delta-02)

This delta addresses four requirements whose intent was legible but whose letter was either literally unsatisfiable, in tension with another requirement, or failed to account for a degenerate case (a source that reports no version at all, or an unreadable pin). Each gap forced a reviewer or implementer to correctly infer the intent rather than reading it.

The version bump is **PATCH** (`1.0.1` → `1.0.2`). All four changes are clarifications that align the text with the originally intended and currently implemented behaviour. None changes what the implementation must do, so this delta invalidates no work merged for issue #623.

## ADDED

(None. This delta adds no new normative requirement, scenario, or out-of-scope item. It only clarifies existing ones.)

## MODIFIED

1. **Requirement 3 is modified** to specify the permitted fallback when the pinned range itself is unreadable or the guard module is unimportable.

   - Original R3:

     > **R3.** A refusal per requirement 1 SHALL emit a diagnostic that names the version found, the pinned supported range, the resolved interpreter, and the action that brings the install into range; and SHALL terminate unsuccessfully so that the launching CLI reports a failed memory server rather than a started one.

   - Replacement R3:

     > **R3.** A refusal per requirement 1 SHALL emit a diagnostic that names the version found, the pinned supported range, the resolved interpreter, and the action that brings the install into range; and SHALL terminate unsuccessfully so that the launching CLI reports a failed memory server rather than a started one. **When the pinned range itself is unreadable, or when the guard module is unimportable, the diagnostic SHALL name the range as `not determined` rather than omitting it.**

2. **Requirement 7 is modified** to clarify that the diagnostic reports what a session actually launches (from the memory-server registrations) versus what a fresh setup would select, and to cover the case where an interpreter serves no version.

   - Original R7:

     > **R7.** The framework SHALL provide an operator-invocable diagnostic that reports, for each MemPalace command that resolves on the operator's search path (`mempalace` and `mempalace-mcp`), the resolved path, the interpreter that would run it, and the MemPalace version that interpreter serves; and that reports the interpreter and version the memory-server launch path would itself select.

   - Replacement R7:

     > **R7.** The framework SHALL provide an operator-invocable diagnostic that reports, for each MemPalace command that resolves on the operator's search path (`mempalace` and `mempalace-mcp`), the resolved path, the interpreter that would run it, and the MemPalace version that interpreter serves; and that reports the interpreter and version **a session actually launches (read from the four memory-server registrations), as well as the interpreter and version a fresh setup would select**. **If an interpreter resolves no MemPalace version, the diagnostic SHALL report that no version is served.**

3. **Requirement 8 is modified** to add the trigger for an interpreter that resolves no MemPalace version at all.

   - Original R8:

     > **R8.** The diagnostic per requirement 7 SHALL report a non-successful outcome when any two of the versions it reports differ, or when any version it reports lies outside the pinned range, and SHALL name which resolved path carries which version so the divergent install is identifiable without further investigation.

   - Replacement R8:

     > **R8.** The diagnostic per requirement 7 SHALL report a non-successful outcome when any two of the versions it reports differ, when any version it reports lies outside the pinned range, **or when an interpreter resolves no MemPalace version at all**. It SHALL name which resolved path carries which version so the divergent install is identifiable without further investigation.

4. **Requirement 9 is modified** to reconcile its text with Requirement 10, clarifying that relying on known package managers is forbidden for discovering existing installations, but does not forbid reporting the framework's own candidate ordering.

   - Original R9:

     > **R9.** The diagnostic per requirement 7 SHALL derive every reported fact from the paths and interpreters that actually resolve at the moment it is invoked, and SHALL NOT depend on an enumeration of known Python package managers. A MemPalace installed by a mechanism the framework does not recognize SHALL still be reported.

   - Replacement R9:

     > **R9.** The diagnostic per requirement 7 SHALL derive every reported fact from the paths and interpreters that actually resolve at the moment it is invoked, and SHALL NOT depend on an enumeration of known Python package managers **to discover those facts**. **This prohibition applies to the discovery of existing installations; it does NOT forbid requirement 10 from reporting the framework's own candidate paths (such as its pipx-specific default candidate) as part of reporting existing framework behavior.** A MemPalace installed by a mechanism the framework does not recognize SHALL still be reported.

## REMOVED

(None. This delta removes no requirement, scenario, or out-of-scope item.)
