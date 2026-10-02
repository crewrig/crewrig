---
id: "0246"
slug: surface-missing-mempalace-registration
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1410
version: 2.0.0
---

# A missing MemPalace registration is announced at session start, never silent

*Two PLAN-stage corrections, both approved by the owner at the PLAN gate of
issue #1410 (logbook issuecomment-5948890888, rulings D3 and D6). The first
answers seat finding v3-F1 (issuecomment-5948822894): it narrows R4's
agreement obligation to strict JSON files and pins the check's parser. The
second answers seat finding v1-F4 (issuecomment-5948323219): it adds the
platform exception that ruling D3 set for R11. The bump is MAJOR. Both
modified requirements now forbid something that the 1.0.0 text required:
agreeing with `task mempalace:status` on files outside strict JSON (R4), and
registering on every platform (R11). They also invalidate the shared jq
filter that plan v3 built on the 1.0.0 R4.*

## ADDED

**Scenario:** A configuration file that is not strict JSON is reported as unrecognised

Given the daemon is installed and serving
And `~/.copilot/mcp-config.json` holds two concatenated JSON documents, or a number written `NaN`, or a leading UTF-8 byte order mark
When a Copilot CLI session starts
Then the check classifies the file `unrecognised`
And its warning names `copilot`, says the file is not a single strict JSON document, and names `task mempalace:repair`
And no agreement with the class `task mempalace:status` reports for that file is required

**Scenario:** Setup on Windows registers no session check

Given a Windows machine where an earlier setup run left a session-check entry in Gemini CLI's user-level hook file
When `scripts/setup-gemini-interactive.sh` runs
Then it registers no session-check entry
And it removes the earlier entry, leaving every other hook entry and every non-hook key unchanged

## MODIFIED

Requirement 4: its agreement obligation is narrowed to files that hold one
strict JSON document, and the check's parser is pinned.

Original:

<!-- markdownlint-disable-next-line MD029 -->
> 4. **(Agreement with `task mempalace:status`)** For every configuration file
>    that exists, the check's class SHALL agree with the arrangement that
>    `task mempalace:status` reports for the same file: `ok` and
>    `wrong-endpoint` with `http`, `stdio` with `stdio`, `absent` with `none`,
>    and `unrecognised` with `unknown`. `task mempalace:status` SHALL report a
>    `wrong-endpoint` registration on a line distinct from a correct HTTP one,
>    naming the registered endpoint and the expected endpoint and nothing else
>    from the entry. The expected endpoint `task mempalace:status` compares
>    against SHALL be the requirement 1 endpoint, read from the same source
>    (the installed launcher), never from environment variables or hard-coded
>    defaults, so the two readers agree on `wrong-endpoint` on a machine
>    installed with a non-default port. The agreement SHALL be guaranteed
>    either by one shared definition or by an automated test that runs both
>    readers over the same fixtures.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 4. **(Agreement with `task mempalace:status`)** The check SHALL parse each
>    configuration file with the JSON parser of the Node.js standard library,
>    and SHALL NOT spawn `jq` or any other external parser. That follows the
>    direction of spec 0215 R23. A configuration file is *strict* when its
>    bytes decode as UTF-8 and the whole text is exactly one JSON value as
>    RFC 8259 defines it, with optional surrounding whitespace. Any other
>    existing file SHALL be classified `unrecognised`, and its warning SHALL
>    say that the file is not a single strict JSON document. Examples of
>    files that are not strict:
>    - an empty file, or a truncated one;
>    - several concatenated documents;
>    - number syntax that only `jq` accepts, such as `NaN`, `Infinity`, or a
>      leading zero;
>    - invalid UTF-8;
>    - a leading byte order mark. RFC 8259 section 8.1 forbids producing one,
>      the standard-library parser rejects one, and no supported CLI writes
>      one. A file carrying a byte order mark is therefore classified
>      `unrecognised`, which errs toward a visible warning.
>
>    For every strict configuration file, the check's class SHALL agree with
>    the arrangement that `task mempalace:status` reports for the same file:
>    `ok` and `wrong-endpoint` with `http`, `stdio` with `stdio`, `absent`
>    with `none`, and `unrecognised` with `unknown`. For a file that is not
>    strict, how `task mempalace:status` classifies it is unchanged, and
>    agreement is not required. This narrower scope is deliberate:
>    - no supported CLI writes such files;
>    - a shared `jq` definition would add a `jq` runtime dependency to the
>      hook, against spec 0215 R23;
>    - it would also force a refactor of the core reader that
>      `task mempalace:switch-http`, `task mempalace:repair`, and the daemon
>      uninstall share;
>    - and agreement "by construction" through `jq` was measured to break
>      across `jq` binaries and through `~/.jq` (seat finding v3-F3).
>
>    `task mempalace:status` SHALL report a `wrong-endpoint` registration on
>    a line distinct from a correct HTTP one, naming the registered endpoint
>    and the expected endpoint and nothing else from the entry. The expected
>    endpoint `task mempalace:status` compares against SHALL be the
>    requirement 1 endpoint, read from the same source (the installed
>    launcher), never from environment variables or hard-coded defaults. That
>    way the two readers agree on `wrong-endpoint` on a machine installed
>    with a non-default port. The agreement SHALL be guaranteed either by one
>    shared definition or by an automated test that runs both readers over
>    the same strict fixtures.

Requirement 11: a platform exception is added (ruling D3).

Original:

<!-- markdownlint-disable-next-line MD029 -->
> 11. **(Installed by default)** Every run of
>     `scripts/setup-{claude,gemini,copilot,antigravity}-interactive.sh` SHALL
>     register the check in that CLI's user-level hook configuration without
>     asking, with one exception. On Antigravity CLI it SHALL register the
>     check only while requirement 8's evidence conditions hold. When
>     requirement 8's fallback applies, the Antigravity setup SHALL NOT register
>     the check, and SHALL remove any check entry an earlier run registered.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 11. **(Installed by default)** Every run of
>     `scripts/setup-{claude,gemini,copilot,antigravity}-interactive.sh` SHALL
>     register the check in that CLI's user-level hook configuration without
>     asking, with two exceptions.
>     - **Platform.** On a platform other than macOS and Linux, setup SHALL
>       NOT register the check on any CLI, and SHALL remove any check entry an
>       earlier run registered. Requirement 6 already makes the check silent
>       where no supported daemon supervisor exists. On Windows the CLIs run
>       hook commands under PowerShell 5.1 (Gemini CLI, Copilot CLI) or
>       `cmd.exe` (Antigravity CLI) (`docs/cli-matrix.md` row 37). A POSIX
>       hook command would fail at every session start there, against
>       requirement 9.
>     - **Antigravity.** On Antigravity CLI, setup SHALL register the check
>       only while requirement 8's evidence conditions hold. When requirement
>       8's fallback applies, the Antigravity setup SHALL NOT register the
>       check, and SHALL remove any check entry an earlier run registered.

The rest of requirement 11, from "Registration SHALL NOT depend on the
session-recording opt-in" to its end, is unchanged.

Requirement 16: the coverage list adds the strict and non-strict corpus and
the platform exception.

Original:

<!-- markdownlint-disable-next-line MD029 -->
> 16. **(Hermetic tests)** The DEV stage SHALL add automated tests that run
>     against a fixture home directory and a fake loopback endpoint on an
>     ephemeral port. The tests SHALL NOT contact the live daemon on
>     `127.0.0.1:41893`. They SHALL cover, at minimum: every class of
>     requirement 3 for each of the four registration shapes; `absent` from a

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 16. **(Hermetic tests)** The DEV stage SHALL add automated tests that run
>     against a fixture home directory and a fake loopback endpoint on an
>     ephemeral port. The tests SHALL NOT contact the live daemon on
>     `127.0.0.1:41893`. They SHALL cover, at minimum: every class of
>     requirement 3 for each of the four registration shapes, where the
>     agreement test of requirement 4 runs over strict fixtures only; each
>     kind of file that requirement 4 lists as not strict, which the check
>     classifies `unrecognised`; setup on a platform other than macOS and
>     Linux, which registers no check and removes an earlier entry
>     (requirement 11); `absent` from a

The rest of requirement 16, from "missing configuration file, whose warning
names the CLI's setup script" to its end, is unchanged.

## REMOVED

None.
