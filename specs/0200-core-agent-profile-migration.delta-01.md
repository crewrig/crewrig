---
id: "0200"
slug: core-agent-profile-migration
status: draft
complexity: small
interaction-mode: MINIMAL
related-issue: 1123
version: 2.0.0
---

# Migration of the core agent sources to capability profiles — delta 01

Narrows the two byte-identity requirements of spec 0200 — requirements 17 and
19 — so that neither obliges an identity the same spec's requirement 22 makes
impossible, and repairs the two recorded statements that carry the same defect:
the third clause of Decision 6 and the evidence-base paragraph *The diff a
migrated source produces*. Authored for issue #1123, after the PLAN v1 of that
issue ([comment 5559852306](https://github.com/crewrig/crewrig/issues/1123#issuecomment-5559852306),
sections *Contradiction A* and *Contradiction B*) measured the conflict over a
full throwaway migration of all 22 sources.

The conflict is arithmetic, not interpretive. Requirement 22 obliges every
source this change set modifies to bump its `metadata.provenance.version` by a
MINOR increment. `inject_provenance` in `scripts/build-components.sh` splices
the source's `metadata.provenance` block — `version` included — into the
compiled Claude Code, GitHub Copilot CLI and Antigravity CLI outputs, and
`gemini_provenance_comment` carries the same `version=` into the Gemini CLI
output's `<!-- crewrig-provenance: … -->` line. A bumped version therefore
reaches all four of a migrated source's compiled outputs, whatever else the
resolution does or does not emit on each target. Measured: all 22
`.github/agents/*.md` differ from `723ad8f`, each by exactly the `version` line,
with 0 files carrying any other changed line.

This delta introduces no design and changes no mechanism. The provenance
carrier's contract is spec 0030's (`docs/cli-matrix.md` row 4b) and stays
exactly as it is; requirement 22 stays exactly as it is; the resolution still
emits nothing onto the GitHub Copilot CLI surface, `model-mappings/copilot.yml`
declaring zero offerings. What moves is the parent's own text, so that a reader
of spec 0200 alone is not left holding two requirements that cannot both be
satisfied.

`MAJOR` bump, per [`docs/spec-format.md`](../docs/spec-format.md) →
*Delta-spec convention → Versioning*. Requirement 17's operative clause is
replaced in full, and every instance it governs flips verdict: an assertion
written from its text — `.github/agents/<name>.md` diffing empty against
`723ad8f` — is obliged to hold by the original and obliged to fail by the
replacement, on all 22 of the outputs in that tree at `723ad8f`. Requirement
19's scope term `compiled body` is redefined rather than glossed: under the
widest reading of the original, 22 of 22 Gemini CLI agent outputs violate it;
under the replacement, 0 of 22 do. That is an inversion of a shipped
assertion's verdict across its whole domain, which is the disposition
[`specs/0121-antigravity-outputs-in-core-paths.delta-01.md`](0121-antigravity-outputs-in-core-paths.delta-01.md)
reached on the same grounds, holding explicitly that the absence of an
already-committed test does not downgrade the bump.

Two things that might look like grounds for a smaller bump are not. First, the
parent's *intent* survives intact: Decision 6 and requirement 33 make
requirement 17's purpose the statement that no model item reaches the GitHub
Copilot CLI surface, and nothing here touches that. Second, no in-flight work
is actually invalidated — the PLAN v1 of issue #1123 pre-positions the narrowed
reading in its test cases, and DEV has not landed. But `version` grades the
parent's *text* — what a reader may still quote and a tester may still encode —
not its intent and not one particular plan's foresight. The alternative reading
that requirement 17 was unsatisfiable in conjunction with requirement 22, so
that no conforming implementation existed to invalidate and the bump is
therefore `MINOR`, is rejected on that same ground: an unsatisfiable
requirement is the case where a `MINOR` bump misleads hardest, telling a reader
that the change is additive and that their reading of the original survives,
when requirement 17's reading does not.

Nothing observable changes with this delta. It is normative text only: no
script, no mapping, no source and no compiled output is touched here. The
mechanical change — the profiles, the regenerated trees, the new check —
belongs to the change set of spec 0200.

**Vocabulary.** *Target*, *mapping*, *offering*, *surface*, *resolution*,
*drop*, *rung*, *capability profile*, *legacy key*, *tier* and *guidance prose*
carry the meanings spec 0200 gives them. One term is added. The **provenance
carrier** is the place a compiled output holds its source's
`metadata.provenance` fields: the `metadata:` block spliced into the output
frontmatter by `inject_provenance` on the Claude Code, GitHub Copilot CLI and
Antigravity CLI targets, and the single `<!-- crewrig-provenance: … -->` line
emitted by `gemini_provenance_comment` on the Gemini CLI target, which sits
after the closing frontmatter fence and before the body.

This delta adds no requirement; the parent's sequence still ends at requirement
40.

## ADDED

### Added scenarios

**Scenario:** a migrated source's Copilot CLI output changes only in its
provenance version

```text
Given a migrated agent source whose metadata.provenance.version carries the
      MINOR bump requirement 22 obliges
When  the compiled outputs are regenerated with bash
      scripts/build-components.sh --target all
Then  its .github/agents/<name>.md differs from its content at 723ad8f by
      exactly the metadata.provenance.version line
And   it differs from that content in no other byte, carrying no model:
      frontmatter field, no effort: frontmatter field, no guidance prose and
      no changed description
```

This is the failure-path counterpart the parent's *a `sonnet`-tier source is
migrated* scenario cannot carry, because that scenario tests one source's four
emissions and this one tests the absence of every emission on the target that
receives none. It is directly measurable, where a bare byte-identity assertion
over the same file is not decidable in the presence of requirement 22.

## MODIFIED

1. **Requirement 17 is replaced** so that it names the one line requirement 22
   obliges to change and forbids every other change, rather than forbidding all
   change and thereby forbidding requirement 22.

   - Original R17:

     > **R17.** Each migrated source's compiled GitHub Copilot CLI output SHALL
     > be byte-identical to its content at `723ad8f`.

   - Replacement R17:

     > **R17.** Each migrated source's compiled GitHub Copilot CLI output SHALL
     > be identical to its content at `723ad8f` except for the
     > `metadata.provenance.version` line that requirement 22 obliges, and
     > SHALL differ in no other byte.

   **Why the narrowed form is stronger than the original.** Bare byte-identity
   is one predicate over the whole file, and under requirement 22 it is false
   for all 22 outputs — so it carries no information at all about anything else
   the build did or did not emit there. The replacement is two predicates: one
   named line may differ, and nothing else may. The second predicate excludes a
   changed `description`, an added frontmatter key, a stray guidance sentence,
   a `model:` field and an `effort:` field — every emission requirement 17
   exists to forbid — and excludes them measurably. What requirement 17 exists
   to state, per Decision 6 and requirement 33, is that no model item reaches
   the GitHub Copilot CLI surface; that is what the replacement states, and it
   is now the kind of statement a test can decide.

2. **Requirement 19 is replaced** so that its scope term `compiled body`
   excludes the provenance carrier, which is where the version line lands on
   the one target whose carrier sits outside the frontmatter.

   - Original R19:

     > **R19.** The compiled **body** of every agent output on every target
     > SHALL be byte-identical to its content at `723ad8f`, and every compiled
     > skill output and compiled command output SHALL likewise be
     > byte-identical to its content at `723ad8f`.

   - Replacement R19:

     > **R19.** The compiled **body** of every agent output on every target
     > SHALL be byte-identical to its content at `723ad8f`, the **provenance
     > carrier** being excluded from the body for this purpose — the
     > `metadata.provenance` block, which sits in the output frontmatter on the
     > Claude Code, GitHub Copilot CLI and Antigravity CLI targets, and the
     > `<!-- crewrig-provenance: … -->` line, which sits between the closing
     > frontmatter fence and the body on the Gemini CLI target. Every compiled
     > skill output and compiled command output SHALL likewise be
     > byte-identical to its content at `723ad8f`.

   **The exclusion changes the verdict on exactly one target.** On Claude Code,
   GitHub Copilot CLI and Antigravity CLI the provenance carrier is a
   frontmatter block, so it falls outside the body under any reading, and 0 of
   22 outputs differ on each of those three trees even under the widest reading
   of *body* — all bytes after the closing fence. On Gemini CLI the carrier is
   a body-adjacent HTML comment, so the widest reading makes 22 of 22 outputs
   differ while the reading this replacement fixes makes 0 of 22 differ. The
   build's own construction supports the fixed reading rather than merely
   permitting it: in `scripts/build-components.sh`, `$body` is `extract_body`'s
   output and the provenance comment is a separate interpolation placed before
   it, so the two are distinct values that the output assembly concatenates.

   The replacement's second clause is carried over verbatim, and holds without
   qualification: no skill source and no command source carries the legacy key,
   this change set modifies none of them (`## Out of scope`, *New agents, and
   any change to a skill source or a command source*), so requirement 22 never
   reaches their provenance and their compiled outputs stay byte-identical.

3. **The third clause of Decision 6 is restated.** A decision is recorded
   rationale rather than an obligation, so this changes nothing a change set
   must do; it stops the parent's rationale from contradicting the requirements
   it exists to explain, and corrects a count.

   - Original clause:

     > the four GitHub Copilot CLI agent outputs stay byte-identical to
     > `723ad8f`;

   - Replacement clause:

     > the 22 GitHub Copilot CLI agent outputs stay identical to `723ad8f`
     > except for the `metadata.provenance.version` line that requirement 22
     > obliges, and differ in no other byte;

   **On the count.** The migration covers 22 sources under
   `artifacts/core/agents/`, each producing one compiled GitHub Copilot CLI
   agent output; `.github/agents/` holds exactly 22 files on the tree at
   `723ad8f`. The `four` appears to have been carried over from the clause
   immediately following it in the same sentence, where four is correct —
   `harness-curator` has one compiled output per target, and there are four
   targets.

4. **The evidence-base paragraph *The diff a migrated source produces* is
   qualified** as the version-bump-free measurement it is. The measurement was
   reproducible and correct for the experiment the parent describes running —
   "a throwaway build over one real source (`architect` at
   `intelligence: xhigh`) whose four compiled outputs were diffed and then
   reverted". That experiment applied the profile without the version bump
   requirement 22 obliges, so it measured the resolution's emissions in
   isolation rather than the change set's diff. It is the experiment that was
   narrower than the change set, not the reading of its result.

   - Original paragraph:

     > **The diff a migrated source produces.** For `architect` at
     > `intelligence: xhigh`: one changed line in
     > `.claude/agents/architect/AGENT.md` (the `description`), one changed
     > line in `.agents/agents/architect/AGENT.md` (the `description`), one
     > added line in `.gemini/agents/architect.md` (the `model:` field), and
     > `.github/agents/architect.md` byte-identical. No compiled body changed
     > on any target.

   - Replacement paragraph:

     > **The diff a migrated source produces, before the version bump.**
     > Measured on a throwaway build that applied the profile without the
     > `metadata.provenance.version` bump requirement 22 obliges, so as to
     > isolate the resolution's emissions. For `architect` at
     > `intelligence: xhigh`: one changed line in
     > `.claude/agents/architect/AGENT.md` (the `description`), one changed
     > line in `.agents/agents/architect/AGENT.md` (the `description`), one
     > added line in `.gemini/agents/architect.md` (the `model:` field), and
     > `.github/agents/architect.md` byte-identical. No compiled body changed
     > on any target. **With the bump applied**, each of the four outputs
     > additionally carries the changed `metadata.provenance.version` — inside
     > the `<!-- crewrig-provenance: … -->` line on Gemini CLI, inside the
     > spliced `metadata:` block on the other three — and
     > `.github/agents/architect.md` differs from `723ad8f` by that line alone.

5. **The scenario *a `sonnet`-tier source is migrated* is replaced**, because
   its fourth `And` asserts on `.github/agents/developer.md` the byte-identity
   the replaced requirement 17 no longer obliges. Only that outcome line moves;
   the `Given`, the `When` and the other three `And` lines are unchanged.

   - Original scenario:

     ```text
     Given artifacts/core/agents/developer/AGENT.md carries metadata.claude.model
           sonnet on the tree at 723ad8f
     When  the migration is applied and bash scripts/build-components.sh --target
           all runs
     Then  the source carries metadata.model.intelligence high and no
           metadata.claude mapping
     And   .claude/agents/developer/AGENT.md carries the guidance prose naming
           the sonnet model appended to its description, and no model:
           frontmatter field
     And   .gemini/agents/developer.md carries model: gemini-3.1-pro-preview
     And   .github/agents/developer.md is byte-identical to its content at
           723ad8f
     And   .agents/agents/developer/AGENT.md carries the guidance prose naming
           the gemini-3.1-pro-low model appended to its description
     ```

   - Replacement scenario:

     ```text
     Given artifacts/core/agents/developer/AGENT.md carries metadata.claude.model
           sonnet on the tree at 723ad8f
     When  the migration is applied and bash scripts/build-components.sh --target
           all runs
     Then  the source carries metadata.model.intelligence high and no
           metadata.claude mapping
     And   .claude/agents/developer/AGENT.md carries the guidance prose naming
           the sonnet model appended to its description, and no model:
           frontmatter field
     And   .gemini/agents/developer.md carries model: gemini-3.1-pro-preview
     And   .github/agents/developer.md differs from its content at 723ad8f by
           exactly the metadata.provenance.version line and by no other byte
     And   .agents/agents/developer/AGENT.md carries the guidance prose naming
           the gemini-3.1-pro-low model appended to its description
     ```

6. **The scenario *the committed tree is derivable from its sources* is
   replaced**, because its second `And` asserts on every compiled agent body
   the byte-identity the replaced requirement 19 now qualifies. Only that
   outcome line moves.

   - Original scenario:

     ```text
     Given the migrated tree with its regenerated compiled outputs committed
     When  bash scripts/build-components.sh --target all --check runs
     Then  it reports zero drift
     And   every compiled skill output and compiled command output is
           byte-identical to its content at 723ad8f
     And   every compiled agent body is byte-identical to its content at 723ad8f
     ```

   - Replacement scenario:

     ```text
     Given the migrated tree with its regenerated compiled outputs committed
     When  bash scripts/build-components.sh --target all --check runs
     Then  it reports zero drift
     And   every compiled skill output and compiled command output is
           byte-identical to its content at 723ad8f
     And   every compiled agent body, the provenance carrier excluded, is
           byte-identical to its content at 723ad8f
     ```

**Requirement 20 is UNCHANGED, and is the one byte-identity claim in the parent
that requirement 22 cannot reach.** Its subject is
`artifacts/library/agents/harness-curator/AGENT.md`, which requirement 23
forbids this change set to modify and forbids to bump its version. An unbumped
`metadata.provenance.version` reaches the provenance carrier of all four of
that source's compiled outputs unchanged, on every target and under either
reading of *body*, so those four outputs stay byte-identical to `723ad8f`
without qualification and the witness requirement 26 of spec 0198 needs stays
in the committed tree. Its scenario, *the profile-less source is untouched*, is
UNCHANGED for the same reason: requirement 23 is exactly what makes its
`metadata.provenance.version is unchanged` line true, and that line is what
makes its byte-identity line true.

**Every other requirement is UNCHANGED.** Requirements 1 through 12 bind the
declared profiles and the closed-key check, which no provenance field touches.
Requirements 13 through 16, 18 and 21 assert emissions and diagnostics —
guidance prose, a `model:` field, the absence of an `effort:` field, zero drift
under `--check`, one note and one drop record per migrated agent — every one of
which is indifferent to what the provenance carrier holds. Requirement 22 is
UNCHANGED and is the requirement this delta preserves: the conflict is resolved
by narrowing the two requirements that contradicted it, never by relaxing it.
Requirements 23 and 24 stand as written. Requirements 25 through 31 bind
documentation surfaces, 32 through 34 the decoupling from probe C and seam (g),
and 35 through 40 the tests and continuous-integration guards; none of them
asserts a byte-identity against `723ad8f`.

Requirement 36 deserves a note although its text is UNCHANGED: the derivability
invariant it carries — that the committed outputs equal what a fresh build
produces from the sources and the mappings in force — is unaffected by this
delta and stays the parent's primary guarantee. A bumped provenance version is
part of what a fresh build produces, so `--check` reports zero drift over the
committed tree either way. It is the *historical* baseline, not the derivable
one, that requirements 17 and 19 needed narrowing to keep true.

**Decisions 1 through 5 are UNCHANGED**, none of them resting on a
byte-identity claim. Of the parent's eight scenarios, two are replaced above
and *the profile-less source is untouched* is disposed of with requirement 20
just above; the five remaining — *the diagnostic stream carries exactly the
migration's drops*, *a source re-introduces the legacy key*, *an out-of-domain
rung is refused*, *a profile is edited without regenerating*, and *a fork
adopts the change without an override* — are UNCHANGED, none of them asserting
an identity against `723ad8f`. Every `## Out of scope` bullet of the parent is
UNCHANGED, and its `## Open questions` section, which concerns the line-number
citation into `artifacts/FORMAT.md`, is untouched here.

## REMOVED

None.
