# ADR 0013 — User-space system-context store

<!-- crewrig-doc: section=architecture-adr nav_order=130 published=true title="ADR 0013 — User-space system-context store" -->

**Status:** Accepted (issue #503; realizes [spec 0068](../../specs/0068-user-space-context-retrieval.md))

## Context

The home-installed layered context keeps growing. `artifacts/core/rules/60-tools.md`
alone was ~30 KB, deployed verbatim to all four CLI homes by every
`setup-*-interactive.sh` script. Some CLIs truncate large context files
(Antigravity CLI concatenates the numbered-priority files into a single system
context with a byte ceiling), so an ever-larger `60-tools.md` risks silently
dropping rules. Spec 0068 requires that the home-installed set stay small enough
for every CLI to load in full, that any rule moved out remain reliably reachable
on demand, that the everyday path need no running service, and that the failure
mode always be an explicit signal — never a silently missing rule.

The load-bearing unknown was spec 0068 R6: can each of the four CLIs (Claude
Code, Gemini CLI, GitHub Copilot CLI, Antigravity CLI) perform a direct,
on-demand file read of a store **outside** the project workspace at runtime? The
answer determines whether the everyday path can be a plain file read or needs a
dedicated retrieval service. That unknown was resolved empirically before any
design was fixed — see
[`docs/research/system-context-sandbox-probe.md`](../research/system-context-sandbox-probe.md).

### Probe outcome (the evidence this decision rests on)

| CLI | Verdict |
|---|---|
| Claude Code (`claude -p`) | **PASS-default** — reads the store from an untrusted scratch dir, bare, no config |
| Antigravity (`agy --print`) | **PASS-default** — reads the store from an untrusted scratch dir, bare, no config |
| Copilot (`copilot -p`) | **PASS with a path grant** — reads the store when the path is allowlisted (`--add-dir`/`--allow-all-paths`) or approved interactively; denied otherwise; `trustedFolders` in `config.json` does **not** grant a durable cross-project read (tested) |
| Gemini (`gemini -p`) | **could-not-probe here** — auth ineligible (`IneligibleTierError`, free-tier deprecated) blocks every LLM turn; independently trust-gated by default |

The scratch-directory pass controlled for this operator's accumulated trust
grants (`~/.gemini/trustedFolders.json` trusts an ancestor of the crewrig tree;
`~/.copilot/*` list the exact repo path) so the verdicts represent a fresh
adopter, not this machine's history.

## Decision

Introduce a single committed store at **`artifacts/core/system-context/`**,
installed verbatim to one shared home path **`~/.crewrig/system-context/`** by all
four setup scripts through a new `install_dir()` helper in
`scripts/lib/common.sh` (the directory analogue of the existing `install_file()`,
preserving its link/copy duality so the forkable-first symlink path works for the
store too). The reference-heavy, occasionally-needed subsections of `60-tools.md`
(Palace Structure Conventions, Long-Running Task Convention, MCP Tools Reference,
the Friction Reporting payload-schema/categories/example reference detail, and
the Obsidian Protocol) are relocated into the store, each replaced by a short
stub + pointer. Sections consulted **every** session (the Session Start sweep,
the recognition signals, the three-tier memory model, the recap/French
behavioral rules) stay inline.

Retrieval is resolved by one deterministic protocol, authored once near the top
of `60-tools.md`:

1. **Direct file read** of `~/.crewrig/system-context/<file>.md` — the default,
   always-available path; no running service.
2. **MemPalace** — an optional enhancement: the Session Start sweep mirrors each
   store file into a drawer (`wing="system-context"`, `room="store"`) verbatim,
   so `mempalace_search` returns byte-identical content when MemPalace is
   configured and the direct read is unavailable.
3. **Explicit signal** — if neither path serves a needed store file, the agent
   stops and names the unreachable section; a rule is never silently omitted.

Because `60-tools.md` is a **single source** deployed identically to all four
CLI homes (no per-CLI content templating), the stub is authored once in this
universal explicit-signal form. This is the single-source realization of the
per-CLI stub intent in spec 0068 R4/PLAN Step 9: the PASS-default CLIs (Claude,
Antigravity) take the direct read and never reach the fallback; Copilot
(headless) and Gemini (unverified) are caught by the fallback. It satisfies R4
for every CLI without four divergent stub variants.

The dedicated fallback retrieval service (spec 0068's deferred "third mode") is
**not** built. Gemini (auth-unverified + trust-gated) and Copilot (headless, no
durable pre-authorization surface) are documented as the R6 trigger conditions
for it, in the probe doc and in the CLI matrix.

## Alternatives considered

- **Build the dedicated fallback service first.** Rejected: spec 0068 settles the
  ordering (direct-read default → MemPalace optional → service deferred until a
  CLI is *proven* unable to read directly) and marks building it out of scope.
  The probe proves two CLIs PASS-default and a third reads with a path grant;
  building a service before any CLI is proven unable would over-engineer and
  re-litigate a merged spec.
- **Per-CLI stub text.** Rejected: `60-tools.md` has no per-CLI content
  templating in the setup scripts (it is copied verbatim under different
  filenames), so per-CLI stubs are not achievable without adding a templating
  seam — a new abstraction. The universal explicit-signal stub is simpler and
  satisfies R4 for all four.
- **Write a `trustedFolders` entry for Copilot / a settings mutation for Gemini
  at setup time.** Rejected on evidence: the Copilot `trustedFolders` write was
  tested and does **not** grant a durable cross-project read; the Gemini
  mutation could not be verified (auth ineligible). Writing unverified or
  ineffective config would poison the contract. Both CLIs install the store
  identically and rely on the explicit-signal fallback.
- **Pre-seed MemPalace at setup time via a bundled Python script.** Rejected:
  setup runs outside any agent tool-call loop, so this would need the
  bundled-script write-path carve-out — whose condition requires justifying why
  plain MCP calls cannot do the job, and here they can, once the write moves into
  the Session Start sweep the agent already runs. Zero new script beats a
  carve-out-justified one.
- **Duplicate the store per CLI** (mirroring the `60_TOOLS.md` /
  `60-tools.instructions.md` naming split). Rejected: that split exists only
  because Gemini/Antigravity concatenate numbered-priority files at startup;
  on-demand tool reads have no such constraint, so one shared
  `~/.crewrig/system-context/` serves all four and keeps R1's byte-identical
  check to a single location.
- **Nest the store under `artifacts/core/rules/system-context/`.** Set aside:
  spec 0067's precedent gave extracted content its own top-level namespace rather
  than nesting it under the file it came from, leaving room for a later source
  other than `60-tools.md` to extract into the same store.

## Consequences

- `60-tools.md` drops from ~30 KB to ~22 KB; ~8.8 KB of reference detail moves to
  the store. The every-session content (Session Start sweep, recognition signals)
  stays inline, so `AGENTS.md`'s Session Bootstrap reference remains valid.
- `artifacts/core/system-context/` is a new top-level core-layer path, registered
  in [`docs/layers.md`](../layers.md) and `.crewrig/core-paths.txt` (`strict`).
- No build-components / version-bump impact: `60-tools.md` and the store files are
  plain markdown installed by `install_file`/`install_dir`, not skill/agent
  bundles, and carry no `metadata.provenance.version`.
- Rollback is a plain commit revert (every change is additive or a
  relocation-with-stub). Each adopter's `~/.crewrig/system-context/` and any
  MemPalace store drawers are inert leftovers, naturally overwritten on the next
  setup run or Session Start sweep.
- The deferred dedicated retrieval service is documented, not opened as a ticket;
  its trigger conditions (Gemini, headless Copilot) are recorded per R6.
