---
id: "0246"
slug: surface-missing-mempalace-registration
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1410
version: 3.0.0
---

# A missing MemPalace registration is announced at session start, never silent

Context. These corrections come from the post-merge audit of delta-01 and
are recorded in ledger #961: findings s6-F1, s6-F2, s6-F3, s7-F1, and s7-F3.
The owner approved them at the plan-v4 gate of issue #1410 (ruling D7).
A later owner ruling, "Doc embarquée + amender R8", adds an evidence rule
for channels that cannot be probed live (R7), and the Antigravity throttle
key and channels that follow from it (R8). The
bump is MAJOR. Under delta-01, a working Gemini CLI configuration that holds
comments had to be classified `unrecognised`, and a strict file whose
`mcpServers` is not an object had to be classified `absent`. Both now
classify differently, so an implementation that conforms to 2.0.0 does not
conform to this delta.

## ADDED

**Scenario:** A working Gemini configuration with comments starts silently

Given the daemon is installed and serving
And `~/.gemini/settings.json` holds a `// team proxy` line comment, a `/* … */` block comment, and a correct HTTP `mempalace` entry whose `$schema` URL contains `//` inside a string
When a new Gemini CLI session starts
Then the check classifies the registration `ok` and emits nothing

**Scenario:** A Gemini configuration with comments and a missing entry points at the Gemini setup

Given the daemon is installed and serving
And `~/.gemini/settings.json` holds comments and no `mempalace` entry
When a new Gemini CLI session starts
Then the warning names `gemini`, the class `absent`, and `scripts/setup-gemini-interactive.sh`
And it says that this setup rewrites the file without its comments and keeps them in a timestamped backup
And it names neither `task mempalace:switch-http` nor `task mempalace:repair`, because both read the file with `jq`, which rejects comments

**Scenario:** A Gemini file with a trailing comma is not strict

Given `~/.gemini/settings.json` holds a trailing comma after its last member
When a Gemini CLI session starts
Then the check classifies the file `unrecognised` with the not-strict warning text of requirement 5

**Scenario:** A non-object `mcpServers` gets the rewrite advice, not `switch-http`

Given the daemon is installed and serving
And `~/.copilot/mcp-config.json` is `{"mcpServers": []}`
When a Copilot CLI session starts
Then the check classifies the file `unrecognised` with the not-strict warning text of requirement 5
And the warning does not name `task mempalace:switch-http`, whose pre-flight would refuse every CLI

**Scenario:** An entry carrying both `url` and `serverUrl` compares one value

Given the installed daemon's expected endpoint is `http://127.0.0.1:41893/mcp`
And Claude Code's entry carries `"url": "http://127.0.0.1:41893/mcp"` and `"serverUrl": "http://127.0.0.1:41000/mcp"`
When a Claude Code session starts
Then the check classifies the registration `ok`, because `url` is compared first

Out of scope (added):

- Making the reader of `task mempalace:status`, which `switch-http`, `repair`,
  and the daemon uninstall share, read comments in a Gemini CLI
  configuration file. It reports such a file `unknown`, as it does on `main`
  today.

## MODIFIED

Requirement 3 (cumulative text from delta-01): `ok` and `wrong-endpoint`
compare one value (s6-F1), and a non-object `mcpServers` leaves `absent`
(s6-F2). The two sentences that follow the class list, from "The four
registration shapes recorded in" to the end of requirement 3, are
unchanged.

Original:

> - `ok`: in a strict file, an object entry that carries a `url` or a
>   `serverUrl` key whose value equals the expected endpoint.
> - `wrong-endpoint`: in a strict file, an object entry that carries a
>   `url` or a `serverUrl` key whose value is anything else, a value
>   that is not a string included.
>
> […]
>
> - `absent`: no `mempalace` entry. That covers a configuration file
>   that does not exist, and, in a strict file, an `mcpServers` that is
>   missing, `null`, or not an object, or a `mempalace` entry that is
>   missing, `null`, or `false`.

Replacement:

> - `ok`: in a strict file, an object entry that carries a `url` or a
>   `serverUrl` key whose *compared value* equals the expected endpoint.
>   The compared value is the entry's `url` when that value is neither
>   `null` nor `false`, and its `serverUrl` otherwise. This is the order
>   `scripts/doctor-mempalace.sh` uses (`.url // .serverUrl`).
> - `wrong-endpoint`: in a strict file, an object entry that carries a
>   `url` or a `serverUrl` key whose compared value is anything else,
>   including a value that is not a string.
>
> […]
>
> - `absent`: no `mempalace` entry. That covers a configuration file
>   that does not exist and, in a strict file, an `mcpServers` that is
>   missing or `null`, or a `mempalace` entry that is missing, `null`, or
>   `false`. A non-null `mcpServers` that is not an object makes the file
>   not strict (requirement 4), so it is `unrecognised`.

Requirement 4 (cumulative text from delta-01), strict definition: comments
are removed from a Gemini CLI file before the strictness test (s7-F1), and
`mcpServers` must be an object or `null` (s6-F2).

Original:

> - the decoded text is exactly one JSON value as RFC 8259 defines it,
>   with optional surrounding whitespace, and that value is a JSON object;

Replacement:

> - the decoded text is exactly one JSON value as RFC 8259 defines it,
>   with optional surrounding whitespace, and that value is a JSON object
>   whose `mcpServers` member, when present, is an object or `null`;
> - for Gemini CLI only, the two byte conditions above apply to the file
>   as stored, and every other condition applies to the decoded text
>   *after comment removal*. Gemini CLI reads `~/.gemini/settings.json`
>   that way (spec 0214 R12, whose reference behaviour is
>   `JSON.parse(stripJsonComments(...))`):
>   - comment removal deletes `//` line comments and `/* … */` block
>     comments that sit outside a string literal;
>   - it replaces each comment with whitespace;
>   - a block comment that is never closed runs to the end of the text;
>   - the content of strings is never changed;
>   - trailing commas are not removed. Gemini CLI does not remove them
>     either, so a file with a trailing comma is not strict.

Requirement 4, the list of files that are not strict: two examples are
added.

Original:

> - a top-level value that is not an object, such as `null`, `false`, an
>   array, or a scalar;

Replacement:

> - a top-level value that is not an object, such as `null`, `false`, an
>   array, or a scalar;
> - an `mcpServers` member that is neither an object nor `null`;
> - a trailing comma, in a Gemini CLI file as in any other;

Requirement 4, agreement scope: a Gemini CLI file that holds comments is
excluded (s7-F1), and one attribution is corrected (s7-F3).

Original:

> For every strict configuration file, the check's class SHALL agree with
> the arrangement that `task mempalace:status` reports for the same file:
> `ok` and `wrong-endpoint` with `http`, `stdio` with `stdio`, `absent`
> with `none`, and `unrecognised` with `unknown`. For a file that is not
> strict, how `task mempalace:status` classifies it is unchanged, and
> agreement is not required. This narrower scope is deliberate:

Replacement:

> For every strict configuration file that holds no comment, the check's
> class SHALL agree with the arrangement that `task mempalace:status`
> reports for the same file: `ok` and `wrong-endpoint` with `http`,
> `stdio` with `stdio`, `absent` with `none`, and `unrecognised` with
> `unknown`. For a file that is not strict, and for a Gemini CLI file that
> holds comments, how `task mempalace:status` classifies the file is
> unchanged, and agreement is not required. The reader of
> `task mempalace:status` rejects comments and reports such a Gemini file
> `unknown`. Making that reader accept comments would refactor the core
> reader that `switch-http`, `repair`, and the daemon uninstall share,
> which is the reason given below. Gemini CLI setup also rewrites the file
> as plain JSON on every run (spec 0214), so comments appear only after a
> hand edit or a restored backup. This narrower scope is deliberate:

Original:

> - and agreement "by construction" through `jq` was measured to break
>   across `jq` binaries and through `~/.jq` (seat finding v3-F3).

Replacement:

> - and agreement "by construction" through `jq` was measured during PLAN
>   to break across `jq` binaries and through `~/.jq`.

Requirement 5 (cumulative text from delta-01): the not-strict rewrite
advice covers a non-object `mcpServers` (s6-F2), and a Gemini CLI file that
holds comments points at the Gemini setup (s7-F1).

Original:

> - tell the operator to rewrite it as one, for example by saving it
>   again without the byte order mark, or by merging the concatenated
>   documents;

Replacement:

> - tell the operator to rewrite it as one, for example by saving it
>   again without the byte order mark, by merging the concatenated
>   documents, or by making `mcpServers` an object;

Original:

> It SHALL NOT name `task mempalace:repair`, because that command selects
> its targets with the reader of `task mempalace:status`. That reader
> accepts many files that are not strict, and on most of them it reports
> nothing to repair.

Replacement:

> It SHALL NOT name `task mempalace:repair`, because that command selects
> its targets with the reader of `task mempalace:status`. That reader
> accepts many files that are not strict, and on most of them it reports
> nothing to repair.
>
> - **Gemini CLI file that holds comments.** Some Gemini CLI files are
>   strict after comment removal (requirement 4), hold comments, and are
>   classified anything other than `ok`. For such a file, the warning SHALL
>   name `scripts/setup-gemini-interactive.sh` in place of
>   `task mempalace:switch-http` or `task mempalace:repair`. It SHALL say
>   that this setup rewrites the file without its comments and keeps them
>   in a timestamped backup (spec 0214 R12). Both `task` commands read the
>   file with `jq`, which rejects comments. `switch-http` would therefore
>   refuse, because its pre-flight reads the file as `unknown`, and
>   `repair` could not write it.

Requirement 7 (parent text): an evidence rule is added for channels that
cannot be probed live (owner ruling at the PLAN stage of #1410, "Doc
embarquée + amender R8"; evidence in #1410 issuecomment-5950885519).

Original:

> CLI offers neither channel on any event the check could use, that CLI
> SHALL be recorded as an evidenced gap and SHALL be covered by
> requirement 13 alone.

Replacement:

> CLI offers neither channel on any event the check could use, that CLI
> SHALL be recorded as an evidenced gap and SHALL be covered by
> requirement 13 alone.
>
> **Evidence when no live probe is possible.** Sometimes a live probe
> cannot run because no eligible account is available for the CLI. In that
> case, the vendor documentation shipped inside the installed CLI version
> SHALL be accepted as the evidence for the hook payload fields, the
> output channels, and the timeout unit. `docs/cli-matrix.md` SHALL record
> three things: the CLI's name and version, the verbatim documentation
> excerpt, and the fact that no live probe ran. A follow-up issue, linked
> from #1410, SHALL track the live confirmation. This rule covers every
> CLI and every channel that cannot be probed live, for example Gemini
> CLI's model channel. The account that was tried there is rejected with
> `IneligibleTierError`, while its user channel `systemMessage` was
> verified live.
>
> When that shipped documentation describes the complete output schema of
> an event and no field in it reaches the user, the schema SHALL count as
> evidence that the user channel is absent. That is narrower than "the
> reference does not mention it", which
> `docs/cli-matrix-maintenance.md` → *Gap-acceptance evidence rule*
> rejects. The live follow-up issue SHALL re-test that absence.

Requirement 8 (parent text), Antigravity CLI: the throttle key and the
channels rest on the documentation shipped in `agy` (same ruling). The
owner has no Antigravity account, so no live probe is possible.

Original:

> - **Throttle key.** The recorded evidence shows the `PreInvocation`
>   payload carrying `invocationNum` and `initialNumSteps` (spec 0116
>   delta-03, item 3), and `conversationId` only on `Stop` (row 8,
>   Exercise B). The DEV stage SHALL establish, by a live `agy` probe
>   recorded in `docs/cli-matrix.md`, whether `PreInvocation` carries a
>   conversation identifier. If it does, the check SHALL read configuration
>   and probe the daemon at most once per conversation, keyed by that
>   identifier. If it does not, the check SHALL read configuration and probe
>   at most once per 30-minute window per user. The window is long enough
>   that one working conversation is not warned at every model call. It is
>   short enough that a session opened later the same half-day is checked
>   again. Each conversation's agent is still covered by requirement 13.

Replacement:

> - **Throttle key.** The hooks documentation shipped in `agy` 1.2.14
>   states that "Every hook payload sent to `stdin` includes these common
>   system metadata fields: `conversationId`, `workspacePaths`,
>   `transcriptPath`, `artifactDirectoryPath`, `modelName`." Under
>   requirement 7's evidence rule, the check SHALL read configuration and
>   probe the daemon at most once per conversation, keyed by the
>   `conversationId` of the `PreInvocation` payload. A payload that lacks a
>   usable `conversationId` at run time SHALL fall back to at most one
>   check per 30-minute window per user. The window is long enough that one
>   working conversation is not warned at every model call. It is short
>   enough that a session opened later the same half-day is checked again.
>   Each conversation's agent is still covered by requirement 13.
> - **Channels.** The model channel SHALL be the documented `PreInvocation`
>   output `{"injectSteps":[{"ephemeralMessage":"…"}]}`, which the shipped
>   documentation describes as a "transient system message". The
>   documented `PreInvocation` output carries no field that reaches the
>   user. Under requirement 7, the user channel SHALL therefore be recorded
>   in `docs/cli-matrix.md` as an evidenced gap.
> - **Timeout and interpreter.** The hook's `timeout` SHALL be written in
>   seconds. The shipped documentation says: "`timeout` (int, optional):
>   Execution timeout in seconds. Defaults to `30`." The command SHALL be
>   written for `sh -c`, which runs hook commands on Unix.
> - **Evidence record.** `docs/cli-matrix.md` SHALL record the `agy`
>   version, the verbatim excerpts quoted above, and the fact that no live
>   probe ran. The live confirmation SHALL be a follow-up issue linked from
>   #1410.

The cost-bound bullet of requirement 8 is unchanged. The 150 ms 95th
percentile of the suppressed path SHALL still be measured locally, which
needs no account. In requirement 8's fallback bullet, "offers no channel to
the user or the model" is now decided by the evidence above: the model
channel exists, so only a measured cost above the bound triggers the
fallback.

Requirement 16 (cumulative text from delta-01): the coverage list adds the
cases of this delta.

Original:

> a top-level value that is not an object, and an
> unpaired surrogate escape in a value and in a member name; setup on a

Replacement:

> a top-level value that is not an object, an `mcpServers` that is
> neither an object nor `null`, a Gemini CLI file with a trailing comma,
> and an unpaired surrogate escape in a value and in a member name; a
> Gemini CLI file holding a line comment, a block comment, a never-closed
> block comment, and `//` and `/*` inside strings, classified on its
> content after comment removal and, when not `ok`, warned with the Gemini
> setup text of requirement 5; an entry carrying both `url` and
> `serverUrl` with different values, in both orders of correctness; setup
> on a

Delta-01 context paragraph (not normative): the attributions are corrected
(s6-F3, s7-F3). Seat passes 4 and 5 of `specs/1410` and pass 3 of
`plan/1410` were voided (#1410 issuecomment-5950406691), so their findings
are not cited as seat findings. The orchestrator chose the 64-level limit.

Original:

> The first answers seat finding v3-F1 (issuecomment-5948822894): it
> narrows R4's agreement obligation to strict JSON files and pins the
> check's parser.
>
> […] Seat pass 4 (PR #1459, issuecomment-5949084611) led to two further
> changes.
>
> - The `unrecognised` warning of R5 is split by cause, so a file that is
>   not strict never points at a repair that does nothing (s4-F1);
> - R4's strict definition is stated in bytes (s4-F2). […]
> - Seat pass 5 (issuecomment-5949256625) set the nesting limit at 64
>   containers, required a top-level object, pinned how a strict file's
>   entry is classified, and recorded the empty-file trade-off.

Replacement:

> The first narrows R4's agreement obligation to strict JSON files and pins
> the check's parser. The disagreement between `jq` readers that motivates
> it was measured during PLAN.
>
> […] Further changes followed during review, each measured during PLAN
> and approved again at the owner gate.
>
> - The `unrecognised` warning of R5 is split by cause, so a file that is
>   not strict never points at a repair that does nothing;
> - R4's strict definition is stated in bytes. […]
> - The orchestrator set the nesting limit at 64 containers. The delta
>   also requires a top-level object, pins how a strict file's entry is
>   classified, and records the empty-file trade-off.

The lead line of delta-01's requirement 5 block, "(seat finding s4-F1)",
reads "(measured during PLAN)".

## REMOVED

None.
