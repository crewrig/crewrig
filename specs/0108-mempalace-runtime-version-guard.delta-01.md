---
id: "0108"
slug: mempalace-runtime-version-guard
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 623
version: 1.0.1
---

# 0108 — mempalace-runtime-version-guard (delta-01)

This delta makes spec 0108's Requirement 2 **literally satisfiable**. As
merged, R2 forbids taking the version "from a package-manager inventory",
but every source available inside the serving process arguably falls under
that phrase: `importlib.metadata.version()` resolves the `*.dist-info`
directory that pip and pipx themselves write, and the only alternative —
MemPalace's own `__version__` literal — is a hand-maintained value that can
disagree with what was installed. Read strictly, R2 admits no compliant
source at all.

The requirement's *intent* is legible and is not in doubt: do not query an
installer's bookkeeping out of process (`pipx list`, `uv tool list`), do not
trust a `mempalace` executable resolved from `PATH`, and do not reuse a value
recorded at setup time. The #623 incident is precisely what that intent
guards against — `pipx list` reported 3.3.5 while the interpreter that
actually served resolved elsewhere, so an installer's own inventory was the
one source that could not detect the drift.

What the requirement fails to say is what *is* permitted. The evidence that
this is a real defect rather than pedantry: **two independent cold reviewers,
reviewing two successive plan revisions, each had to infer the permitted
source and each recorded that inference in their verdict** rather than
reading it from the spec. An inference two reviewers had to make separately
is a clause the spec is missing.

This delta MODIFIES Requirement 2 only. Every other requirement of spec 0108
— Requirements 1 and 3 through 12 — is **UNCHANGED** and remains in force. No
scenario changes: the seven scenarios in the parent spec are all silent on
*how* the version is obtained, so none is affected. No open question is
introduced.

The version bump is **PATCH** (`1.0.0` → `1.0.1`). Per `docs/spec-format.md`
→ *Delta-spec convention → Versioning*, `PATCH` covers a "clarification,
wording fix, scenario added without changing any existing requirement". This
delta removes an ambiguity without constraining any previously unspecified
case and without invalidating any work: both plan revisions authored against
the parent spec already honour the clarified reading, so nothing planned or
built needs to change because of it.

## ADDED

(None. This delta modifies one requirement's wording; it adds no
requirement, scenario, or out-of-scope item.)

## MODIFIED

1. **Requirement 2 is replaced** so that it states the permitted source
   rather than only the forbidden ones.

   - Original R2:

     > **R2.** The version determined per requirement 1 SHALL be the version
     > resolvable from the interpreter that will actually serve the session,
     > and SHALL be determined inside the very process that goes on to serve,
     > before that process begins serving. It SHALL NOT be taken from a
     > package-manager inventory, from a version reported by a `mempalace`
     > executable found on the operator's search path, or from a version
     > recorded when the framework was last set up.

   - Replacement R2:

     > **R2.** The version determined per requirement 1 SHALL be the version
     > resolvable from the interpreter that will actually serve the session,
     > and SHALL be determined inside the very process that goes on to serve,
     > before that process begins serving. It SHALL be obtained through that
     > interpreter's **own in-process resolution** — the same machinery an
     > `import` in that process would use — so that the value reflects what
     > that interpreter will actually load. It SHALL NOT be obtained by
     > querying a package manager's inventory **out of process**, by invoking
     > a `mempalace` executable resolved from the operator's search path, or
     > by reusing a version recorded when the framework was last set up. That
     > an in-process resolution reads metadata a package manager originally
     > wrote does not place it under this prohibition: the prohibition
     > targets *asking an installer what it believes it installed*, which is
     > the class of source that cannot detect the resolution drift this spec
     > exists to catch.

## REMOVED

(None. This delta modifies Requirement 2 only; it removes no requirement,
scenario, or out-of-scope item. Requirements 1 and 3 through 12 of spec 0108
remain in force unchanged.)
