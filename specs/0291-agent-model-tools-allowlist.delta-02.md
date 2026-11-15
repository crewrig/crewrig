---
id: "0291"
slug: agent-model-tools-allowlist
status: draft
complexity: small
interaction-mode: AUTO
related-issue: 1937
version: 1.2.0
---

# Agent frontmatter: the model on Claude Code and a least-privilege tool allowlist

*Delta 02 of `specs/0291-agent-model-tools-allowlist.md`. Source: issue #1937 (implementation PR #2041). Owner decision, 2026-11-15: the sentence `Give its work <rung> reasoning effort.` SHALL disappear from the Claude Code description when the effort is already carried by the `effort:` frontmatter key. R2 of the parent applies the rule "one carrier at a time" to the `model` item and says "The `reasoning` item is unchanged"; this delta extends the rule to `reasoning`. Version 1.2.0, a MINOR bump: no declaration changes meaning, one compiled sentence leaves the Claude Code description. Every requirement of the parent and of delta 01 other than R2's last sentence is unchanged. Tier `small`: one resolver assignment, its tests and the descriptions it recompiles. This delta opens no question.*

## ADDED

<!-- markdownlint-disable MD029 -->

34. **R34 (reasoning follows R2: one carrier at a time).** The `reasoning` item SHALL be directed onto the guidance prose unless all three of these hold: the guard is not `withheld` (a mapping with no guard counts as directed, as R2 does for `model`), the frontmatter surface carries the item, and the projected value is inside the declared domain of the frontmatter key (`effort`: `low`, `medium`, `high`, `xhigh`, `max`; the `none` rung is declared `unmapped`, so it has no image). Under a `withheld` guard the item stays on the frontmatter as today (the `effort:` line is written) and the guidance prose carries it too; "not directed onto the frontmatter" in the owner decision SHALL NOT be read as "no `effort:` line". Under a guard that is not `withheld`, with a projected value inside that domain, the effort SHALL be carried by the `effort:` key alone, and the compiled Claude Code description SHALL NOT contain `Give its work <rung> reasoning effort.`. The permitted fallback is explicit: when the guard is `withheld`, the target has no frontmatter surface for the item, or the frontmatter cannot carry the value, the guidance sentence carries it exactly as before this delta, with the reasoning-rung substitution of spec 0197 unchanged, so a declared reasoning is never expressed on no surface. This requirement supersedes, for `reasoning`, the word "additionally" in spec 0197 R31, as R6 of the parent does for `model`, and so needs one change in `scripts/lib/model-resolve/resolve-item.ts`: the final `state.gd[idx]` assignment, whose exclusion today names only `item === "model"`, SHALL exclude `reasoning` on the same condition (`fmOk`). The guidance surface and template of `model-mappings/claude.yml` (`carries: [model, reasoning]`) stay unchanged, so rule A20a is untouched.
35. **R35 (the other targets and the withheld guard are unchanged).** The Antigravity description, whose target has no frontmatter surface for reasoning, SHALL keep both its model sentence and its `Give its work <rung> reasoning effort.` sentence byte-identically. Under an organization mapping that sets `guard.state: withheld` (R5 of the parent), a build SHALL, for every Claude Code agent, keep the `Run this agent on the <model> model.` sentence and the `Give its work <rung> reasoning effort.` sentence in the description, write no `model:` key and still write the `effort:` line of a declared reasoning; the output SHALL be byte-identical to the pre-change build (`effort: medium` plus both sentences), with the diagnostics unchanged (spec 0197 R31 withheld clause and R32). Gemini CLI and Copilot CLI outputs, which carry neither item on these surfaces today, SHALL be byte-identical to the pre-change build.
36. **R36 (tests and docs follow).** Every test whose expectation encodes the Claude Code reasoning sentence next to an `effort:` key SHALL be updated (R25 of the parent, extended to this sentence), including `scripts/tests/agent-profile-build.test.ts`, `scripts/tests/agent-profile-committed.test.ts` and the model-resolve and build-components suites whose frozen cases run a `directed` Claude guard with a reasoning item. The compiled Claude Code agents carrying a reasoning profile SHALL be rebuilt so that their descriptions lose the sentence and keep `effort:`. The statements in `docs/model-mapping-format.md` (*Guard*) and in the guard row of the CLI matrix that name R2 as the `model`-only rule SHALL name the extension and the supersession of "additionally" for `reasoning`. The tests SHALL be hermetic (R27 of the parent) and add no test file, no CI capability and no line to the three CI surfaces (R26 of the parent holds).

### Scenarios

**Scenario:** Claude Code architect, effort carried by frontmatter only

```text
Given the guard is directed on the Claude Code mapping
And   the architect agent declares intelligence high and reasoning medium, resolving to model opus
When  the component build runs for the claude target
Then  the architect file carries "model: opus" and "effort: medium"
And   its description contains neither "Run this agent on the opus model." nor "Give its work medium reasoning effort."
```

**Scenario:** a withheld guard keeps both sentences

```text
Given an organization mapping sets guard.state withheld and the term copilot-reader-fails-on-unserved-model to holds true
And   an agent declares a model and a reasoning of medium
When  the component build runs for the claude target
Then  the file carries no model: key and carries "effort: medium"
And   the description keeps "Run this agent on the <model> model." and "Give its work medium reasoning effort."
And   the stream carries one model-note line with reason guard-withheld, as before
And   the whole file is byte-identical to the pre-change build
```

**Scenario:** Antigravity is unchanged

```text
Given an agent declares a model and a reasoning of medium
When  the component build runs for the antigravity target
Then  the description carries both the model sentence and "Give its work medium reasoning effort."
And   the file is byte-identical to the build before this delta
```

**Scenario:** a reasoning value outside the effort domain falls back to guidance

```text
Given the guard is directed on the Claude Code mapping
And   an agent declares reasoning none, a rung the effort key does not map
When  the component build runs for the claude target
Then  the file carries no effort: key
And   the description carries the reasoning guidance sentence for that rung, as before this delta
And   the model sentence is still absent when the model: key carries the model
```

## MODIFIED

- **R2 (one carrier at a time), last words of the requirement and the sentence that follows.** Original: "The `reasoning` item is unchanged." Replacement: "The `reasoning` item follows a rule stated by R34 of delta 02: it is directed onto the guidance prose unless the guard is not `withheld` and the frontmatter carries it with a value inside the `effort` domain, so under a guard that is not `withheld` with such a value the compiled Claude Code description SHALL NOT contain `Give its work <rung> reasoning effort.`." The rest of R2, which reads "supersedes that word of R31 as a resolver rule" for `model`, stays in force and is extended to `reasoning` by R34.
- **R25 (tests that encode the old state), first sentence.** Original: "Every test whose expectation encodes the `withheld` Claude guard, the two old terms or the guidance `model` sentence SHALL be updated". Replacement: "Every test whose expectation encodes the `withheld` Claude guard, the two old terms, the guidance `model` sentence or the guidance `reasoning` sentence next to an `effort:` key SHALL be updated" (R36).

## REMOVED

Nothing is removed from the parent's requirements: only the clause "The `reasoning` item is unchanged" of R2 is replaced (see MODIFIED). The sentence `Give its work <rung> reasoning effort.` is removed from the compiled Claude Code description of an agent whose effort is carried by `effort:`; it stays wherever the frontmatter cannot carry the effort.

## Out of scope

- The shell-oracle goldens under `scripts/tests/fixtures/model-resolve-oracle/` are untouched: they are frozen shell output that the host cannot re-record, and R25 of the parent already forbids a hand edit.
- The frozen conformance corpus: apart from two cases it declares no reasoning item, so its outcomes do not change. The two cases that declare reasoning under a directed guard, `M7_directed#0` and the organization case `xo_guard-id#0`, become documented deviations from their frozen expected output (the reasoning sentence leaves the guidance prose, `effort:` stays); their goldens are untouched and no golden is edited by hand.
- Spec 0197 and its deltas are not edited (the supersession is by this delta, as in R6 of the parent); a parallel delta of 0197 (issue #2040) is a separate change.
- The Antigravity reasoning-rung substitution, the `none` rung's projection and the `effort` domain.
- Any new frontmatter key, any change to the guard state or terms, and any change to the model sentence rule of R2.

## Open questions

None.
