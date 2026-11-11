---
id: "0258"
slug: skill-extension-bundled-scripts-typescript
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 1845
version: 1.4.0
---

# Skill- and extension-bundled scripts in TypeScript

*Delta 04 of `specs/0258-skill-extension-bundled-scripts-typescript.md`. Source: bug #1845
(`check-pinned-actions` never reports an action referenced in the step form
`- uses: owner/action@ref`). The defect was inherited from the retired shell
implementation and ported faithfully under requirement 7, whose "same findings as the shell"
parity wording therefore froze it. This delta makes the step form a requirement and releases
`check-pinned-actions` from shell parity for exactly that case. The version is a MINOR bump.
This delta opens no question.*

## ADDED

<!-- markdownlint-disable MD029 -->

46. **Step-form `uses:` is scanned.** `check-pinned-actions` SHALL treat a line as a
    `uses:` reference when `uses:` is its first token, or when it follows a YAML list marker:
    zero or more whitespace characters, then `-`, then one or more whitespace characters, then `uses:`. The value is then
    read exactly as for the plain form (up to the first blank or `#`, surrounding single or
    double quotes stripped, `./`, `../` and `docker://` values skipped, anything not ending
    in `@` plus 40 hexadecimal digits reported as `[UNPINNED]`). A line where `-` is not
    followed by a blank (for example `-uses:`) or where `uses:` is not the first token after
    the marker (for example `- name: uses: x`) SHALL NOT match.
    Acceptance: for a workflow holding the step line `- uses: actions/checkout@v4` on line 5 and a
    job-level line `uses: org/repo/.github/workflows/x.yml@v1` on line 8, the script prints
    both findings, `2 unpinned action reference(s) found` on standard error, and exits 1.

47. **Goldens follow the fix.** The committed golden of the case `dash-form` (whose
    `- uses:` lines encoded the defect) SHALL be updated to the three findings the fixed
    matcher reports, and cases SHALL be added for the step form together with the job-level form, for a
    tab-indented step form, and for the non-matching `-uses:` and `- - uses:` lines. These are base goldens, not overlays: the shell leg is retired and the base
    goldens now state the contract. No deviation letter is added.

48. **Skill version.** The `github-actions` skill SHALL carry a PATCH bump of
    `metadata.provenance.version` in the implementing change, which SHALL also correct the header comment of
    `check-pinned-actions.ts` and the limitation text of the skill that say the dash form
    is not matched.

    Known limitation, accepted: a `uses:` token at the start of a line inside a `run: |`
    block is matched like a real reference, as before; the step form widens this only to
    `- uses:` lines inside such a block.

## MODIFIED

Requirement 7 is modified only for `check-pinned-actions`. Original: "scan the files line by
line with the shell's rules and print the same `[UNPINNED]`, `[RISK]`, `[OK]` and `[FAIL]`
lines …". Replacement: the same sentence, except that `check-pinned-actions` follows
requirement 46 for the step form, which the shell did not detect. The limitation "inline
`uses:` values only" is unchanged (a value on the following line is still not read);
`check-secrets-exposure` and `check-pinned-images` are untouched.

## REMOVED

Nothing is removed.
