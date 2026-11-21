---
id: "0314"
slug: org-template-launcher-pin-init
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 2101
version: 1.1.0
---

# Organization template, launcher contract, pin file and `crewrig init` scaffold (WP3 of epic 1822)

Resolves findings s5-F1, s5-F2, s5-F3, s5-F4, s5-F5, s5-F8 and s5-F9 of the
cold review of PR 2103. Each MODIFIED item quotes the original text, then gives
the full replacement. Everything not named here stays as in version 1.0.0.

## ADDED

**R20 (a failed `init` leaves nothing behind).** When `init` fails after it began writing (a write error, a full disk, a permission error), it SHALL remove every file and directory that it created in that run, leave every entry that existed before the run untouched, and exit with code 1 (R10 reserves codes 10 to 14 for the launcher). `crewrig.config.toml` SHALL be the last item written (R15), so that a failed run never leaves the file that the refusal of R14 reads, and a rerun after such a failure SHALL be accepted as a first run.

Scenario added.

**Scenario:** A write failure midway leaves nothing, and a rerun succeeds

```text
Given a cached pinned version, a fresh template copy, and a scaffold path of R15 that cannot be written
When  the author runs `node crewrig init --feedback-repo https://github.com/acme/cfg`
Then  it exits with code 1, every file and directory created in that run is removed, the directory again holds only the template files, and once the obstacle is removed a second run of the same command exits with code 0 and creates the scaffold of R15.
```

Scenario added.

**Scenario:** A feedback repository that is not of repository shape is refused

```text
Given a cached pinned version and a fresh template copy
When  the author runs `node crewrig init --feedback-repo <value>` with each of `https://github.com`, `https://github.com/acme`, `https://github.com/acme/cfg/sub` and `http://github.com/acme/cfg`
Then  each run exits with code 2 and nothing is written, so the value written under feedback_repo is always of the shape that the build accepts for canonical_repo.
```

Scenario added.

**Scenario:** A relative redirect is a download failure

```text
Given a valid pin and a local server that answers the asset URL with a 302 whose Location is the relative reference /elsewhere/crewrig.tgz
When  the user runs `node crewrig init`
Then  the launcher exits with code 12, follows no redirect, and caches and executes nothing.
```

## MODIFIED

### s5-F8: R8, redirect bullet

Original line:

```text
    - follow at most 5 redirects (status 301, 302, 303, 307, 308) to a plain URL on any host, since integrity rests on the digest and not on the transport (GitHub Releases answers the default URL with a redirect); any other redirect target, or a sixth redirect, is a download failure;
```

Replacement:

```text
    - follow at most 5 redirects (status 301, 302, 303, 307, 308) to an absolute plain URL on any host, since integrity rests on the digest and not on the transport (GitHub Releases answers the default URL with a redirect); any other redirect target, a sixth redirect, and a `Location` that is not an absolute plain URL (a relative reference such as `/path` or `//host/path`, deliberately not resolved against the request URL) are a download failure, code 12;
```

### s5-F1, s5-F2, s5-F4, s5-F9: R14

Original paragraph, from its second sentence on (the first two sentences, up to "When neither case holds, `init` SHALL proceed.", are unchanged):

```text
An unknown option, a missing option value, or a `--feedback-repo` value that is not a plain URL SHALL exit with code 2 and write nothing. When `--feedback-repo` is absent, `init` SHALL obtain the value by running `git remote get-url origin` in the working directory, with git invoked directly and without a shell; an output of exactly the scp-style form `git@github.com:<owner>/<repo>`, with an optional `.git` suffix, SHALL first be converted to `https://github.com/<owner>/<repo>`; the result, or the output itself, SHALL be used when it is a plain URL and does not designate `canonical_repo`, a value designating it when, after removing one `.git` suffix and one trailing `/`, it equals `https://github.com/crewrig/crewrig` with the host compared case-insensitively. `init` SHALL treat as absent any other outcome: no repository, no `origin`, git not installed, a failing command, a value that is not a plain URL (any other scp-style form, such as `git@gitlab.com:org/repo`, or one holding credentials), or a value designating `canonical_repo`. An explicit `--feedback-repo` equal to `canonical_repo` stays accepted, a conscious choice. When the value is absent it SHALL refuse with code 2 and a message asking for `--feedback-repo <url>`, writing nothing. The reason is that friction reports on organization components must never open issues on the public upstream repository by default.
```

Replacement:

```text
An unknown option, a missing option value, or a `--feedback-repo` value that is not a repository URL SHALL exit with code 2 and write nothing. A **repository URL** is a plain URL with scheme `https:`, no query string, no fragment, and a path of exactly two non-empty segments, that is `https://<host>/<owner>/<repo>` with no deeper path: the shape that the build requires of `canonical_repo` (`validateCanonicalRepo`), so a bare host, a deeper path and the scheme `http:` are refused. **Normalisation** is applied to a value in this order: first, for the output of `git remote get-url` only, one trailing line feed (LF or CRLF) is removed; then one trailing `/` is removed; then one `.git` suffix is removed (so `https://github.com/acme/cfg.git/` becomes `https://github.com/acme/cfg`); a line feed inside an explicit `--feedback-repo` value is a control character and makes it a non-plain URL. The normalised value, not the raw one, is checked against every rule below and is the value that R16 writes. When `--feedback-repo` is absent, `init` SHALL obtain the value by running `git remote get-url origin` in the working directory, with git invoked directly and without a shell, and normalise the output; a normalised output of exactly the scp-style form `git@github.com:<owner>/<repo>`, where neither `<owner>` nor `<repo>` is empty or holds a `/`, SHALL be converted to `https://github.com/<owner>/<repo>`, whereas `git@github.com:<owner>/<repo>` with a `/` in `<repo>` (`git@github.com:acme/team/cfg`) is refused and treated as absent; the result, or the normalised output itself, SHALL be used when it is a repository URL and does not designate `canonical_repo`. A value **designates** `canonical_repo` when, after normalisation, its scheme is `http` or `https`, its host is `github.com` or `www.github.com` (compared case-insensitively), and its path is `/crewrig/crewrig` (compared case-insensitively). `init` SHALL treat as absent any other outcome: no repository, no `origin`, git not installed, a failing command, a value that is not a repository URL (any other scp-style form, such as `git@gitlab.com:org/repo`, a value holding credentials, a bare host, a deeper path, the scheme `http:`), or a value designating `canonical_repo`. An explicit `--feedback-repo` that is a repository URL and designates `canonical_repo` stays accepted, a conscious choice. When the value is absent it SHALL refuse with code 2 and a message asking for `--feedback-repo <url>`, writing nothing. The reason is that friction reports on organization components must never open issues on the public upstream repository by default. A failure of `init` after it began writing is governed by R20.
```

### s5-F3, s5-F4: R16

Original clause:

```text
`feedback_repo`, the repository that receives feedback on organization-owned components, written as the value obtained under R14 (`--feedback-repo`, else the `origin` remote) with one `.git` suffix and one trailing `/` removed, the same normalisation for both sources, and never defaulted to `canonical_repo`.
```

Replacement:

```text
`feedback_repo`, the repository that receives feedback on organization-owned components, written as the normalised value obtained under R14 (`--feedback-repo`, else the `origin` remote; normalised in the order R14 states, the same for both sources, the line feed step applying to the `origin` output only), which is always a repository URL of the shape `https://<host>/<owner>/<repo>`, and never defaulted to `canonical_repo`.
```

Original sentence (last of R16):

```text
Because a plain URL holds no `"`, `\` or control character, the value is written as a TOML basic string without escaping, and the two-key invariant holds for every accepted input.
```

Replacement:

```text
Because a plain URL holds no `"`, `\` or control character, the value is written as a TOML basic string without escaping, and the two-key invariant holds for every accepted input. Every line of the file, the last included, SHALL end with a line feed, because the build's reader drops a last line that no line feed terminates (`terminatedLines` in `scripts/lib/build-components/config.ts`): an unterminated `feedback_repo` line would be silently lost.
```

### s5-F9: R15, lead-in

Original line:

```text
A successful `init` SHALL create exactly the following and nothing else, each otherwise-empty directory holding a zero-length `.gitkeep`:
```

Replacement:

```text
A successful `init` SHALL create exactly the following and nothing else, each otherwise-empty directory holding a zero-length `.gitkeep`, with `crewrig.config.toml` written last, after every other item, and a failure governed by R20:
```

### s5-F4: R13, test clause

Original clause:

```text
`node crewrig init --feedback-repo <plain URL>` run in a copy of the template
```

Replacement:

```text
`node crewrig init --feedback-repo <repository URL>` (R14) run in a copy of the template
```

### s5-F4, s5-F2: R18, surface 2 item

Original clause:

```text
command `init` with option `--feedback-repo` and its fallback to the `origin` remote (a plain URL, or `git@github.com:<owner>/<repo>` converted to https, never one designating `canonical_repo`), refused with code 2 when neither yields a usable value;
```

Replacement:

```text
command `init` with option `--feedback-repo` and its fallback to the `origin` remote (a repository URL `https://<host>/<owner>/<repo>`, or `git@github.com:<owner>/<repo>` converted to https, never one designating `canonical_repo`, that is `http` or `https`, host `github.com` or `www.github.com`, path `/crewrig/crewrig`, case-insensitively), refused with code 2 when neither yields a usable value; the normalisation order of R14; and the exit code 1 of a failed `init`, which leaves nothing behind (R20);
```

### s5-F2, s5-F4, s5-F5, s5-F9, s5-F3, s5-F8: R19

R19 is edited in four clauses; the rest is unchanged.

Original clause 1:

```text
`init` in a fresh template copy, checked as a full directory listing (R15, nothing else created, nothing written outside the working directory and `~/.crewrig/versions/`);
```

Replacement 1:

```text
`init` in a fresh template copy, checked as a full directory listing (R15, nothing else created, nothing written outside the working directory and `~/.crewrig/versions/`) and with `crewrig.config.toml` read as bytes, asserting that every line of it, the last included, ends with a line feed and that the build's reader finds both keys; `init` with a write failure midway (a scaffold path made unwritable), exit 1, every file and directory created in that run removed, followed by a clean rerun that exits 0 (R20);
```

Original clause 2:

```text
`init` with an `origin` that is a plain URL, with no repository, with no origin, with an origin holding credentials, with an origin designating `canonical_repo` (`https://github.com/crewrig/crewrig`, with `.git`, with a trailing `/`, with `HTTPS://GitHub.com/crewrig/crewrig`), with an origin `git@github.com:acme/cfg.git` (converted, written as `https://github.com/acme/cfg`) and with an origin `git@gitlab.com:acme/cfg.git` (refused), an explicit `--feedback-repo` equal to `canonical_repo` (accepted), and an explicit `--feedback-repo https://github.com/acme/cfg.git/` (written without `.git` and `/`); every refusal exits 2 with nothing written;
```

Replacement 2:

```text
`init` with an `origin` that is a repository URL, with no repository, with no origin, with an origin holding credentials, with an origin designating `canonical_repo` (`https://github.com/crewrig/crewrig`, with `.git`, with a trailing `/`, with `.git/`, with `HTTPS://GitHub.com/crewrig/crewrig`, `http://github.com/crewrig/crewrig`, `https://www.github.com/CrewRig/CrewRig`), with an origin `git@github.com:acme/cfg.git` (converted, written as `https://github.com/acme/cfg`), with an origin `git@github.com:acme/team/cfg.git` (refused, `<repo>` holds a `/`), with an origin `git@gitlab.com:acme/cfg.git` (refused), with an origin that is a bare host (`https://github.com`) or has a deeper path (`https://github.com/acme/cfg/sub`) (each refused), and with an origin whose `git remote get-url` output ends with a line feed or a CRLF (written without it), an explicit `--feedback-repo` equal to `canonical_repo` (accepted), an explicit `--feedback-repo https://github.com/acme/cfg.git/` (written as `https://github.com/acme/cfg`), and an explicit `--feedback-repo` that is a bare host, has a deeper path, or uses `http:` (each refused); every refusal of an origin or of an option exits 2 with nothing written, whereas the refusals for an existing `crewrig.config.toml` and for a non-empty directory exit 1 with nothing written, changed or deleted;
```

Original clause 3:

```text
a redirecting server, a server answering 302 forever, a body over the size cap and a stalled server, each code 12 (R8);
```

Replacement 3:

```text
a redirecting server, a server answering 302 forever, a server answering 302 with a relative `Location`, a body over the size cap and a stalled server, each code 12 (R8);
```

Original clause 4 (the rejected-input table, its first words):

```text
Rejected-input table, each refused with code 11 or 2 as R3, R8 and R14 state, and its value absent from output:
```

Replacement 4:

```text
Rejected-input table, each refused with code 11 or 2 as R3, R8 and R14 state (a `--feedback-repo` value that is a plain URL but not a repository URL, such as `https://h`, `https://h/a` or `https://h/a/b/c`, is refused with code 2 by R14 and is covered by the clause above), and its value absent from output:
```

### s5-F1, s5-F2, s5-F5: scenario "init converts a GitHub scp-style origin and refuses the upstream one"

Original scenario:

```text
Given a cached pinned version, a fresh template copy, and a git repository whose `origin` is first `git@github.com:acme/cfg.git`, then `https://GitHub.com/crewrig/crewrig.git/`, then `git@gitlab.com:acme/cfg.git`
When  the author runs `node crewrig init` each time, on a fresh copy
Then  the first run writes feedback_repo = https://github.com/acme/cfg; the second exits with code 2 asking for --feedback-repo, because the origin designates the upstream repository; the third exits with code 2; the last two write nothing.
```

Replacement:

```text
Given a cached pinned version, a fresh template copy, and a git repository whose `origin` is in turn `git@github.com:acme/cfg.git`, `https://github.com/acme/cfg.git/`, `https://GitHub.com/crewrig/crewrig.git/`, `http://github.com/crewrig/crewrig`, `https://www.github.com/CrewRig/CrewRig`, `git@github.com:acme/team/cfg.git`, and `git@gitlab.com:acme/cfg.git`
When  the author runs `node crewrig init` each time, on a fresh copy
Then  the first run writes feedback_repo = https://github.com/acme/cfg; the second writes feedback_repo = https://github.com/acme/cfg, the normalisation having removed the `/` and then the `.git`; the third, fourth and fifth exit with code 2 asking for --feedback-repo, because each origin designates the upstream repository; the sixth and seventh exit with code 2; every run that exits with code 2 writes nothing.
```

### s5-F5: scenario "A credential in a URL is refused and never printed"

Original scenario:

```text
Given CREWRIG_RELEASE_BASE_URL is "https://user:secret@mirror.example/r"
When  any command is run
Then  the launcher exits with code 11 naming the variable, makes no request, and the output holds neither "user" nor "secret".
```

Replacement:

```text
Given an empty cache and CREWRIG_RELEASE_BASE_URL set to "https://user:secret@mirror.example/r"
When  any command is run
Then  the launcher exits with code 11 naming the variable, makes no request, and the output holds neither "user" nor "secret"; with a complete cache for the pin instead, the command runs from the cache with no request (R7), the variable being read only when a download is needed.
```

## REMOVED

(none)
