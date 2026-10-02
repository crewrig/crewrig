---
id: "0246"
slug: surface-missing-mempalace-registration
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1410
version: 2.0.0
---

# A missing MemPalace registration is announced at session start, never silent

Context. Two PLAN-stage corrections, both approved by the owner at the PLAN gate of
issue #1410 (logbook issuecomment-5948890888, rulings D3 and D6). The first
answers seat finding v3-F1 (issuecomment-5948822894): it narrows R4's
agreement obligation to strict JSON files and pins the check's parser. The
second answers seat finding v1-F4 (issuecomment-5948323219): it adds the
platform exception that ruling D3 set for R11. The bump is MAJOR. Both
modified requirements now forbid something that the 1.0.0 text required:
agreeing with `task mempalace:status` on files outside strict JSON (R4), and
registering on every platform (R11). They also invalidate the shared jq
filter that plan v3 built on the 1.0.0 R4. Seat pass 4 (PR #1459,
issuecomment-5949084611) led to two further changes.

- The `unrecognised` warning of R5 is split by cause, so a file that is not
  strict never points at a repair that does nothing (s4-F1);
- R4's strict definition is stated in bytes (s4-F2). Amendment A1, measured
  while verifying plan v4, adds a nesting limit and a surrogate rule to it.
- Seat pass 5 (issuecomment-5949256625) set the nesting limit at 64
  containers, required a top-level object, pinned how a strict file's entry
  is classified, and recorded the empty-file trade-off.

## ADDED

**Scenario:** A configuration file that is not strict JSON points at a rewrite, not at the repair

Given the daemon is installed and serving
And `~/.copilot/mcp-config.json` holds a correct HTTP `mempalace` entry, but also a second concatenated JSON document, a number written `NaN`, a leading UTF-8 byte order mark, containers nested deeper than 64 levels, or an unpaired surrogate escape
When a Copilot CLI session starts
Then the check classifies the file `unrecognised`
And its warning names `copilot` and the path `~/.copilot/mcp-config.json`, says the file is not a single strict JSON document, and says to rewrite it as one
And the warning names `task mempalace:switch-http` for the case where the registration still needs repair after the rewrite
And the warning does not name `task mempalace:repair`, which reports nothing to repair on most such files
And no agreement with the class `task mempalace:status` reports for that file is required

**Scenario:** A strict file with an unknown entry shape still points at the repair

Given the daemon is installed and serving
And `~/.gemini/settings.json` is strict JSON whose `mcpServers.mempalace` entry is a string
When a Gemini CLI session starts
Then the check classifies the file `unrecognised`
And its warning names `task mempalace:repair`, as requirement 5 sets for that case
And `task mempalace:status` reports Gemini CLI as `unknown`

**Scenario:** Setup on Windows registers no session check

Given a Windows machine where an earlier setup run left a session-check entry in Gemini CLI's user-level hook file
When `scripts/setup-gemini-interactive.sh` runs
Then it registers no session-check entry
And it removes the earlier entry, leaving every other hook entry and every non-hook key unchanged

## MODIFIED

Requirement 3: the class definitions are pinned to the mapping that
requirement 4 measures, so the two requirements read the same way. The
sentence that follows the quoted text, from "The four registration shapes
recorded in" to the end of requirement 3, is unchanged.

Original:

<!-- markdownlint-disable-next-line MD029 -->
> 3. **(Registration classes)** When the daemon is serving, the check SHALL
>    classify the CLI's user-level `mempalace` registration as exactly one of:
>    `ok` (an HTTP entry whose endpoint equals the expected endpoint);
>    `absent` (no `mempalace` entry, including a configuration file that does
>    not exist); `stdio` (an entry that launches a local process);
>    `wrong-endpoint` (an HTTP entry aimed at any other endpoint); and
>    `unrecognised` (a configuration file that does not parse, or an entry
>    matching neither the HTTP nor the stdio shape).

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 3. **(Registration classes)** When the daemon is serving, the check SHALL
>    classify the CLI's user-level `mempalace` registration as exactly one
>    of the classes below. "Strict" is defined in requirement 4.
>    - `ok`: in a strict file, an object entry that carries a `url` or a
>      `serverUrl` key whose value equals the expected endpoint.
>    - `wrong-endpoint`: in a strict file, an object entry that carries a
>      `url` or a `serverUrl` key whose value is anything else, a value
>      that is not a string included.
>    - `stdio`: in a strict file, an object entry that carries a `command`
>      key and neither `url` nor `serverUrl`.
>    - `absent`: no `mempalace` entry. That covers a configuration file
>      that does not exist, and, in a strict file, an `mcpServers` that is
>      missing, `null`, or not an object, or a `mempalace` entry that is
>      missing, `null`, or `false`.
>    - `unrecognised`: a configuration file that is not strict, or a strict
>      file whose entry is neither an object carrying `url`, `serverUrl`, or
>      `command` nor one of the `absent` cases.

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
>    bytes meet all of the following:
>    - they do not begin with the UTF-8 byte order mark `EF BB BF`;
>    - they are valid UTF-8 under a decoder that fails on invalid input
>      instead of substituting replacement characters, and that does not
>      strip a byte order mark;
>    - the decoded text is exactly one JSON value as RFC 8259 defines it,
>      with optional surrounding whitespace, and that value is a JSON object;
>    - containers (objects and arrays) are nested at most 64 levels deep.
>      Only containers count, the top-level object is level 1, and scalars
>      add no level. RFC 8259 section 9 lets a parser limit nesting depth.
>      `jq-1.7.1-apple` rejects objects nested beyond 128 levels and arrays
>      beyond 256. An assistant configuration is a handful of levels deep,
>      so 64 keeps a wide margin below every limit observed in a `jq`
>      binary that `task mempalace:status` may run;
>    - no string or member name contains an unpaired UTF-16 surrogate
>      escape. RFC 8259 section 8.2 calls the behaviour of such strings
>      unpredictable, and RFC 7493 section 2.1 forbids them. Their handling
>      also diverges between the two readers: `jq` rejects a lone high
>      surrogate and replaces a lone low one with U+FFFD, while the Node.js
>      parser keeps both.
>
>    Any other existing file is *not strict*. The check SHALL classify it
>    `unrecognised` and SHALL give it the warning that requirement 5 sets for
>    a file that is not strict. Examples of files that are not strict:
>    - an empty file, or a truncated one;
>    - several concatenated documents;
>    - number syntax that only `jq` accepts, such as `NaN`, `Infinity`, or a
>      leading zero;
>    - invalid UTF-8;
>    - a leading byte order mark. RFC 8259 section 8.1 forbids adding one to a
>      transmitted JSON text and lets a parser ignore one. This check chooses
>      not to ignore it, because no supported CLI writes one, and a visible
>      warning is the safer error;
>    - a top-level value that is not an object, such as `null`, `false`, an
>      array, or a scalar;
>    - containers nested deeper than 64 levels;
>    - an unpaired surrogate escape in a string or a member name.
>
>    In a strict file, the check SHALL locate the entry the way the reader of
>    `task mempalace:status` does today (`.mcpServers.mempalace // empty`,
>    measured on `main` under `jq-1.7.1-apple` and `jq-1.8.2`).
>    Requirement 3 states the class each case yields.
>
>    For every strict configuration file, the check's class SHALL agree with
>    the arrangement that `task mempalace:status` reports for the same file:
>    `ok` and `wrong-endpoint` with `http`, `stdio` with `stdio`, `absent`
>    with `none`, and `unrecognised` with `unknown`. For a file that is not
>    strict, how `task mempalace:status` classifies it is unchanged, and
>    agreement is not required. This narrower scope is deliberate:
>    - no supported CLI writes such files;
>    - a shared `jq` definition would add a `jq` runtime dependency to the
>      hook, contrary to the direction of spec 0215 R23;
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

Requirement 5: the `unrecognised` warning is split by cause (seat finding
s4-F1). `unrecognised` stays one class with two warning texts. That keeps
requirement 3's five classes and requirement 4's mapping intact.

Original:

> For `unrecognised`, the warning SHALL name `task mempalace:repair` instead.

Replacement:

> For `unrecognised`, the warning depends on the cause.
>
> - **Strict file, unknown entry shape.** When the file is strict
>   (requirement 4) but the entry matches neither the HTTP shape nor the
>   stdio shape, the warning SHALL name the CLI and
>   `task mempalace:repair`.
> - **File not strict.** When the file is not strict, the warning SHALL:
>   - name the CLI and the file's path;
>   - say that the file is not a single strict JSON document;
>   - tell the operator to rewrite it as one, for example by saving it
>     again without the byte order mark, or by merging the concatenated
>     documents;
>   - then name `task mempalace:switch-http` for the case where the
>     registration still needs repair after the rewrite.
>
>   An empty or truncated file also gets this text. This is an accepted
>   trade-off. The reader of `task mempalace:status` does report such a file
>   `unknown`, so `task mempalace:repair -- --restore-backup` could restore
>   it, but a single rule for every file that is not strict keeps the
>   warning correct in all cases. The warning SHALL say that restoring one
>   of the file's timestamped `.bak` backups is one way to rewrite it.
>
>   It SHALL NOT name `task mempalace:repair`, because that command selects
>   its targets with the reader of `task mempalace:status`. That reader
>   accepts many files that are not strict, and on most of them it reports
>   nothing to repair.

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
>     agreement test of requirement 4 runs over strict fixtures only,
>     including containers nested at exactly 64 levels and every entry case
>     that requirement 4 maps for a strict file; each kind of file that
>     requirement 4 lists as not strict, which the check classifies
>     `unrecognised` with requirement 5's not-strict warning text, with
>     assertions on that text, among them a leading byte order mark and
>     invalid UTF-8 asserted in the same run, containers nested at 65 levels,
>     a top-level value that is not an object, and an
>     unpaired surrogate escape in a value and in a member name; setup on a
>     platform other than macOS and
>     Linux, which registers no check and removes an earlier entry
>     (requirement 11); `absent` from a

The rest of requirement 16, from "missing configuration file, whose warning
names the CLI's setup script" to its end, is unchanged.

## REMOVED

None.
