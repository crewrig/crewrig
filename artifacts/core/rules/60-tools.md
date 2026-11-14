# Tools and MCP Server Guidelines

Prefer integrated MCP tools over ad-hoc alternatives unless the user
explicitly directs otherwise.

The orchestrator memory protocol lives in `60-memory.md`, which Claude Code worker sessions do not load.

---

## Retrieving the system-context store

Several reference-heavy subsections below have been moved into a committed
store, installed to `~/.crewrig/system-context/` (source of truth:
`artifacts/core/system-context/`). This keeps the home-installed file small
enough for every supported CLI to load in full, while the moved rules stay
reliably reachable on demand.

Every stub that points into the store resolves with this deterministic
protocol — the same path selection every session:

1. **Direct file read — the default, always-available path.** Read
   `~/.crewrig/system-context/<file>.md` with your file-reading tool. This path
   needs no running service and is attempted first on every CLI.
2. **MemPalace — optional enhancement.** If the direct read is unavailable and
   MemPalace is configured, retrieve the same content with `mempalace_search`
   (the Session Start sweep mirrors each store file into a drawer verbatim).
   The bytes are identical to the direct read.
3. **Explicit signal — never silent.** If neither path can serve a needed store
   file, STOP and tell the user which section is unreachable. Never proceed as
   if the content were absent.

The selected path is observable (the direct read is always tried first) and the
store content is byte-identical regardless of which path serves it.

---

## Forge Access

Forge access is CLI-only. Every forge operation — issues, pull/merge requests,
branch protection, and releases — SHALL go through the forge's own
command-line tool, with authentication delegated to that tool. The framework
ships no forge MCP server for any CLI.

- **GitHub** → `gh`
- **GitLab** → `glab`
- **Gitea** → `tea`

Native `git` remains the tool for ordinary version control (clone, commit,
branch, push, fetch, rebase) and is unaffected by this policy.

Authentication is a per-tool precondition, established once via each tool's own
login flow — no personal access token is stored in any framework config:

```sh
gh auth login      # GitHub
glab auth login    # GitLab (self-hosted: glab auth login --hostname <host>)
tea login add      # Gitea
```

When an operation is scriptable, prefer the tool's structured output
(`gh … --json`, `glab … -F json`) so results parse deterministically.

---

## User-gate validation backend

Artifact-validation gates — a spec, a plan, or any document put to the user for
a decision — SHALL be realised by invoking the `user-validate` skill. Do NOT
reimplement a gate inline; `user-validate` is the sole implementation of the
protocol (spec 0080 R9).

Two backends:

- `plannotator` — opt-in, rich browser review.
- `internal` — the default floor: `AskUserQuestion` (or the host CLI's
  equivalent structured prompt), never a bare prose question.

Four cross-cutting options tune each request:

- *translation* — presentation-only; the copy shown to the user may be
  translated, the repository artifact stays English.
- *pedagogy* — `simple` | `contextual` | `professor` framing.
- *illustration* — best-effort, honoured only with the `plannotator` backend
  and an image-displaying surface (strictly reserved for pedagogical
  diagrams/schemas, never decorative; inline SVG preferred).
- *theme* — `auto` (or `system`) | `dark` | `light` theme styling for
  bespoke HTML presentations.

The active configuration is discovered at runtime from
`~/.crewrig/validation.conf` (`key=value` lines: `backend`, `translate`,
`pedagogy`, `illustration`, `theme`; when the file is absent, the default
`backend=internal` applies). The full procedure — backend detection, the
`plannotator annotate <file> --gate --json` invocation, exit-plus-stdout
validation, decision mapping, and fallback — lives in the `user-validate` skill,
not here.

---

## Friction Reporting — Harness Feedback Loop

The crew you operate within is not static. When an agent hits a sharp
edge during real work — a poorly-worded prompt, a tool that does the
wrong thing, an output format that breaks downstream parsing — that
signal must reach the maintainers of the agent system itself.
Otherwise the same friction repeats forever.

This section defines the **fire-and-forget tagging protocol**: agents
tag frictions as they happen, never blocking the work in progress and
never waiting for a synchronous acknowledgment. A separate Curator
agent (out of scope for this section) reads the tags on demand and
proposes feedback MRs against the canonical/feedback repos declared
in each component's `provenance:` block.

### When to tag

Tag a friction whenever a **recognition signal** fires (next section).
Do not pause the user's task longer than the tag itself. The cost of
one tag is normally negligible — the one exception is when the MemPalace
write path is unavailable (a peer holds the write lock, or the server is
disconnected). That exception is the **rare** case rather than the routine
one on a machine converted to the shared MemPalace MCP HTTP daemon (see
*How to tag* below for why) — but it remains a documented failure mode
with a fallback in the `harness-report` procedure, because the refusal is
still a degraded path every agent must be able to handle; the cost of an
un-reported friction that bites the next agent is much higher.

If unsure whether something qualifies — tag it. Curation will discard
noise; silent friction is the failure mode to avoid.

### Recognition signals

These are the canonical signals that **must** trigger a tag. They are
listed here, not duplicated across every skill, so the contract has
one source of truth.

1. **User pushback.** The user contests, corrects, or reverts the
   action you just took, or reformulates the same intent because your
   previous response was misaligned.
2. **Sibling-skill workaround.** You find yourself contorting around
   a constraint set by another skill or agent — not by the user's
   request.
3. **Tool surprise (second time).** A tool produced surprising or
   inconsistent behavior for the second time in the same session.
   First time is bad luck; second time is a pattern.
4. **Process gap.** A documented workflow step turned out to be
   missing, ambiguous, contradictory, or out of date.
5. **Safeguard friction.** A rule or guard blocked a legitimate
   action and forced a workaround you had to explain explicitly to
   the user.

When any signal fires, **tag the friction before resuming work** —
not "consider tagging", not "when convenient". The fire-and-forget
property qualifies the *transport* (no ack expected); it does not
make the trigger optional.

### How to tag — the `harness-report` skill

The operational procedure (identifying the offender, picking the
room, filling the payload) lives in
`artifacts/library/skills/harness-report/SKILL.md`. Any skill or
agent that needs to tag a friction must invoke `harness-report`
rather than re-implementing the protocol inline. This keeps the
contract single-sourced and lets future improvements (richer
`evidence:` format, new recognition signals, etc.) propagate without
editing every skill body.

The fire-and-forget tag has one documented failure mode: the MemPalace write
path may be unavailable (MCP error `-32001`, write-lock refusal, or a
disconnected server). Whenever an agent or operator encounters `-32001` or a
write-lock refusal, the first diagnostic step SHALL be running
`task mempalace:status` (`node scripts/status-mcp-server.ts`). The
`harness-report` procedure carries the fallback. Details:
`docs/friction-failure-mode.md`.

### Where to write

> **Moved to the system-context store** — `~/.crewrig/system-context/friction-reporting-reference.md`. Retrieve it via the *Retrieving the system-context store* protocol near the top of this file (direct read by default; MemPalace optional; explicit signal if neither serves it).

---

## Scannable Recap Format

When composing a situation recap, status update, or progress message directed
at the user, apply this structure:

1. **Decision or outcome first.** Open with one short sentence that stands
   alone. A user who reads only that sentence must understand what happened or
   what was decided.
2. **Detail as tight bullets.** Push supporting information into bullets — one
   idea per bullet. Never stack parentheticals inside a bullet. Cap at one
   em-dash per sentence.
3. **Cap prose paragraphs at two sentences.** When a summary requires more
   than two sentences, convert the extra content into bullets.

### Anti-patterns to avoid

- **Stacked parentheticals** — `"The merge (which resolved the conflict in X
  (introduced by Y)) succeeded"` — the nested aside buries the outcome.
- **Multiple em-dashes in one sentence** — `"CI failed — lint-specs — see
  below"` — use a bullet list instead.
- **Stacked consecutive emphasis** — `"**step 1** … **step 2** … **step 3**"`
  in the same sentence — emphasis loses meaning when over-used.
- **Buried decision** — opening with context before stating the outcome forces
  the user to read to the end before knowing what happened.

### Scope

This rule applies to ephemeral user-facing prose — situation recaps, stage
transitions, progress updates, and logbook-comment summaries. It does NOT
apply to repository-bound artifacts (commit messages, PR bodies, spec files,
plan comments) or to skill-contracted output formats (e.g., the `pr-reviewer`
verdict block — that format is a protocol contract, not a recap).

---

## Idiomatic French

When the user's preferred language is French, produce all agent-authored prose
directed at the user — chat messages, progress updates, plan summaries, logbook
comments — in idiomatic French. Avoid direct calques of English software-
engineering jargon.

### Calque catalog

Use the idiomatic French equivalent on the right; avoid the English calque on
the left.

| English calque (avoid) | Idiomatic French (use) |
|---|---|
| gate / user gate | point de validation |
| build (noun/verb) | construction / compilation / construire |
| install (noun/verb) | installation / installer |
| scope (noun) | portée |
| merge (noun/verb) | fusion / fusionner |
| opt-in | activation à la demande |
| tier | palier |
| worktree | espace de travail |
| spec-PR | PR de spécification |
| lint / linter (noun) | analyse statique / vérificateur stylistique |
| commit (noun) | validation |
| spawner / shipper / merger / amender (anglicized -er verbs) | describe the action in French (*instancier*, *livrer*, *fusionner*, *corriger*…) |

The catalog is non-exhaustive. When in doubt, prefer the longer idiomatic
phrasing over the calque — verbosity in the target language costs less than
the cognitive friction of franglais.

### Translation boundary

The following items MUST NOT be translated, regardless of the active
interaction language. Present them in their original form, typically within
backtick spans:

- Code identifiers, variable names, function names, field names
- File paths and directory names
- CLI tool names and commands
- GitHub label values and frontmatter field names
- Literal skill, agent, and role names (e.g., `spec-author`, `team-lead`,
  `pr-reviewer`, `iter:1`)
- Proper nouns (product names, organization names)

### Scope

This rule applies to ephemeral user-facing prose only. Content written into
the repository or posted on GitHub (commit messages, PR bodies, spec files,
issue comments) follows the English-only project-content rule in `AGENTS.md`
and is **not** subject to this section.
