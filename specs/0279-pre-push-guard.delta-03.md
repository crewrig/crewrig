---
id: "0279"
slug: pre-push-guard
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1780
version: 1.3.0
---

# Pre-push guard

Delta-03 inverts the authority of the parity guard for migrated capabilities. Slice 3 of epic #1777 (spec `specs/0280-task-ci-contract.md` R4, sub-spec `specs/0283-ci-jobs-run-task.md`) shrinks the `command:` of each capability in `ci/ci-capabilities.yml` to the single entry `task ci:<id>` and makes `taskfiles/ci.yml` the only place where the commands live. Spec 0279 R3 and R4 compare the capability's command list with what `ci:<id>` resolves to; for a migrated capability that comparison is vacuous (the list is `task ci:<id>` and expands to the task itself), so the guard must check the shape instead. The same slice defines a `ci:<id>` task for every capability, which contradicts R10 as written, and it removes provisioning lines from the capability's `command:`, which R5 and R3 step (a) assumed present. This delta adds one requirement (R22) and amends the wording of R2, R3, R4, R5, R10 and R6 minimally. A not yet migrated capability keeps R3 and R4 unchanged, so the guard is green at every intermediate merge of slice 3. Every other requirement is unchanged.

## ADDED

### Requirements

- **R22 (inversion of authority for migrated capabilities).** `scripts/check-ci-pre-push-parity.ts` (the guard of R4) SHALL classify each capability of `ci/ci-capabilities.yml` as migrated or not yet migrated, and apply the rule of its class:
  - **(a) Definition, no marker.** A capability `<id>` is *migrated* if and only if its `command:` is exactly the single entry `task ci:<id>`. The comparison is on the text after collapsing runs of whitespace (R3(d)) and nothing else: a list of two entries, a different task name, extra arguments, or `task ci:<id>` followed by another command is *not yet migrated*. There is no separate marker, flag or list: migrating a capability is one edit of its `command:` (together with the task of `taskfiles/ci.yml`), and reverting is one edit back.
  - **(b) Migrated capability.** The guard SHALL NOT compare command lists. It SHALL fail, naming the capability id, when the task `ci:<id>` does not exist in `taskfiles/ci.yml` (resolved through `scripts/lib/taskfile-tree.ts`). The `ci:<id>` task for a migrated capability is the authority for what the job runs; nothing else is verified about its body by this guard (the other guards of the tree, spec 0278 and spec 0266, keep verifying every task). For a migrated capability R22(b) therefore checks task existence only, and the rule of R3 that a `ci:<id>` task SHALL NOT add, drop or reorder a command the capability lists no longer applies to it, intentionally, because the task body is now the sole authority and the capability lists no command to compare.
  - **(c) Not yet migrated capability.** R3 and R4 apply unchanged: normalisation, expansion and comparison of the command lists, with the failures R4 names. A mismatch is reported exactly as before.
  - **(d) Mismatched `command:`.** A `command:` that names `task ci:<other>` for a capability `<id>` (for example a copy-paste error) is not migrated under (a), and the guard SHALL fail unconditionally, naming the capability id, the offending `command:` text and the expected `task ci:<id>`, whenever that `command:` is a single `task ci:<other>` entry naming another capability's task, even when the two task bodies are identical and a comparison under (c) would pass. In every other non-migrated shape (for example `task ci:<id>` plus any other entry) the capability is compared under (c) and fails there if the resolved lists differ. A `command:` that is not a plain `task ci:<id>` is never accepted silently as migrated.
  - **(e) Unchanged from R4.** The closed set of four control tasks, the check that every `ci:<id>` task other than a control task has a capability `<id>` (R4(a)), the check that every capability of the tier list of R9 has a `ci:<id>` task (R4(c)), the unanchored `- task:` negative case, the explicit notice when a side cannot be read, and the non-zero exit apply to both classes. The guard uses `readCapabilities` and `taskfile-tree` only and adds no YAML parser.
  - **(f) Provisioning of a migrated capability.** A migrated capability no longer lists `npm ci` or `npm install` in its `command:` (it is one entry). Its provisioning (the `npm ci` or `npm install` lines R5 defines, with the checkout and toolchain setup that spec 0280 R1 keeps outside the task) SHALL come from the engine job input of the migrated job, as defined by `specs/0283-ci-jobs-run-task.md`; the task keeps only the precondition of R5. Merge order: this delta merges first and `specs/0283-ci-jobs-run-task.md` second; 0283 refines the form of that job input and does not contradict this paragraph. The rule of R5 (provisioning matches `^npm (ci|install)( |$)`, absent from `ci:<id>`) is unchanged and still enforced on every `ci:<id>` task.

  Acceptance (each testable on `mkdtemp` fixtures of the guard, wired per R16): (1) a fixture whose capability `command:` is `task ci:<id>` with an existing `ci:<id>` task passes, with no command list compared (a `ci:<id>` body differing from any former command text still passes); (2) a fixture with `command:` `task ci:<id>` and no such task fails naming the id; (3) a fixture with a not yet migrated capability (raw command list) and a task whose resolved list matches passes, and with a changed flag, a dropped `--ignore`, a reordered command or a missing task fails exactly as R4 requires; (4) a fixture mixing one migrated and one not yet migrated capability evaluates each under its own rule in the same run; (5) a fixture with `command:` `task ci:other` for capability `<id>` fails under (d) even when the two task bodies are identical, and one with the two entries `task ci:<id>` and a raw command fails under (c); (6) migrating a capability in a fixture by editing only its `command:` (and adding the task) flips its class, and editing it back flips it again, with no other file changed; (7) the real tree passes at every intermediate state of slice 3.

### Scenarios

**Scenario:** a migrated capability is checked by shape

Given a capability `lint-markdown` whose `command:` is exactly `task ci:lint-markdown` and a task `ci:lint-markdown` in `taskfiles/ci.yml`
When the parity guard runs
Then it passes without comparing any command list, and it fails naming `lint-markdown` as soon as the task is removed

**Scenario:** a not yet migrated capability is compared as before

Given a capability `docs-index` with a raw `command:` list and a `ci:docs-index` task whose resolved list drops one command
When the parity guard runs
Then it fails naming `docs-index` and the first differing command, while a migrated sibling in the same run is checked by shape

**Scenario:** a mismatched `command:` is never trusted

Given a capability `ratchet` whose `command:` is `task ci:host-safety`
When the parity guard runs
Then it fails naming `ratchet` unconditionally under R22(d), even if the bodies of `ci:ratchet` and `ci:host-safety` were identical

### Alternatives considered

- **An explicit `migrated: true` marker in the capability record.** Rejected: a second source of truth that can disagree with `command:`, and migrating or reverting would need two coordinated edits. The command text is the fact the contract is about (spec 0280 R1).
- **Keep comparing lists for migrated capabilities by expanding `task ci:<id>`.** Rejected: it compares the task with itself, so it can never fail and only costs time.
- **A big-bang flip of every capability and the guard together.** Rejected: spec 0280 R9 requires every slice to be revertible and CI green at each merge, hence the per-capability class rule.

## MODIFIED

Minimal wording changes; the rest of each requirement is verbatim.

- **R2 (one task per reused CI job).** Original sentence: "`taskfiles/ci.yml` SHALL define a task `ci:<capability-id>` that runs exactly that capability's CI command, as R3 defines "exactly"." Replacement: "`taskfiles/ci.yml` SHALL define a task `ci:<capability-id>` that runs exactly that capability's CI command, as R3 defines "exactly" for a not yet migrated capability; for a migrated capability (R22) the task is the authority and the capability's `command:` is `task ci:<capability-id>`." R2 further applies to every capability (not only the fast tier) once it is migrated, by R10 as amended.
- **R3 (what "exactly the CI command" means).** Add as the first sentence: "This requirement applies to every capability that is not migrated under R22(a); a migrated capability is checked by R22(b) and not compared." Step (a) of the normalisation (drop provisioning) is unchanged and continues to apply to the not yet migrated side.
- **R4 (parity by construction, mechanical).** Add after "SHALL fail": "for a capability that is not migrated under R22(a)," before the failure condition (b) ("the normalised command lists of R3 differ"); conditions (a) and (c) and the rest are unchanged, and the guard additionally applies R22 to migrated capabilities.
- **R5 (provisioning rule).** Add at the end: "Where a capability is migrated (R22), its provisioning is carried by the engine job input and not by its `command:`; the task keeps only the precondition." The definition, the exported constant and the acceptance are unchanged.
- **R10 (excluded families).** Original: "...each for the reason given, and no `ci:<id>` task SHALL be defined for them by this spec:". Replacement: "...each for the reason given. They stay out of the fast tier and out of `ci:pre-push`: the tier list `ci/pre-push-tier.json` of R9 remains the only admission list, no task of these families SHALL be listed in it, and `ci:pre-push` SHALL NOT run them. A `ci:<id>` task for a capability of these families MAY and, once the capability is migrated under R22, SHALL exist (it is the CI contract of spec 0280, run by the engine job, never by the hook):". The list of families, the sentence on a fast-tier capability that grows past the admission rule, and the rest are unchanged. Acceptance (replaces the last sentence): "the guard of R4 reports no missing task for a capability of the tier list and no `ci:<id>` without a capability; a test proves that no id of an excluded family is selected by `ci:pre-push` even when its `paths:` match the changeset, and that the tier list contains none of them."
- **R6 (known drift: `lint-markdown`).** No text change. After migration the union command lives only in `taskfiles/lint.yml` and `ci/ci-capabilities.yml` holds `task ci:lint-markdown`; R6's convergence is satisfied by the single remaining copy, and its acceptance ("R4 passes on `lint-markdown`") is read as "the guard passes on `lint-markdown` under R22".

Not amended, for the reason given: R1 (task layout) and R20 (tree invariants) hold because the new `ci:*` names extend the name-set baseline as R1 already requires; R7, R12 and R13 concern the content of tasks, not the capability record; R8(c) and R9 select and admit by `paths:` and by the tier list, which migration does not touch (R8(d), "a capability without a `ci:` task never runs in the hook", stays true and is now rarely exercised); R16 wiring is unchanged except that the guard's new tests belong to the same owning capability.

## REMOVED

Nothing is removed.
