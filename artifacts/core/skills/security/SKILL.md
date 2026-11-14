---
name: security
description: 'Reviews code and designs through a security lens: threat models, findings that trace a path from a trust boundary to a sink, secret handling and dependency audits, then checks its own report with bundled scripts. Use when asked for a threat model, attack surface or trust boundary analysis, or a review of authentication, authorization, session handling, secrets, a credential leak, cryptography, deserialization, input validation or SSRF, or for a dependency audit, a CVE check or a dependency upgrade review. Not for authoring or hardening GitHub Actions workflows or GitLab pipelines (github-actions, gitlab-ci), applying a fix (developer), pull request verdicts (pr-reviewer), pull request descriptions (pr-logbook) or design alternatives (architect).'
type: skill
license: Apache-2.0
compatibility: "Requires Node.js 24 (scripts run as node scripts/<name>.ts). npm and pip-audit are optional: only dep-audit.ts needs them, and it exits 3 without the one an ecosystem needs."
metadata:
  provenance:
    canonical: "${CANONICAL_REPO}"
    feedback: "${CANONICAL_REPO}"
    version: "1.2.0"
claude:
  allowed-tools:
    - Read
    - Grep
    - Glob
    - Bash
  user-invocable: true
---

# Security

A review looks for the next realistic exploit; it does not walk a checklist of every weakness class. Two threats with a credible exploit path get fixed, twenty generic ones get skimmed past, so spend the effort on the first kind.

## Rules whose reason is not obvious

- **No traced path, no finding.** Read the function end to end, then follow the data from the untrusted input to the sink. A "potential" issue with no path costs the author time and costs you credibility, so leave it out. When no test covers the threat path, say so in the `Fix:` line and name the test to add: the fix has no regression guard otherwise.
- **Review security-adjacent modules** (payment, personal data, audit log) even when the diff looks harmless. The stakes come from the module, not from the hunk.
- **Reserve `BLOCKER` for what must be fixed before merge**, such as a credential leak, remote code execution or an authentication bypass. A reader triages by severity, so an inflated scale is ignored.

| Severity | Meaning |
|---|---|
| `BLOCKER` | Fix before merge: leaked credential, code execution, authentication or authorization bypass. |
| `HIGH` | Exploitable with real impact; fix before release. |
| `MED` | Exploitable only under extra conditions, or with limited impact; schedule it. |
| `LOW` | Hardening with a small gain. |
| `INFO` | An observation that needs no action. |

- **Never echo a secret**, in a finding or in the transcript: both are persisted copies. Show evidence with the value masked, at most four characters followed by asterisks (`sk_l****`).
- **Rotation is part of the finding.** Deleting the line does not revoke a key that sits in the history, so treat a secret as compromised the moment it reached a store that is not secret-grade, and put "rotate the exposed key" and "read it from an environment variable or a secret store" in the `Fix:` line.
- **Flag a diff that adds** `.env`, `credentials.json`, `*.pem` or a file under a vault path: such files hold secrets by convention.
- **Dependencies.** Read the changelog between the current and the target version. On a minor or patch bump, look at transitive changes and licence drift; on a major bump, name the breaking changes and require a migration note. `dep-audit.ts` reports advisories but not whether the code reaches the affected path, so reachability is your judgement: say whether the vulnerable function is called.

## Report format

Write the findings as a numbered list, one block each:

```text
1. [SEV] <one-line summary>
   Where: <file:line>
   Threat: <what an attacker would do>
   Evidence: <code or trace, secrets masked>
   Fix: <concrete recommendation>
```

- `[SEV]` is one of the five severities above. `Where:` is `<file>:<line>` or `<file>:<first>-<last>`, a line of the whole file in the checkout, so that a reader can open it. A value may continue on indented lines.
- When the input is a diff, cite the path of the post-image from the `+++` header without its `a/` or `b/` prefix, and a line of the new-file side of the hunk. A path that exists only in the diff cannot be opened.
- A clean review is the line `No findings.` followed by an `Examined:` line that names what you read, with file and line, so an empty report cannot pass for a clean one.
- A threat model opens with one line that names the trust boundary, then lists the threats in the same format. For a design with no code, cite the design document and a line of it in `Where:`; when the design exists only in the conversation, write it to a file next to the report and cite that, since `security-finding.ts` accepts only a real file and line.

## Scripts

Run `node scripts/<name>.ts` from the skill directory, or give the full path from elsewhere. None of them writes a file.

| When | Command | Exit codes |
|---|---|---|
| Before handing over a report | `node scripts/security-finding.ts [--root <checkout>] <report.md or ->` (add `--json` for a structured result) | `0` well formed. `1` a defect: each finding names the finding number and the fix, so correct the report and run again. `2` usage error. `3` the report or `--root` cannot be read. |
| A change touches dependencies, or the user asks for an audit | `node scripts/dep-audit.ts [--root <dir>] [--ecosystem npm\|pip] [--fail-on low\|moderate\|high\|critical] [--timeout <seconds>]` | `0` audited, nothing at or above `--fail-on`. `1` a vulnerable dependency. `2` usage error. `3` not audited. |
| Reviewing CI definitions for exposed secrets | `node scripts/check-secrets-exposure.ts --platform <github\|gitlab> <file-or-dir>` | `0` clean or nothing to scan. `1` a finding or a missing target. `2` usage error, including a missing `--platform`. |

`security-finding.ts` checks the shape of the report and that every `Where:` resolves to a real file and line. It does not check that your evidence occurs at that line, so read the line yourself.

`dep-audit.ts` runs `npm audit` for a lockfile and `pip-audit` for `requirements.txt`, found on `PATH`, so it queries a package registry over the network. It installs and builds nothing, runs no project code and writes no file of the project (the tools keep their own cache and logs), and it runs on POSIX hosts only. For pip it audits only the pins written in `requirements.txt` (`name==version`), not what they pull in, because the mode that resolves dependencies builds packages and runs project code. An advisory below `--fail-on` is a warning, one at or above is an error, and an advisory with no severity (every pip one) counts as at or above.

- **Exit `3`, an `unsupported-ecosystem` warning and a `nothing-to-audit` warning all mean the dependencies were NOT audited.** Say so in the report: a silent gap reads as a clean audit. Exit `3` covers a missing or unrunnable tool, no network, a timeout, a `package.json` with no lockfile, an unpinned requirement and output the script could not classify. The likeliest cause for pip is a requirement the tool skipped, such as a private package or a `name @ url` entry: the finding names it, the whole pip ecosystem then reads not-audited (cause `unrecognized-output`) even when the other pins were checked, and you audit that dependency by hand.
- Only npm and pip are covered. For `pnpm-lock.yaml`, `yarn.lock` (the warning names `yarn audit` for Yarn 1 and `yarn npm audit` for Yarn 2 and later), `go.mod`, `Cargo.lock`, `poetry.lock`, `pom.xml`, `Gemfile.lock` and `composer.lock` the warning names the native tool to run by hand.

`check-secrets-exposure.ts` is a text scan of one workflow or pipeline file, or a directory of them. The `github` profile looks for an echoed `secrets.*`, a workflow-level `env:` that references secrets, `set -x` and `toJSON(secrets)`; the `gitlab` profile looks for literal credentials and token shapes, echoed credential variables, `set -x` and `CI_DEBUG_TRACE`. It keeps its legacy exit codes, has no `--json` and no exit `3`. A clean result says no known pattern matched, not that no secret exists.

## Hand-offs

Applying a fix goes to `developer`: you find the issue and someone else closes it, which keeps the review honest. Hardening a pipeline goes to `github-actions` or `gitlab-ci`, and a design question to `architect`.

## Friction

See `references/shared-friction-reporting.md`.
